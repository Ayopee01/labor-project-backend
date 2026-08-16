import { Prisma } from "@prisma/client";

import { TICKET_STATUS, TICKET_WORKER_STATUS } from "../../constants/job-status";
import { client } from "./repository-utils";

import type { DbConnection } from "../../types/shared/common.type";

/* -------------------------------------- Functions -------------------------------------- */

export async function findTicketFinancializationContext(
  ticketId: number,
  connection?: DbConnection
) {
  const db = client(connection);

  return db.gateTicket.findUnique({
    where: {
      id: ticketId,
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
      workers: {
        where: {
          status: TICKET_WORKER_STATUS.COMPLETED,
        },
        orderBy: {
          id: "asc",
        },
      },
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

export async function markGateTicketFinancialized(
  ticketId: number,
  finalStallAmount: Prisma.Decimal,
  finalizedAt: Date,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);
  const result =
    await db.gateTicket.updateMany({
      where: {
        id: ticketId,
        status: TICKET_STATUS.COMPLETED,
        financializedAt: null,
      },
      data: {
        finalStallAmount,
        financializedAt: finalizedAt,
      },
    });

  if (result.count !== 1) {
    throw new Error(
      "Gate ticket financialization did not update exactly one ticket."
    );
  }
}
