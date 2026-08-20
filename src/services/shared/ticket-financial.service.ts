// Import Library
import { Prisma } from "@prisma/client";

// Import Dependencies
import * as ticketFinancialRepository from "../../repositories/shared/ticket-financial.repository";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { TicketFinancializationResult } from "../../types/shared/ticket-financial.type";

// Import Config
import { TICKET_STATUS, TICKET_WORKER_STATUS, TERMINAL_TICKET_STATUSES } from "../../constants/job-status";

// Import Utils
import ApiError from "../../utils/api-error";
import {
  calculateProductStallCharge,
  calculateProductWorkerPayment,
} from "../../utils/labor-job-pricing";

/* -------------------------------------- Functions -------------------------------------- */

// Functionตรวจสอบว่า Product มี Rate Snapshot
// ที่จำเป็นสำหรับ Financialization ครบหรือไม่
function hasCompleteRateSnapshot(product: {
  packageWeightSnapshot: Prisma.Decimal | null;

  rateIdSnapshot: number | null;

  sourceRateIdSnapshot: number | null;

  rateMarketCode: string | null;

  rateSource: string | null;

  weightRangeName: string | null;

  weightMinSnapshot: Prisma.Decimal | null;

  weightMaxSnapshot: Prisma.Decimal | null;

  stallRateSnapshot: Prisma.Decimal | null;

  laborRateSnapshot: Prisma.Decimal | null;

  rateSnapshotAt: Date | null;
}): boolean {
  return (
    product.packageWeightSnapshot !== null &&
    product.rateIdSnapshot !== null &&
    product.sourceRateIdSnapshot !== null &&
    product.rateMarketCode !== null &&
    product.rateSource !== null &&
    product.weightRangeName !== null &&
    product.weightMinSnapshot !== null &&
    product.weightMaxSnapshot !== null &&
    product.stallRateSnapshot !== null &&
    product.laborRateSnapshot !== null &&
    product.rateSnapshotAt !== null
  );
}

