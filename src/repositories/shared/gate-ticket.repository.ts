import { SCANNED_ASSIGNMENT_STATUSES, TICKET_STATUS, TICKET_WORKER_STATUS } from "../../constants/job-status";
import { mapGateTicket, mapTicketCompletionSubmission, mapTicketProduct } from "./mappers";
import { client, requireDto } from "./repository-utils";

import type { DbConnection } from "../../types/shared/common.type";
import type { GateTicketDto, TicketCompletionSubmissionDto, TicketProductConfirmationInput, TicketProductDto, VendorLineTargetDto } from "../../types/worker.type";

// Class error สำหรับ race ตอน Vendor action ถูก resolve ไปแล้ว
export class TicketSubmissionAlreadyResolvedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketSubmissionAlreadyResolvedError";
  }
}

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจว่า Business Ticket เคยมี Booth ถูกส่งยอดแล้วหรือไม่
export async function hasSubmittedActiveTicketsForMarketJob(
  marketJobId: number,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);
  const count = await db.gateTicket.count({
    where: {
      marketJobId,
      status: {
        in: [TICKET_STATUS.DELIVERED, TICKET_STATUS.REJECT],
      },
    },
  });

  return count > 0;
}

// Function เช็คว่า worker คนนี้ถูกถอดออกจาก Booth นี้แผงเดียวไปแล้วหรือยัง (GateTicketWorkerExclusion)
export async function findGateTicketWorkerExclusion(
  gateTicketId: number,
  ticketWorkerId: number,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);
  const exclusion = await db.gateTicketWorkerExclusion.findUnique({
    where: {
      gateTicketId_ticketWorkerId: {
        gateTicketId,
        ticketWorkerId,
      },
    },
  });

  return exclusion !== null;
}

// Function ถอด worker คนหนึ่งออกจาก Booth หนึ่งแผงเดียว (ไม่แตะ TicketWorker.status) จาก DB — ทำให้
// confirmTicketCompletion ไม่นับ worker คนนี้เป็นตัวหารของ Booth นี้อีกต่อไปตอน snapshot ต่อจากนี้
export async function createGateTicketWorkerExclusion(
  gateTicketId: number,
  ticketWorkerId: number,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  await db.gateTicketWorkerExclusion.create({
    data: {
      gateTicketId,
      ticketWorkerId,
    },
  });
}

export async function findGateTicketForCompletion(
  ticketId: number,
  connection?: DbConnection
): Promise<GateTicketDto | null> {
  const db = client(connection);
  const ticket = await db.gateTicket.findUnique({
    where: {
      id: ticketId,
    },
  });

  return mapGateTicket(ticket);
}

