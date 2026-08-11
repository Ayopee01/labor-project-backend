import { TICKET_STATUS, TICKET_WORKER_STATUS } from "../../constants/job-status";
import {
  mapGateTicket,
  mapTicketCompletionSubmission,
  mapTicketProduct,
} from "./mappers";
import { client, requireDto } from "./repository-utils";

import type { DbConnection } from "../../types/shared/common.type";
import type {
  GateTicketDto,
  TicketCompletionSubmissionDto,
  TicketProductConfirmationInput,
  TicketProductDto,
  VendorLineTargetDto,
} from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

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

export async function findGateTicketForCompletionByTicketNoAndBoothCode(
  ticketNo: string,
  boothCode: string,
  connection?: DbConnection
): Promise<GateTicketDto | null> {
  const db = client(connection);
  const ticket = await db.gateTicket.findFirst({
    where: {
      boothCode,
      vehicleJob: {
        ticketNo,
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

  const ownerStall = await db.masterOwnerStall.findUnique({
    where: {
      marketCode_boothCode: {
        marketCode: ticket.marketJob.marketCode,
        boothCode: ticket.boothCode,
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
    const result =
      await db.ticketProduct.updateMany({
        where: {
          ticketId,
          productCode: item.productCode,
          packageCode: item.packageCode,
        },
        data: {
          confirmedQuantity: item.confirmed_quantity,
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
  workerAccountId: number,
  connection?: DbConnection
): Promise<TicketCompletionSubmissionDto> {
  const db = client(connection);
  const submission = await db.ticketCompletionSubmission.create({
    data: {
      ticketId,
      submittedByWorkerAccountId: workerAccountId,
      status: TICKET_STATUS.DELIVERED,
    },
  });

  return requireDto(
    mapTicketCompletionSubmission(submission),
    "ticket completion submission create"
  );
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
  const updateResult = await db.gateTicket.updateMany({
    where: {
      id: ticketId,
      status: TICKET_STATUS.DELIVERED,
    },
    data: {
      status: TICKET_STATUS.COMPLETED,
    },
  });

  if (updateResult.count !== 1) {
    throw new Error("Ticket confirm did not update a waiting ticket.");
  }

  const completedAt = new Date();

  await db.ticketWorker.updateMany({
    where: {
      ticketId,
      status: TICKET_WORKER_STATUS.WORKING,
    },
    data: {
      status: TICKET_WORKER_STATUS.COMPLETED,
      completedAt,
      cancelledAt: null,
    },
  });

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
    throw new Error("Ticket reject did not update a waiting ticket.");
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
