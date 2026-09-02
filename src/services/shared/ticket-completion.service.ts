import * as profileRepository from "../../repositories/shared/profile.repository";
import * as assignmentRepository from "../../repositories/shared/vehicle-job-assignment.repository";
import * as gateTicketRepository from "../../repositories/shared/gate-ticket.repository";
import * as ticketWorkerRepository from "../../repositories/shared/ticket-worker.repository";
import * as marketJobRepository from "../../repositories/shared/market-job.repository";
import * as lineRepository from "../../repositories/line.repository";
import * as vehicleJobRepository from "../../repositories/shared/vehicle-job.repository";
import * as vehicleJobLifecycleService from "./vehicle-job-lifecycle.service";
import * as rateResolutionService from "./rate-resolution.service";
import { hasVendorConfirmationTimeout, scheduleVendorConfirmationTimeout } from "../../queues/worker-queue";
import { enqueueLoggedLineMessage } from "../../queues/notification-queue";
import { getRuntimeSettings } from "./runtime-settings.service";
import { ASSIGNMENT_STATUS, TICKET_STATUS, TICKET_WORKER_STATUS } from "../../constants/job-status";
import { resolveTicketResultAudience, publishRealtimeEvent } from "./realtime-notification.service";
import { buildVendorCompletionReviewFlexMessage } from "../../utils/line-flex-message";
import { buildWorkerTicketPayload } from "../../utils/ticket-payload";
import ApiError from "../../utils/api-error";
import { logger } from "../../utils/logger";

import type { DbConnection } from "../../types/shared/common.type";
import type { LineMessage } from "../../types/line.type";
import type { VendorTicketCompletionAction, VendorTicketCompletionFlowResult } from "../../types/line.type";
import type { GateTicketDto, TicketCompletionSubmissionDto, TicketProductConfirmationInput, TicketProductDto, VendorLineTargetDto, VehicleJobDetailResponse } from "../../types/worker.type";

// Function ประมวลผล confirm/reject จาก vendor และเตรียม payload realtime กลาง
export async function applyVendorTicketCompletionResult(input: {
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
  action: VendorTicketCompletionAction;
  rejectReason?: string | null;
  resolvedByLineUserId?: string | null;
  connection: DbConnection;
}): Promise<VendorTicketCompletionFlowResult> {
  const isConfirmed = input.action === "confirm";
  const updated = isConfirmed
    ? await gateTicketRepository.confirmTicketCompletion(
        input.ticket.id,
        input.submission.id,
        input.connection,
        input.resolvedByLineUserId,
      )
    : await gateTicketRepository.rejectTicketCompletion(
        input.ticket.id,
        input.submission.id,
        input.rejectReason,
        input.connection,
        input.resolvedByLineUserId,
      );

  // Financial finalize ไม่เกิดที่นี่อีกต่อไป (booth เดียวไม่พอ ต้องรอทุก Booth ของ Business
  // Ticket จบก่อน) — closeCompletedVehicleJobIfReady จะเป็นคนเรียก finalizeMarketJobFinancials
  // เองเมื่อ Business Ticket ที่ booth นี้สังกัดอยู่ Terminal ครบทุก Booth แล้ว
  const completedVehicleJob = isConfirmed
    ? await vehicleJobLifecycleService.closeCompletedVehicleJobIfReady(
        updated.ticket.vehicle_job_id,
        input.connection,
      )
    : null;
  const nextTicket =
    isConfirmed && !completedVehicleJob
      ? await vehicleJobLifecycleService.activateNextTicketIfReady(
          updated.ticket.vehicle_job_id,
          input.connection,
        )
      : null;

  if (isConfirmed && !completedVehicleJob) {
    await assignmentRepository.setVehicleAssignmentsStatus(
      updated.ticket.vehicle_job_id,
      ASSIGNMENT_STATUS.WORKING,
      input.connection,
    );
  }

  if (!isConfirmed) {
    await assignmentRepository.setVehicleAssignmentsStatus(
      updated.ticket.vehicle_job_id,
      ASSIGNMENT_STATUS.REJECT,
      input.connection,
    );
  }

  const [receiverAccountIds, products, detail] = await Promise.all([
    resolveTicketResultAudience(updated.ticket, input.connection),
    gateTicketRepository.listTicketProducts(
      updated.ticket.id,
      input.connection,
    ),
    vehicleJobRepository.getVehicleJobDetail(
      updated.ticket.vehicle_job_id,
      input.connection,
    ),
  ]);
  const completedWorkerCodes = completedVehicleJob
    ? await profileRepository.findWorkerCodesByAccountIds(
        completedVehicleJob.completed_worker_ids,
        input.connection,
      )
    : [];
  const assignmentStatus = isConfirmed
    ? completedVehicleJob
      ? ASSIGNMENT_STATUS.COMPLETED
      : ASSIGNMENT_STATUS.WORKING
    : ASSIGNMENT_STATUS.REJECT;

  return {
    ...updated,
    products,
    detail,
    completedVehicleJob,
    completedWorkerCodes,
    nextTicket,
    receiverAccountIds,
    assignmentStatus,
    isConfirmed,
    title: isConfirmed
      ? "Ticket completion confirmed"
      : "Ticket completion rejected",
    message: isConfirmed
      ? `Vendor confirmed ticket ${updated.ticket.boothCode}.`
      : `Vendor rejected ticket ${updated.ticket.boothCode}.`,
  };
}