// Function ค้นหา Booth สำหรับส่งยอดโดย scope ด้วย Business Ticket
export async function findGateTicketForCompletionByTicketNumberAndTicketNoAndBoothCode(
  ticketNumber: string,
  ticketNo: string,
  boothCode: string,
  connection?: DbConnection
): Promise<GateTicketDto | null> {
  const db = client(connection);
  const ticket = await db.gateTicket.findFirst({
    where: {
      boothCode,
      marketJob: {
        ticketNo,
      },
      vehicleJob: {
        ticketNumber,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  return mapGateTicket(ticket);
}

// Function ค้นหา Booth สำหรับส่งยอดจาก assignment ปัจจุบันของ Worker
export async function findGateTicketForCompletionByVehicleJobIdAndTicketNoAndBoothCode(
  vehicleJobId: number,
  ticketNo: string,
  boothCode: string,
  connection?: DbConnection
): Promise<GateTicketDto | null> {
  const db = client(connection);
  const ticket = await db.gateTicket.findFirst({
    where: {
      boothCode,
      vehicleJobId,
      marketJob: {
        ticketNo,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  return mapGateTicket(ticket);
}

// Function หา GateTicket จาก ticketNo+boothCode หลัง Worker เคย scan
export async function findGateTicketForCompletionByWorkerHistoryAndTicketNoAndBoothCode(
  workerAccountId: number,
  ticketNo: string,
  boothCode: string,
  connection?: DbConnection
): Promise<GateTicketDto | null> {
  const db = client(connection);
  const ticket = await db.gateTicket.findFirst({
    where: {
      boothCode,
      marketJob: {
        ticketNo,
      },
      vehicleJob: {
        assignments: {
          some: {
            workerAccountId,
            status: {
              in: SCANNED_ASSIGNMENT_STATUSES,
            },
          },
        },
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  return mapGateTicket(ticket);
}

export async function listActiveVendorLineTargetsForTicket(
  ticketId: number,
  connection?: DbConnection
): Promise<VendorLineTargetDto[]> {
  const db = client(connection);
  const ticket = await db.gateTicket.findUnique({
    where: {
      id: ticketId,
    },
    include: {
      marketJob: true,
    },
  });

  if (!ticket) {
    return [];
  }

  return findActiveVendorLineTargetsByMarketAndBooth(
    ticket.marketJob.marketCode,
    ticket.boothCode,
    connection
  );
}

// Function ค้นหา LINE target (owner + member) ของแผงหนึ่งใบ ใช้ร่วมกันทั้งจาก ticketId
// (listActiveVendorLineTargetsForTicket ด้านบน) และจาก marketCode+boothCode ตรงๆ (gate.repository.ts
// ตอน Gate ยังไม่มี ticketId เพราะกำลังจะสร้าง Ticket ใหม่)
export async function findActiveVendorLineTargetsByMarketAndBooth(
  marketCode: string,
  boothCode: string,
  connection?: DbConnection
): Promise<VendorLineTargetDto[]> {
  const db = client(connection);
  const ownerStall = await db.masterOwnerStall.findUnique({
    where: {
      marketCode_boothCode: {
        marketCode,
        boothCode,
      },
    },
  });

  if (
    !ownerStall ||
    ownerStall.status !== "active" ||
    ownerStall.ownerStatus !== "Normal" ||
    !ownerStall.lineUserId
  ) {
    return [];
  }

  const members = await db.masterMemberStall.findMany({
    where: {
      marketCode: ownerStall.marketCode,
      ownerIdCard: ownerStall.cardId,
      ownerLineUserId: ownerStall.lineUserId,
      status: "active",
      memberStallStatusOnStall: "1",
    },
    orderBy: {
      id: "asc",
    },
  });
  const seen = new Set<string>();
  const targets: VendorLineTargetDto[] = [];
  const addTarget = (lineUserId: string, targetType: VendorLineTargetDto["target_type"]) => {
    if (seen.has(lineUserId)) {
      return;
    }

    seen.add(lineUserId);
    targets.push({
      line_user_id: lineUserId,
      target_type: targetType,
    });
  };

  addTarget(ownerStall.lineUserId, "owner");

  for (const member of members) {
    addTarget(member.memberStallLineUserId, "member");
  }

  return targets;
}

export async function listTicketProducts(
  ticketId: number,
  connection?: DbConnection
): Promise<TicketProductDto[]> {
  const db = client(connection);
  const products = await db.ticketProduct.findMany({
    where: {
      ticketId,
    },
    orderBy: {
      id: "asc",
    },
  });

  return products
    .map((product) => mapTicketProduct(product))
    .filter((product): product is TicketProductDto => product !== null);
}

export async function updateTicketProductConfirmations(
  ticketId: number,
  items: TicketProductConfirmationInput[],
  connection?: DbConnection
): Promise<TicketProductDto[]> {
  const db = client(connection);

  for (const item of items) {
    // original_package_code ระบุแถว TicketProduct เดิมที่ Gate เคยประกาศ PackageCode ไว้ — ถ้าไม่ได้
    // เปลี่ยน PackageCode ก็คือ packageCode ตัวเดียวกับที่ส่งมา (พฤติกรรมเดิม)
    const originalPackageCode = item.original_package_code ?? item.packageCode;

    const result =
      await db.ticketProduct.updateMany({
        where: {
          ticketId,
          productCode: item.productCode,
          packageCode: originalPackageCode,
        },
        data: {
          confirmedQuantity: item.confirmed_quantity,
          ...(item.package_switch
            ? {
                packageCode: item.packageCode,
                packageName: item.package_switch.packageName,
                packageWeightSnapshot: item.package_switch.packageWeightSnapshot,
                rateIdSnapshot: item.package_switch.rateIdSnapshot,
                sourceRateIdSnapshot: item.package_switch.sourceRateIdSnapshot,
                rateMarketCode: item.package_switch.rateMarketCode,
                rateSource: item.package_switch.rateSource,
                weightRangeName: item.package_switch.weightRangeName,
                weightMinSnapshot: item.package_switch.weightMinSnapshot,
                weightMaxSnapshot: item.package_switch.weightMaxSnapshot,
                stallRateSnapshot: item.package_switch.stallRateSnapshot,
                laborRateSnapshot: item.package_switch.laborRateSnapshot,
                rateSnapshotAt: item.package_switch.rateSnapshotAt,
              }
            : {}),
        },
      });

    if (result.count !== 1) {
      throw new Error(
        "Ticket product confirmation did not update exactly one product."
      );
    }
  }

  return listTicketProducts(
    ticketId,
    connection
  );
}

export async function markTicketDelivered(
  ticketId: number,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);
  const result = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: {
        in: [TICKET_STATUS.WAIT, TICKET_STATUS.WORKING, TICKET_STATUS.REJECT],
      },
    },
    data: {
      status: TICKET_STATUS.DELIVERED,
      rejectReason: null,
    },
  });

  return result.count === 1;
}

export async function createTicketCompletionSubmission(
  ticketId: number,
  submittedByAccountId: number,
  submittedByRole: string,
  workerCountSnapshot: number,
  assignmentId: number | null,
  connection?: DbConnection
): Promise<TicketCompletionSubmissionDto> {
  const db = client(connection);
  const submission = await db.ticketCompletionSubmission.create({
    data: {
      ticketId,
      submittedByAccountId,
      submittedByRole,
      status: TICKET_STATUS.DELIVERED,
      workerCountSnapshot,
      assignmentId,
    },
  });

  return requireDto(
    mapTicketCompletionSubmission(submission),
    "ticket completion submission create"
  );
}

// Function บันทึก roster ของ TicketWorker ที่ยัง WORKING ณ เวลา Submit จริง ผูกกับ Submission นี้
// เจาะจง — ต้องเรียกทันทีในทรานแซกชันเดียวกับ createTicketCompletionSubmission ด้วย ticketWorkerIds
// ชุดเดียวกับที่ใช้คำนวณ workerCountSnapshot ห้ามคำนวณชุดใหม่ ไม่งั้น count กับ list จะไม่ตรงกัน
export async function createSubmissionWorkerSnapshots(
  submissionId: number,
  ticketWorkerIds: number[],
  connection?: DbConnection
): Promise<void> {
  if (ticketWorkerIds.length === 0) {
    return;
  }

  const db = client(connection);

  await db.submissionWorkerSnapshot.createMany({
    data: ticketWorkerIds.map((ticketWorkerId) => ({
      submissionId,
      ticketWorkerId,
    })),
    skipDuplicates: true,
  });
}

export async function findWaitingTicketCompletionSubmission(
  ticketId: number,
  connection?: DbConnection
): Promise<TicketCompletionSubmissionDto | null> {
  const db = client(connection);
  const submission = await db.ticketCompletionSubmission.findFirst({
    where: {
      ticketId,
      status: TICKET_STATUS.DELIVERED,
    },
    orderBy: {
      id: "desc",
    },
  });

  return mapTicketCompletionSubmission(submission);
}

// Function หา Booth ที่ค้าง DELIVERED สำหรับ startup recovery
export async function listDeliveredTicketsWithLatestSubmission(
  connection?: DbConnection
): Promise<Array<{ ticket: GateTicketDto; submission: TicketCompletionSubmissionDto }>> {
  const db = client(connection);
  const tickets = await db.gateTicket.findMany({
    where: {
      status: TICKET_STATUS.DELIVERED,
    },
    include: {
      completionSubmissions: {
        where: {
          status: TICKET_STATUS.DELIVERED,
        },
        orderBy: {
          id: "desc",
        },
        take: 1,
      },
    },
  });

  const results: Array<{ ticket: GateTicketDto; submission: TicketCompletionSubmissionDto }> = [];

  for (const ticket of tickets) {
    const mappedTicket = mapGateTicket(ticket);
    const mappedSubmission = mapTicketCompletionSubmission(ticket.completionSubmissions[0] ?? null);

    if (mappedTicket && mappedSubmission) {
      results.push({ ticket: mappedTicket, submission: mappedSubmission });
    }
  }

  return results;
}

export async function findTicketCompletionSubmissionById(
  submissionId: number,
  connection?: DbConnection
): Promise<TicketCompletionSubmissionDto | null> {
  const db = client(connection);
  const submission = await db.ticketCompletionSubmission.findUnique({
    where: {
      id: submissionId,
    },
  });

  return mapTicketCompletionSubmission(submission);
}

export async function confirmTicketCompletion(
  ticketId: number,
  submissionId: number,
  connection?: DbConnection,
  resolvedByLineUserId?: string | null
): Promise<{
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
}> {
  const db = client(connection);
  const completedAt = new Date();
  const updateResult = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: TICKET_STATUS.DELIVERED,
    },
    data: {
      status: TICKET_STATUS.COMPLETED,
      completedAt,
    },
  });

  if (updateResult.count !== 1) {
    throw new TicketSubmissionAlreadyResolvedError(
      "Ticket confirm did not update a waiting ticket.",
    );
  }

  // หมายเหตุ: TicketWorker (roster ของ Business Ticket) ไม่ถูกแตะที่นี่อีกต่อไป
  // การปิด Roster เป็น COMPLETED เกิดเฉพาะตอน Lock ที่ finalizeMarketJobFinancials
  // เพราะ Business Ticket หนึ่งอาจมีหลาย Booth และ Booth นี้เป็นเพียงใบเดียวที่จบ

  const [ticket, submission] = await Promise.all([
    db.gateTicket.findUnique({
      where: {
        id: ticketId,
      },
    }),
    db.ticketCompletionSubmission.update({
      where: {
        id: submissionId,
      },
      data: {
        status: TICKET_STATUS.COMPLETED,
        confirmedAt: new Date(),
        resolvedByLineUserId: resolvedByLineUserId ?? null,
      },
    }),
  ]);

  if (ticket) {
    // Format snapshot Worker ที่ใช้หารเงินของแผงนี้
    const workingWorkers = await db.ticketWorker.findMany({
      where: {
        marketJobId: ticket.marketJobId,
        status: TICKET_WORKER_STATUS.WORKING,
        boothExclusions: {
          none: {
            gateTicketId: ticketId,
          },
        },
      },
      select: {
        id: true,
      },
    });

    if (workingWorkers.length > 0) {
      await db.gateTicketWorkerSnapshot.createMany({
        data: workingWorkers.map((worker) => ({
          gateTicketId: ticketId,
          ticketWorkerId: worker.id,
        })),
        skipDuplicates: true,
      });
    }
  }

  return {
    ticket: requireDto(mapGateTicket(ticket), "ticket confirm"),
    submission: requireDto(
      mapTicketCompletionSubmission(submission),
      "ticket submission confirm"
    ),
  };
}

export async function rejectTicketCompletion(
  ticketId: number,
  submissionId: number,
  rejectReason?: string | null,
  connection?: DbConnection,
  resolvedByLineUserId?: string | null
): Promise<{
  ticket: GateTicketDto;
  submission: TicketCompletionSubmissionDto;
}> {
  const db = client(connection);
  const updateResult = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: TICKET_STATUS.DELIVERED,
    },
    data: {
      status: TICKET_STATUS.REJECT,
      rejectReason: rejectReason ?? null,
    },
  });

  if (updateResult.count !== 1) {
    throw new TicketSubmissionAlreadyResolvedError(
      "Ticket reject did not update a waiting ticket.",
    );
  }

  const [ticket, submission] = await Promise.all([
    db.gateTicket.findUnique({
      where: {
        id: ticketId,
      },
    }),
    db.ticketCompletionSubmission.update({
      where: {
        id: submissionId,
      },
      data: {
        status: TICKET_STATUS.REJECT,
        rejectedAt: new Date(),
        rejectReason: rejectReason ?? null,
        resolvedByLineUserId: resolvedByLineUserId ?? null,
      },
    }),
  ]);

  return {
    ticket: requireDto(mapGateTicket(ticket), "ticket reject"),
    submission: requireDto(
      mapTicketCompletionSubmission(submission),
      "ticket submission reject"
    ),
  };
}
