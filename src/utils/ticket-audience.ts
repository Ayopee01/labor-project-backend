import * as workerApplicationRepository from "../repositories/worker.repository";
import { accountRepository } from "../repositories/worker.repository";

import type { DbConnection } from "../types/shared/common.type";
import type { GateTicketDto } from "../types/worker.type";

// Function รวม worker ใน ticket และ admin ทั้งหมดที่ต้องรับ event ผลงาน
export async function buildTicketResultAudience(
  ticket: GateTicketDto,
  connection?: DbConnection
): Promise<number[]> {
  const [ticketWorkers, admins] = await Promise.all([
    workerApplicationRepository.listTicketWorkers(ticket.id, connection),
    accountRepository.listAdmins(connection),
  ]);
  const receiverIds = new Set<number>();

  ticketWorkers.forEach((worker) => receiverIds.add(worker.worker_account_id));
  admins.forEach((admin) => receiverIds.add(admin.id));

  return Array.from(receiverIds);
}