// Function สร้าง key สำหรับระบุสินค้าแต่ละ package ภายใน ticket
function buildTicketProductKey(productCode: string, packageCode: string): string {
  return JSON.stringify([productCode, packageCode]);
}

// Function ตรวจสอบ ticket completion items ใน service flow — ใช้ร่วมกันทั้ง Worker ส่งเองและ
// Admin ส่งแทน
//
// รองรับเปลี่ยน PackageCode ของสินค้าเดิม: original_package_code (ถ้ามี) คือ PackageCode ที่ Gate
// เคยประกาศไว้ ใช้จับคู่กับ TicketProduct เดิมที่มีอยู่แล้ว ส่วน packageCode คือค่าที่ส่งจริง (เดิม
// หรือใหม่ก็ได้) — ProductCode ต้องเป็นตัวเดียวกับเดิมเสมอ ห้ามสลับสินค้า
function validateTicketCompletionItems(
  products: TicketProductDto[],
  items: TicketProductConfirmationInput[],
): void {
  const productKeys = new Set(
    products.map((product) =>
      buildTicketProductKey(product.productCode, product.packageCode),
    ),
  );

  const matchedOriginalKeys = new Set<string>();
  const finalKeys = new Set<string>();

  for (const item of items) {
    const originalKey = buildTicketProductKey(
      item.productCode,
      item.original_package_code ?? item.packageCode,
    );

    if (!productKeys.has(originalKey)) {
      throw new ApiError(
        400,
        "INVALID_TICKET_PRODUCT",
        "Ticket product and package do not belong to this ticket.",
      );
    }

    if (matchedOriginalKeys.has(originalKey)) {
      throw new ApiError(
        400,
        "DUPLICATE_TICKET_PRODUCT",
        "Ticket product and package are duplicated in completion items.",
      );
    }

    matchedOriginalKeys.add(originalKey);

    const finalKey = buildTicketProductKey(item.productCode, item.packageCode);

    if (finalKeys.has(finalKey)) {
      throw new ApiError(
        400,
        "DUPLICATE_TICKET_PRODUCT",
        "Two ticket products cannot be switched to the same product and package.",
      );
    }

    finalKeys.add(finalKey);
  }

  if (matchedOriginalKeys.size !== products.length) {
    throw new ApiError(
      400,
      "INCOMPLETE_TICKET_PRODUCTS",
      "All ticket products must be sent with confirmed quantities.",
    );
  }
}

