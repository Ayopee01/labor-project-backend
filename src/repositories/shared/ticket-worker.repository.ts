// Import Dependencies
import { mapTicketWorker } from "./mappers";
import { client } from "./repository-utils";

// Import Types
import type { DbConnection } from "../../types/shared/common.type";
import type { TicketWorkerDto } from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ดึงรายการ ticket workers จาก DB
export async function listTicketWorkers(
  ticketId: number,
  connection?: DbConnection
): Promise<TicketWorkerDto[]> {
  const db = client(connection);
  const workers = await db.ticketWorker.findMany({
    where: {
      ticketId,
    },
    orderBy: {
      id: "asc",
    },
  });

  return workers
    .map((worker) => mapTicketWorker(worker))
    .filter((worker): worker is TicketWorkerDto => worker !== null);
}