// Function Finalize เงินทั้งหมดของ Business Ticket (market job) ทั้งใบ
//
// หลักการ:
// - รอทุก Booth ของ Business Ticket นี้ Terminal ก่อน (COMPLETED หรือ CANCELLED)
//   และต้องมีอย่างน้อยหนึ่ง Booth COMPLETED
// - Lock Worker Roster ก่อนคำนวณเสมอ (WORKING -> COMPLETED) — ใช้เพื่อปิดไม่ให้ sync/cancel/add
//   roster เข้ามาอีก (operational) ไม่ใช่ตัวหารเงินโดยตรงอีกต่อไป
// - ใช้ confirmedQuantity เท่านั้น
// - ใช้ Rate Snapshot เท่านั้น
// - คิดแยก Product ของทุก Booth ที่ COMPLETED ภายใต้ Ticket นี้
// - ProductCharge ปัดขึ้นแยกแต่ละ Product
// - Worker หารแยกแต่ละ Product ด้วย Snapshot worker ของ "แผงนั้นๆ" (จำนวนคนที่ยัง WORKING ตอนแผงนี้
//   confirm เอง) ไม่ใช่ roster สุดท้ายของทั้ง Ticket — คนที่ถูกยกเลิกออกจากทีมหลังแผงนี้ confirm ไปแล้ว
//   ไม่ทำให้ตัวหารของแผงนี้ลดลงย้อนหลัง แต่ละแผงจึงหารกันคนละจำนวนได้ (ดู GateTicketWorkerSnapshot)
// - Fund คำนวณแยกแต่ละ Product
// - ห้าม Query Master Rate ใหม่
export async function finalizeMarketJobFinancials(
  marketJobId: number,
  connection?: DbConnection,
): Promise<TicketFinancializationResult> {
  const context =
    await ticketFinancialRepository.findMarketJobFinancializationContext(
      marketJobId,
      connection,
    );

  if (!context) {
    throw new ApiError(
      404,
      "MARKET_JOB_NOT_FOUND",
      "Business ticket not found for financialization.",
    );
  }

  // Idempotent:
  // ถ้า Financialize แล้วให้คืนค่าเดิม
  // ห้ามคำนวณหรือสร้างรายการใหม่
  if (context.financializedAt) {
    if (context.finalStallAmount === null) {
      throw new ApiError(
        500,
        "TICKET_FINANCIAL_STATE_INVALID",
        "Financialized business ticket does not have final stall amount.",
      );
    }

    const completedWorkers = context.ticketWorkers.filter(
      (worker) => worker.status === TICKET_WORKER_STATUS.COMPLETED,
    );
    const hasMissingWorkerEarning = completedWorkers.some(
      (worker) => worker.finalEarningAmount === null,
    );

    if (hasMissingWorkerEarning) {
      throw new ApiError(
        500,
        "TICKET_FINANCIAL_STATE_INVALID",
        "Financialized business ticket has completed worker without final earning amount.",
      );
    }

    const financializedProductCount = context.tickets.reduce(
      (total, ticket) => total + ticket.products.length,
      0,
    );
    // จำนวน worker ที่ได้เงินจริง (มี finalEarningAmount ไม่ null) ไม่ใช่แค่คนที่ status ปัจจุบันเป็น
    // COMPLETED เพราะคนที่ถูกยกเลิกออกจากทีมหลังบางแผง confirm ไปแล้วก็ยังได้เงินจากแผงนั้นอยู่
    const paidWorkerCount = context.ticketWorkers.filter(
      (worker) => worker.finalEarningAmount !== null,
    ).length;

    return {
      marketJobId: context.id,

      productCount: financializedProductCount,

      workerCount: paidWorkerCount,

      finalStallAmount: context.finalStallAmount,

      finalizedAt: context.financializedAt,

      alreadyFinalized: true,
    };
  }

  const completedTickets = context.tickets.filter(
    (ticket) => ticket.status === TICKET_STATUS.COMPLETED,
  );
  const allTicketsTerminal =
    context.tickets.length > 0 &&
    context.tickets.every((ticket) => TERMINAL_TICKET_STATUSES.includes(ticket.status));

  if (completedTickets.length === 0 || !allTicketsTerminal) {
    throw new ApiError(
      409,
      "MARKET_JOB_NOT_READY_FOR_FINANCIALIZE",
      "Every booth of this business ticket must be terminal, with at least one completed, before financialization.",
    );
  }

  const products = completedTickets.flatMap((ticket) => ticket.products);

  if (products.length === 0) {
    throw new ApiError(
      409,
      "TICKET_PRODUCTS_NOT_FOUND",
      "Business ticket does not have products for financialization.",
    );
  }

  // ถ้า Business Ticket ยังไม่ได้ Financialize
  // แต่มี Product Financial อยู่แล้ว
  // ถือว่าเป็น Partial State ที่ไม่ควรเกิดขึ้น
  //
  // ห้ามเขียนทับข้อมูลทางการเงินเก่า
  const hasExistingFinancial = products.some(
    (product) => product.financial !== null,
  );

  if (hasExistingFinancial) {
    throw new ApiError(
      500,
      "TICKET_FINANCIAL_PARTIAL_STATE",
      "Business ticket has partial financial records before finalization.",
    );
  }

  // Final Eligible Worker = Roster ที่ยัง WORKING ตอน Lock เท่านั้น
  //
  // ไม่ใช้:
  // VehicleJob.workersRequired
  // Master Worker Range
  const workingWorkers = context.ticketWorkers.filter(
    (worker) => worker.status === TICKET_WORKER_STATUS.WORKING,
  );
  const actualWorkerCount = workingWorkers.length;

  if (actualWorkerCount <= 0) {
    throw new ApiError(
      409,
      "TICKET_WORKERS_NOT_FOUND",
      "Business ticket does not have active workers for financialization.",
    );
  }

  const finalizedAt = new Date();

  // Lock Roster ก่อนคำนวณเสมอ: จุดนี้คือจุดตัดสินว่าห้าม Sync/Cancel/Add Worker เข้า Roster นี้อีก
  // (operational guard — ตัวหารเงินจริงต่อแผงมาจาก Snapshot ที่บันทึกไว้ตั้งแต่ตอนแผงนั้น confirm
  // ด้านล่าง ไม่ใช่ค่า Lock ตรงนี้)
  await ticketFinancialRepository.lockMarketJobWorkerRoster(
    context.id,
    connection,
  );
  await ticketFinancialRepository.markMarketJobTicketWorkersCompleted(
    context.id,
    finalizedAt,
    connection,
  );

  let finalStallAmount = new Prisma.Decimal(0);

  const finalEarningByTicketWorkerId = new Map<number, Prisma.Decimal>();
  const boothStallAmountByTicketId = new Map<number, Prisma.Decimal>();
  const distinctPaidWorkerIds = new Set<number>();
  const ticketWorkerById = new Map(
    context.ticketWorkers.map((worker) => [worker.id, worker]),
  );

  for (const worker of workingWorkers) {
    finalEarningByTicketWorkerId.set(worker.id, new Prisma.Decimal(0));
  }

  for (const ticket of completedTickets) {
    // Worker ที่หารเงินของแผงนี้ = Snapshot ที่บันทึกไว้ตอนแผงนี้ confirm (ยัง WORKING ณ ตอนนั้น
    // จริงๆ) — ถ้าไม่มี Snapshot เลย (ข้อมูลเก่าก่อนมีฟีเจอร์นี้) fallback ไปใช้ roster สุดท้ายของ
    // ทั้ง Ticket แทน เพื่อไม่ให้ Ticket ที่ค้างอยู่ตอน deploy พังไป
    const snapshotWorkerIds = ticket.workerSnapshots.map(
      (snapshot) => snapshot.ticketWorkerId,
    );
    const boothWorkerIds =
      snapshotWorkerIds.length > 0
        ? snapshotWorkerIds
        : workingWorkers.map((worker) => worker.id);
    const boothWorkers = boothWorkerIds
      .map((id) => ticketWorkerById.get(id))
      .filter((worker): worker is NonNullable<typeof worker> => worker !== undefined);
    const boothWorkerCount = boothWorkers.length;

    if (boothWorkerCount <= 0) {
      throw new ApiError(
        409,
        "TICKET_WORKERS_NOT_FOUND",
        `Booth ${ticket.id} does not have a worker snapshot for financialization.`,
      );
    }

    for (const worker of boothWorkers) {
      distinctPaidWorkerIds.add(worker.id);
    }

    for (const product of ticket.products) {
      if (product.confirmedQuantity === null) {
        throw new ApiError(
          409,
          "CONFIRMED_QUANTITY_MISSING",
          `Confirmed quantity is missing for ticket product ${product.id}.`,
        );
      }

      if (!hasCompleteRateSnapshot(product)) {
        throw new ApiError(
          409,
          "TICKET_RATE_SNAPSHOT_INCOMPLETE",
          `Rate snapshot is incomplete for ticket product ${product.id}.`,
        );
      }

      /*
       * TypeScript ยังมอง field เป็น nullable
       * แม้ผ่าน hasCompleteRateSnapshot แล้ว
       * จึงเก็บเป็นตัวแปรหลัง validation
       */
      const stallRate = product.stallRateSnapshot;

      const laborRate = product.laborRateSnapshot;

      if (stallRate === null || laborRate === null) {
        throw new ApiError(
          409,
          "TICKET_RATE_SNAPSHOT_INCOMPLETE",
          `Rate snapshot is incomplete for ticket product ${product.id}.`,
        );
      }

      // คำนวณยอดที่แผงต้องจ่าย
      // ด้วย confirmed quantity เท่านั้น
      const stallCharge = calculateProductStallCharge({
        quantity: product.confirmedQuantity,

        stallRate,

        laborRate,
      });

      // คำนวณเงิน Worker
      // ด้วย Snapshot Worker Count ของแผงนี้โดยเฉพาะ (ไม่ใช่ของทั้ง Ticket)
      const workerPayment = calculateProductWorkerPayment({
        laborFeeRaw: stallCharge.laborFeeRaw,

        actualWorkerCount: boothWorkerCount,
      });

      const workerPayments = boothWorkers.map((worker) => {
        const finalAmount = workerPayment.finalAmountPerWorker;
        const currentTotal =
          finalEarningByTicketWorkerId.get(worker.id) ?? new Prisma.Decimal(0);

        finalEarningByTicketWorkerId.set(
          worker.id,
          currentTotal.plus(finalAmount),
        );

        return {
          ticketWorkerId: worker.id,

          rawAmount: workerPayment.rawAmountPerWorker,

          remainderAmount: workerPayment.remainderAmountPerWorker,

          finalAmount,
        };
      });

      await ticketFinancialRepository.createTicketProductFinancial(
        {
          ticketProductId: product.id,

          confirmedQuantity: product.confirmedQuantity,

          stallFeeRaw: stallCharge.stallFeeRaw,

          stallFeeRounded: stallCharge.stallFeeRounded,

          laborFeeRaw: stallCharge.laborFeeRaw,

          productCharge: stallCharge.productCharge,

          workerCount: boothWorkerCount,

          workerPayoutTotal: workerPayment.workerPayoutTotal,

          fundAmount: workerPayment.fundAmount,

          finalizedAt,

          workerPayments,
        },
        connection,
      );

      // รวมเฉพาะ ProductCharge
      // ที่ผ่านการปัดตาม Method A แล้ว
      finalStallAmount = finalStallAmount.plus(stallCharge.productCharge);
      boothStallAmountByTicketId.set(
        ticket.id,
        (boothStallAmountByTicketId.get(ticket.id) ?? new Prisma.Decimal(0)).plus(
          stallCharge.productCharge,
        ),
      );
    }
  }

  await ticketFinancialRepository.updateTicketWorkerFinalEarningAmounts(
    finalEarningByTicketWorkerId,
    connection,
  );

  // บันทึกยอดรวมแยกรายบูธไว้ประกอบการแสดงผล Admin (ไม่ใช่ guard หลัก)
  for (const [ticketId, boothStallAmount] of boothStallAmountByTicketId) {
    await ticketFinancialRepository.markGateTicketFinancializedInfo(
      ticketId,
      boothStallAmount,
      finalizedAt,
      connection,
    );
  }

  await ticketFinancialRepository.markMarketJobFinancialized(
    context.id,
    finalStallAmount,
    finalizedAt,
    connection,
  );

  return {
    marketJobId: context.id,

    productCount: products.length,

    // จำนวน worker ที่ได้รับเงินจริง (union ของ snapshot ทุกแผงใน Ticket นี้) ไม่ใช่แค่ roster
    // สุดท้ายทั้ง Ticket เพราะแต่ละแผงอาจมีคนละชุดคนที่ยัง active ตอนแผงนั้น confirm
    workerCount: distinctPaidWorkerIds.size,

    finalStallAmount,

    finalizedAt,

    alreadyFinalized: false,
  };
}