// Function หา Rate Snapshot ใหม่ให้ item ที่เปลี่ยน PackageCode ก่อนบันทึกลง TicketProduct
//
// Rate Snapshot เดิมผูกกับ PackageCode เดิมเท่านั้น (น้ำหนัก/Rate ต่างกันตาม Package) จึงต้อง Query
// Master Product + Master Rate ใหม่ทันทีที่เปลี่ยน PackageCode ห้ามเก็บ Rate Snapshot เดิมไว้ใช้กับ
// PackageCode ใหม่ — item ที่ไม่ได้เปลี่ยน PackageCode จะผ่านฟังก์ชันนี้โดยไม่แตะต้อง
export async function resolvePackageSwitchesForItems(
  items: TicketProductConfirmationInput[],
  marketCode: string,
  connection: DbConnection,
): Promise<TicketProductConfirmationInput[]> {
  return Promise.all(
    items.map(async (item) => {
      const originalPackageCode = item.original_package_code;

      if (!originalPackageCode || originalPackageCode === item.packageCode) {
        return item;
      }

      const resolvedPackage = await rateResolutionService.resolvePackageWeight(
        item.productCode,
        item.packageCode,
        connection,
      );

      const packageWeight = resolvedPackage.packageWeight;
      const applicableRate = await rateResolutionService.findApplicableRate(
        marketCode,
        packageWeight,
        connection,
      );
      const rateSnapshotAt = new Date();

      return {
        ...item,
        package_switch: {
          packageName: resolvedPackage.packageName,
          packageWeightSnapshot: packageWeight.toString(),
          rateIdSnapshot: applicableRate.rate.id,
          sourceRateIdSnapshot: applicableRate.rate.sourceRateId,
          rateMarketCode: applicableRate.appliedMarketCode,
          rateSource: applicableRate.rateSource,
          weightRangeName: applicableRate.rate.weightRangeName,
          weightMinSnapshot: applicableRate.rate.weightMin.toString(),
          weightMaxSnapshot: applicableRate.rate.weightMax.toString(),
          stallRateSnapshot: applicableRate.rate.stallRate.toString(),
          laborRateSnapshot: applicableRate.rate.laborRate.toString(),
          rateSnapshotAt,
        },
      };
    }),
  );
}

// Function เลือก timeout การยืนยัน vendor ตาม flow ส่งครั้งแรกหรือส่งใหม่หลัง reject
function getVendorConfirmationTimeoutMs(
  ticket: GateTicketDto,
  settings: Awaited<ReturnType<typeof getRuntimeSettings>>,
): number {
  const timeoutHours =
    ticket.status === TICKET_STATUS.REJECT
      ? settings.vendor_reconfirm_timeout_hours
      : settings.vendor_confirm_timeout_hours;

  return timeoutHours * 60 * 60 * 1000;
}

// Function สร้าง postback token คู่ confirm/reject สำหรับ LINE ส่งหา Vendor
async function buildVendorCompletionPostbackData(
  ticket: GateTicketDto,
  submission: TicketCompletionSubmissionDto,
): Promise<{ confirm: string; reject: string }> {
  const confirmToken = await lineRepository.createLineActionToken({
    action: "vendor_confirm_completion",
    ticket_id: ticket.id,
    submission_id: submission.id,
    boothCode: ticket.boothCode,
  });
  const rejectToken = await lineRepository.createLineActionToken({
    action: "vendor_reject_completion",
    ticket_id: ticket.id,
    submission_id: submission.id,
    boothCode: ticket.boothCode,
  });

  return {
    confirm: `token=${confirmToken.token}`,
    reject: `token=${rejectToken.token}`,
  };
}

// Function สร้าง vendor completion messages ใน service flow
function buildVendorCompletionMessages(
  ticket: GateTicketDto,
  postbackData: { confirm: string; reject: string },
  detail: VehicleJobDetailResponse | null,
  products: TicketProductDto[],
  originalProducts: TicketProductDto[],
): LineMessage[] {
  return [
    buildVendorCompletionReviewFlexMessage({
      ticket,
      postbackData,
      detail,
      products,
      originalProducts,
    }),
  ];
}

