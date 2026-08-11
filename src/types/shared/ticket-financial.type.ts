import type { Prisma } from "@prisma/client";

export type TicketFinancializationResult = {
  ticketId: number;
  productCount: number;
  workerCount: number;
  finalStallAmount: Prisma.Decimal;
  finalizedAt: Date;
  alreadyFinalized: boolean;
};
