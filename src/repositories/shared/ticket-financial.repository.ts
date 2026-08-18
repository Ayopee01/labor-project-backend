import { Prisma } from "@prisma/client";

import { VEHICLE_JOB_STATUS, TICKET_WORKER_STATUS } from "../../constants/job-status";
import { client } from "./repository-utils";

import type { DbConnection } from "../../types/shared/common.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึงข้อมูลสำหรับ Finalize การเงินของ Business Ticket (market job) ทั้งใบ
// รวมทุก Booth + Product ที่อยู่ใต้ Ticket นี้ และ Worker Roster ที่ยัง WORKING (ยังไม่ Lock)
export async function findMarketJobFinancializationContext(
  marketJobId: number,
  connection?: DbConnection
) {
  const db = client(connection);

  return db.marketJob.findUnique({
    where: {
      id: marketJobId,
    },
    include: {
      tickets: {
        orderBy: {
          id: "asc",
        },
        include: {
          products: {
            orderBy: {
              id: "asc",
            },
            include: {
              financial: true,
            },
          },
        },
      },
      ticketWorkers: {
        orderBy: {
          id: "asc",
        },
      },
    },
  });
}

// Function Lock Worker Roster ของ Business Ticket แบบ idempotent (no-op ถ้า Lock แล้ว)
// หลัง Lock ห้าม Sync/Cancel/Add Worker เข้า Roster นี้อีก
export async function lockMarketJobWorkerRoster(
  marketJobId: number,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  await db.marketJob.updateMany({
    where: {
      id: marketJobId,
      workerRosterLockedAt: null,
    },
    data: {
      workerRosterLockedAt: new Date(),
    },
  });
}

// Function ปิด Roster: เปลี่ยน Worker ที่ยัง WORKING ของ Business Ticket นี้เป็น COMPLETED
// นี่คือจุดตัดสิน Final Eligible Worker สำหรับหารเงิน worker ที่ถูก Cancel ไปก่อนหน้าจะไม่ถูกแตะ
export async function markMarketJobTicketWorkersCompleted(
  marketJobId: number,
  completedAt: Date,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  await db.ticketWorker.updateMany({
    where: {
      marketJobId,
      status: TICKET_WORKER_STATUS.WORKING,
    },
    data: {
      status: TICKET_WORKER_STATUS.COMPLETED,
      completedAt,
      cancelledAt: null,
    },
  });
}

export async function createTicketProductFinancial(
  input: {
    ticketProductId: number;
    confirmedQuantity: Prisma.Decimal;
    stallFeeRaw: Prisma.Decimal;
    stallFeeRounded: Prisma.Decimal;
    laborFeeRaw: Prisma.Decimal;
    productCharge: Prisma.Decimal;
    workerCount: number;
    workerPayoutTotal: Prisma.Decimal;
    fundAmount: Prisma.Decimal;
    finalizedAt: Date;
    workerPayments: Array<{
      ticketWorkerId: number;
      rawAmount: Prisma.Decimal;
      remainderAmount: Prisma.Decimal;
      finalAmount: Prisma.Decimal;
    }>;
  },
  connection?: DbConnection
) {
  const db = client(connection);

  return db.ticketProductFinancial.create({
    data: {
      ticketProductId: input.ticketProductId,
      confirmedQuantity: input.confirmedQuantity,
      stallFeeRaw: input.stallFeeRaw,
      stallFeeRounded: input.stallFeeRounded,
      laborFeeRaw: input.laborFeeRaw,
      productCharge: input.productCharge,
      workerCount: input.workerCount,
      workerPayoutTotal: input.workerPayoutTotal,
      fundAmount: input.fundAmount,
      finalizedAt: input.finalizedAt,
      workerPayments: {
        create:
          input.workerPayments.map(
            (payment) => ({
              ticketWorkerId: payment.ticketWorkerId,
              rawAmount: payment.rawAmount,
              remainderAmount: payment.remainderAmount,
              finalAmount: payment.finalAmount,
            })
          ),
      },
    },
  });
}

export async function updateTicketWorkerFinalEarningAmounts(
  amountsByTicketWorkerId: Map<number, Prisma.Decimal>,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  for (const [ticketWorkerId, finalEarningAmount] of amountsByTicketWorkerId) {
    await db.ticketWorker.update({
      where: {
        id: ticketWorkerId,
      },
      data: {
        finalEarningAmount,
      },
    });
  }
}

// Function บันทึกยอดเงินของ Booth แบบข้อมูลประกอบ (ไม่ใช่ guard หลัก) สำหรับ Admin ดูรายบูธ
// Guard idempotent ที่แท้จริงอยู่ที่ markMarketJobFinancialized ระดับ Business Ticket
export async function markGateTicketFinancializedInfo(
  ticketId: number,
  finalStallAmount: Prisma.Decimal,
  finalizedAt: Date,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  await db.gateTicket.update({
    where: {
      id: ticketId,
    },
    data: {
      finalStallAmount,
      financializedAt: finalizedAt,
    },
  });
}

// Function บันทึกผล Finalize การเงินของ Business Ticket ทั้งใบแบบ idempotent (guard หลัก)
export async function markMarketJobFinancialized(
  marketJobId: number,
  finalStallAmount: Prisma.Decimal,
  finalizedAt: Date,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);
  const result = await db.marketJob.updateMany({
    where: {
      id: marketJobId,
      financializedAt: null,
    },
    data: {
      finalStallAmount,
      financializedAt: finalizedAt,
      completedAt: finalizedAt,
      status: VEHICLE_JOB_STATUS.COMPLETED,
    },
  });

  if (result.count !== 1) {
    throw new Error(
      "Market job financialization did not update exactly one market job."
    );
  }
}