// Function ส่งยอดปิด Booth หนึ่งใบ (validate + markTicketDelivered + สร้าง TicketCompletionSubmission
// + snapshot จำนวน worker) ใช้ร่วมกันทั้ง Worker ส่งเอง (requireRosterMembership: true — ผู้ส่งต้อง
// เป็นสมาชิก WORKING ของ Business Ticket นี้จริง) และ Admin ส่งแทนกรณี Worker กดส่งเองไม่ได้
// (requireRosterMembership: false — Admin ไม่ใช่สมาชิกใน roster) — เงื่อนไขอื่นเหมือนกันทุกจุด
// (ต้องมี Vendor LINE target, ทีมต้อง check-in ครบก่อน) เพื่อให้ผลลัพธ์ปลายทาง (รอ Vendor ยืนยันผ่าน
// LINE) เหมือนกันไม่ว่าใครเป็นคนกดส่ง
export async function submitTicketCompletion(input: {
  findTicket: (connection: DbConnection) => Promise<GateTicketDto | null>;
  items: TicketProductConfirmationInput[];
  submittedByAccountId: number;
  submittedByRole: string;
  requireRosterMembership: boolean;
  connection: DbConnection;
}): Promise<{
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
  products: TicketProductDto[];
  originalProducts: TicketProductDto[];
  receiverAccountIds: number[];
  vendorLineTargets: VendorLineTargetDto[];
  vendorTimeoutMs: number;
}> {
  const {
    findTicket,
    items,
    submittedByAccountId,
    submittedByRole,
    requireRosterMembership,
    connection,
  } = input;
  const ticket = await findTicket(connection);

  if (!ticket) {
    throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");
  }

  const vendorLineTargets =
    await gateTicketRepository.listActiveVendorLineTargetsForTicket(
      ticket.id,
      connection,
    );

  if (vendorLineTargets.length === 0) {
    throw new ApiError(
      409,
      "TICKET_VENDOR_LINE_NOT_CONFIGURED",
      "Ticket vendor LINE targets are not configured.",
    );
  }

  if (ticket.status === TICKET_STATUS.COMPLETED) {
    throw new ApiError(409, "TICKET_ALREADY_CLOSED", "Ticket is already closed.");
  }

  const readiness = await vehicleJobRepository.getVehicleWorkReadiness(
    ticket.vehicle_job_id,
    connection,
  );

  if (!readiness.is_ready) {
    throw new ApiError(
      409,
      "WORKERS_NOT_CHECKED_IN",
      "All assigned workers must check in before this stall job can be completed.",
      readiness,
    );
  }

  const ticketWorkers =
    await ticketWorkerRepository.syncTicketWorkersFromVehicleAssignments(
      ticket.market_job_id,
      ticket.vehicle_job_id,
      connection,
    );

  if (requireRosterMembership) {
    // ตรวจสอบว่า Worker ที่ส่งยอดยังเป็นสมาชิกที่ทำงานอยู่ใน Business Ticket ของ Booth นี้ (Worker
    // อาจถูก Cancel เฉพาะ Business Ticket นี้ แต่ยัง Check-in รถและทำ Ticket อื่นได้)
    const isTicketWorker = ticketWorkers.some(
      (worker) =>
        worker.worker_id === submittedByAccountId &&
        worker.status === TICKET_WORKER_STATUS.WORKING,
    );

    if (!isTicketWorker) {
      throw new ApiError(
        403,
        "WORKER_NOT_IN_TICKET",
        "Worker is not assigned to this ticket.",
      );
    }
  }

  const products = await gateTicketRepository.listTicketProducts(
    ticket.id,
    connection,
  );

  validateTicketCompletionItems(products, items);

  const marketJob = await marketJobRepository.findMarketJobById(
    ticket.market_job_id,
    connection,
  );

  if (!marketJob) {
    throw new ApiError(404, "MARKET_JOB_NOT_FOUND", "Business ticket not found.");
  }

  // Resolve ก่อน markTicketDelivered เสมอ: ถ้า PackageCode ใหม่ไม่ valid หรือหา Rate ไม่ได้ ต้องล้ม
  // ก่อน ticket จะถูกเปลี่ยนสถานะเป็น DELIVERED
  const resolvedItems = await resolvePackageSwitchesForItems(
    items,
    marketJob.marketCode,
    connection,
  );

  const canSubmit = await gateTicketRepository.markTicketDelivered(
    ticket.id,
    connection,
  );

  if (!canSubmit) {
    if (ticket.status === TICKET_STATUS.DELIVERED) {
      throw new ApiError(
        409,
        "TICKET_ALREADY_SUBMITTED",
        "Ticket completion is already waiting for vendor confirmation.",
      );
    }

    throw new ApiError(
      409,
      "TICKET_NOT_READY_FOR_COMPLETION",
      "Ticket is not ready for completion submission.",
    );
  }

  // Booth Worker Count Snapshot: จำนวน Worker WORKING ณ ตอน Submit จริง (จาก ticketWorkers ที่
  // sync ไปแล้วด้านบน ในทรานแซกชันเดียวกัน) ไม่ใช่ Roster ปัจจุบันหรือ Confirm-time Snapshot — ต้อง
  // Snapshot ใหม่ทุกครั้งที่ Submit ห้าม copy จาก Submission ก่อนหน้า และนับเหมือนกันไม่ว่าใครกดส่ง
  // ใช้ชุดเดียวกับ workingTicketWorkerIds ด้านล่างเป๊ะ (count ต้องตรงกับ list เสมอ)
  const workingTicketWorkerIds = ticketWorkers
    .filter((worker) => worker.status === TICKET_WORKER_STATUS.WORKING)
    .map((worker) => worker.id);
  const workerCountSnapshot = workingTicketWorkerIds.length;
  // Assignment ปัจจุบันของผู้ส่งยอด ณ ตอน Submit จริง — เป็น null ตามธรรมชาติเมื่อ Admin submit
  // แทน Worker (Admin ไม่มี VehicleJobAssignment ของตัวเอง) ห้ามเดาย้อนหลังตอนอ่าน Work History
  const submitterAssignment =
    await assignmentRepository.findCurrentAssignmentByVehicleJobIdAndWorker(
      ticket.vehicle_job_id,
      submittedByAccountId,
      connection,
    );
  const submission = await gateTicketRepository.createTicketCompletionSubmission(
    ticket.id,
    submittedByAccountId,
    submittedByRole,
    workerCountSnapshot,
    submitterAssignment?.id ?? null,
    connection,
  );

  // Snapshot roster ณ ตอน Submit จริง (แยกจาก GateTicketWorkerSnapshot ที่จะถูก snapshot ทีหลังตอน
  // Confirm) — ใช้สำหรับ Work History SubmissionWorkerSnapshot[] เท่านั้น ห้ามใช้เป็น divisor การเงิน
  await gateTicketRepository.createSubmissionWorkerSnapshots(
    submission.id,
    workingTicketWorkerIds,
    connection,
  );

  await assignmentRepository.setVehicleAssignmentsStatus(
    ticket.vehicle_job_id,
    ASSIGNMENT_STATUS.DELIVERED,
    connection,
  );

  const confirmedProducts = await gateTicketRepository.updateTicketProductConfirmations(
    ticket.id,
    resolvedItems,
    connection,
  );
  const waitingTicket = await gateTicketRepository.findGateTicketForCompletion(
    ticket.id,
    connection,
  );
  const receiverAccountIds = await resolveTicketResultAudience(ticket, connection);
  const settings = await getRuntimeSettings();

  return {
    ticket: waitingTicket ?? {
      ...ticket,
      status: TICKET_STATUS.DELIVERED,
      confirmation_status: TICKET_STATUS.DELIVERED,
    },
    submission,
    products: confirmedProducts,
    // ค่าก่อนอัปเดต ใช้เทียบ PackageCode เดิม vs ใหม่ในข้อความ LINE ให้ Vendor เห็นการเปลี่ยนแปลง
    originalProducts: products,
    receiverAccountIds,
    vendorLineTargets,
    vendorTimeoutMs: getVendorConfirmationTimeoutMs(ticket, settings),
  };
}

// Function จัดการ notify หลัง submitTicketCompletion สำเร็จ (ตั้งเวลา auto-confirm + ส่ง LINE ไป
// Vendor + publish realtime event) ใช้ร่วมกันทั้ง Worker ส่งเองและ Admin ส่งแทน — คืน detail ของ
// vehicle job กลับไปให้ caller ใช้ประกอบ response ต่อ โดยไม่ต้อง query ซ้ำ
export async function notifyTicketCompletionSubmitted(result: {
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
  products: TicketProductDto[];
  originalProducts: TicketProductDto[];
  receiverAccountIds: number[];
  vendorLineTargets: VendorLineTargetDto[];
  vendorTimeoutMs: number;
}): Promise<{ detail: VehicleJobDetailResponse | null }> {
  await scheduleVendorConfirmationTimeout(
    result.ticket.id,
    result.submission.id,
    result.vendorTimeoutMs,
  );

  const detail = await vehicleJobRepository.getVehicleJobDetail(
    result.ticket.vehicle_job_id,
  );
  const linePostbackData = await buildVendorCompletionPostbackData(
    result.ticket,
    result.submission,
  );
  const lineMessages = buildVendorCompletionMessages(
    result.ticket,
    linePostbackData,
    detail,
    result.products,
    result.originalProducts,
  );

  for (const target of result.vendorLineTargets) {
    await enqueueLoggedLineMessage({
      jobName: "send-vendor-ticket-completion",
      action: "send_vendor_ticket_completion",
      targetLineUserId: target.line_user_id,
      payload: {
        ticket_id: result.ticket.id,
        submission_id: result.submission.id,
        vendor_line_id: target.line_user_id,
        vendor_line_target_type: target.target_type,
        items: result.products,
      },
      messages: lineMessages,
    });
  }

  const realtimePayload = {
    ...buildWorkerTicketPayload(result.ticket, detail, result.products, {
      submission_status: result.submission.status,
      assignment_status: ASSIGNMENT_STATUS.DELIVERED,
      confirmed_at: result.submission.confirmed_at,
      rejected_at: result.submission.rejected_at,
      ticket_completed_at: null,
    }),
  };

  publishRealtimeEvent({
    type: "TICKET_COMPLETION_SUBMITTED",
    title: "Ticket completion submitted",
    message: `Ticket ${result.ticket.boothCode} is waiting for vendor confirmation.`,
    payload: realtimePayload,
    admin: true,
    worker_ids: result.receiverAccountIds,
  });

  return { detail };
}

// Function กู้คืน Submission ที่ค้าง DELIVERED เพราะ Server ล่มไปก่อนที่ submitTicketCompletion จะ
// schedule vendor-confirm-timeout job/ส่ง LINE ไปหา Vendor สำเร็จ (สอง step นี้เกิด "หลัง" DB
// transaction ที่เปลี่ยน Ticket เป็น DELIVERED commit ไปแล้ว — ดู notifyTicketCompletionSubmitted)
// เรียกครั้งเดียวตอน Server เริ่มทำงาน — เช็คกับ BullMQ จริงก่อนเสมอ (hasVendorConfirmationTimeout)
// เพื่อไม่ไป reconcile Ticket ที่กำลังรอ Vendor ตามปกติอยู่แล้วซ้ำ (มี job จริงตั้งรออยู่แล้ว) คืนจำนวน
// Ticket ที่กู้คืนสำเร็จ
export async function reconcileOrphanedTicketSubmissions(): Promise<number> {
  const candidates = await gateTicketRepository.listDeliveredTicketsWithLatestSubmission();
  let reconciledCount = 0;

  for (const { ticket, submission } of candidates) {
    const alreadyScheduled = await hasVendorConfirmationTimeout(ticket.id, submission.id);

    if (alreadyScheduled) {
      continue;
    }

    try {
      const [vendorLineTargets, products, receiverAccountIds, settings] = await Promise.all([
        gateTicketRepository.listActiveVendorLineTargetsForTicket(ticket.id),
        gateTicketRepository.listTicketProducts(ticket.id),
        resolveTicketResultAudience(ticket),
        getRuntimeSettings(),
      ]);

      if (vendorLineTargets.length === 0) {
        logger.warn("Skipped reconciling orphaned ticket submission: no vendor LINE target configured.", {
          ticketId: ticket.id,
          submissionId: submission.id,
        });
        continue;
      }

      // ไม่มี "ค่าก่อนหน้า" ให้เทียบจริงในเส้นทาง recovery นี้ (ต่างจาก submitTicketCompletion ที่มี
      // originalProducts จาก query ก่อนอัปเดต) — ใช้ products ปัจจุบันซ้ำทั้งสองฝั่ง ผลคือข้อความ LINE
      // จะไม่โชว์ diff ของ PackageCode ที่เปลี่ยน (กรณี edge case หายาก) แต่ยังคงส่งแจ้งเตือน Vendor
      // และ schedule timeout ใหม่ได้ถูกต้อง ซึ่งเป็นเป้าหมายหลักของ recovery นี้
      await notifyTicketCompletionSubmitted({
        ticket,
        submission,
        products,
        originalProducts: products,
        receiverAccountIds,
        vendorLineTargets,
        vendorTimeoutMs: getVendorConfirmationTimeoutMs(ticket, settings),
      });
      reconciledCount += 1;
      logger.info("Reconciled an orphaned ticket submission stuck without a vendor-confirm-timeout job.", {
        ticketId: ticket.id,
        submissionId: submission.id,
      });
    } catch (error) {
      logger.error("Failed to reconcile orphaned ticket submission.", {
        ticketId: ticket.id,
        submissionId: submission.id,
        error,
      });
    }
  }

  return reconciledCount;
}
