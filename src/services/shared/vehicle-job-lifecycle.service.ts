import { ACTIVE_ASSIGNMENT_STATUSES, TERMINAL_JOB_STATUSES, TERMINAL_TICKET_STATUSES, TICKET_STATUS, VEHICLE_JOB_STATUS } from "../../constants/job-status";
import { withTransaction } from "../../db/prisma";
import { WORKER_ASSIGNMENT_EVENT_TYPE } from "../../types/shared/worker-assignment-event.type";
import * as driverRepository from "../../repositories/driver.repository";
import * as ticketWorkerRepository from "../../repositories/shared/ticket-worker.repository";
import * as assignmentRepository from "../../repositories/shared/vehicle-job-assignment.repository";
import * as vehicleJobRepository from "../../repositories/shared/vehicle-job.repository";
import * as workerAssignmentEventRepository from "../../repositories/shared/worker-assignment-event.repository";
import { finalizeMarketJobFinancials } from "./ticket-financial.service";

import type { DbConnection } from "../../types/shared/common.type";
import type { CompletedVehicleJobResult, CurrentTicketProgressDto, VehicleJobDto } from "../../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function Sync Worker Roster ของทุก Business Ticket ที่ยัง Active และยังไม่ Lock ของ TicketNumber
// นี้ ให้ตรงกับทีม Worker ปัจจุบัน เรียกทุกครั้งที่ทีมของ TicketNumber เปลี่ยน (Ticket ใหม่มา,
// Worker accept/scan ใหม่) เพื่อให้สมาชิกใหม่ถูกเพิ่มเข้า Ticket อื่นที่ยังเปิดอยู่ด้วย ไม่ใช่แค่
// Ticket ที่เพิ่ง Activate
async function syncAllOpenMarketJobRosters(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<void> {
  const vehicleJob = await vehicleJobRepository.findVehicleJobLifecycleState(
    vehicleJobId,
    connection,
  );

  if (!vehicleJob) {
    return;
  }

  const openMarketJobs = vehicleJob.marketJobs.filter(
    (market) =>
      !TERMINAL_JOB_STATUSES.includes(market.status) &&
      market.workerRosterLockedAt === null,
  );

  for (const market of openMarketJobs) {
    await ticketWorkerRepository.syncTicketWorkersFromVehicleAssignments(
      market.id,
      vehicleJobId,
      connection,
    );
  }
}

export async function activateNextTicketIfReady(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<CurrentTicketProgressDto | null> {
  const current = await vehicleJobRepository.findCurrentOpenTicketByVehicleJob(
    vehicleJobId,
    connection,
  );

  if (!current) {
    return null;
  }

  await vehicleJobRepository.updateMarketJobStatus(
    current.ticket.market_job_id,
    VEHICLE_JOB_STATUS.WORKING,
    connection,
  );

  const activatableTicketStatuses: string[] = [TICKET_STATUS.WAIT];

  if (!activatableTicketStatuses.includes(current.ticket.status)) {
    await syncAllOpenMarketJobRosters(vehicleJobId, connection);

    return current;
  }

  const ticket = await vehicleJobRepository.updateGateTicketStatus(
    current.ticket.id,
    TICKET_STATUS.WORKING,
    connection,
  );

  await syncAllOpenMarketJobRosters(vehicleJobId, connection);

  return {
    ...current,
    ticket,
  };
}

export async function markVehicleJobInProgress(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<VehicleJobDto> {
  const vehicleJob = await vehicleJobRepository.markVehicleJobInProgress(
    vehicleJobId,
    connection,
  );

  await activateNextTicketIfReady(vehicleJobId, connection);

  return vehicleJob;
}

export async function closeCompletedVehicleJobIfReady(
  vehicleJobId: number,
  connection?: DbConnection,
): Promise<CompletedVehicleJobResult | null> {
  if (!connection) {
    return withTransaction((transaction) =>
      closeCompletedVehicleJobIfReady(vehicleJobId, transaction),
    );
  }

  // Lock แถว VehicleJob นี้ไว้ก่อนอ่านสถานะ Booth ทั้งหมด — กัน Race ตอนที่ 2 Booth สุดท้ายของ
  // Business Ticket เดียวกัน (หรือ Business Ticket คนละใบของ VehicleJob เดียวกัน) จบพร้อมกันคนละ
  // Transaction ภายใต้ READ COMMITTED โดยไม่มี Lock ทั้ง 2 Transaction จะอ่านเห็น "ยังไม่ครบ" พร้อม
  // กันแล้วไม่มีใคร Finalize การเงินเลยแม้ Booth จะครบจริงหลัง Commit ทั้งคู่ — การ Lock นี้บังคับให้
  // Transaction ที่มาทีหลังต้องรอ Transaction แรก Commit ก่อน แล้วอ่านเห็นผลลัพธ์ล่าสุดเสมอ
  await connection.$queryRaw`SELECT id FROM vehicle_jobs WHERE id = ${vehicleJobId} FOR UPDATE`;

  const vehicleJob = await vehicleJobRepository.findVehicleJobLifecycleState(
    vehicleJobId,
    connection,
  );

  if (!vehicleJob) {
    return null;
  }

  for (const market of vehicleJob.marketJobs) {
    const allTicketsTerminal =
      market.tickets.length > 0 &&
      market.tickets.every((ticket) =>
        TERMINAL_TICKET_STATUSES.includes(ticket.status),
      );

    if (allTicketsTerminal && !TERMINAL_JOB_STATUSES.includes(market.status)) {
      const allCancelled = market.tickets.every(
        (ticket) => ticket.status === TICKET_STATUS.CANCELLED,
      );

      if (allCancelled) {
        await vehicleJobRepository.updateMarketJobStatus(
          market.id,
          VEHICLE_JOB_STATUS.CANCELLED,
          connection,
        );
      } else {
        // อย่างน้อยหนึ่ง Booth COMPLETED และทุก Booth Terminal แล้ว
        // -> Lock Roster และ Finalize การเงินของ Business Ticket นี้ทั้งใบ
        // (finalizeMarketJobFinancials จะเซ็ต MarketJob.status = COMPLETED เอง)
        await finalizeMarketJobFinancials(market.id, connection);
      }
    }
  }

  const refreshedVehicleJob =
    await vehicleJobRepository.findVehicleJobLifecycleState(
      vehicleJobId,
      connection,
    );

  if (!refreshedVehicleJob) {
    return null;
  }

  // TicketNumber จบได้ก็ต่อเมื่อทุก Business Ticket ที่มีอยู่ Terminal ครบ
  // "และ" Gate ยืนยันแล้วว่าไม่มี Business Ticket เพิ่มเข้ามาอีก (ticketsClosedAt)
  // ห้ามใช้แค่ "Ticket ที่เห็นตอนนี้ครบ" เพราะ Gate อาจยังส่ง Ticket ใหม่มาอีกก็ได้
  const isVehicleComplete =
    refreshedVehicleJob.ticketsClosedAt !== null &&
    refreshedVehicleJob.marketJobs.length > 0 &&
    refreshedVehicleJob.marketJobs.every(
      (market) =>
        TERMINAL_JOB_STATUSES.includes(market.status) &&
        market.tickets.length > 0 &&
        market.tickets.every((ticket) =>
          TERMINAL_TICKET_STATUSES.includes(ticket.status),
        ),
    );

  if (!isVehicleComplete) {
    return null;
  }

  const vehicleStatus = refreshedVehicleJob.marketJobs.every(
    (market) => market.status === VEHICLE_JOB_STATUS.CANCELLED,
  )
    ? VEHICLE_JOB_STATUS.CANCELLED
    : VEHICLE_JOB_STATUS.COMPLETED;
  const wasAlreadyTerminal = TERMINAL_JOB_STATUSES.includes(
    refreshedVehicleJob.status,
  );
  const vehicleJobDto = wasAlreadyTerminal
    ? await vehicleJobRepository.findVehicleJobById(vehicleJobId, connection)
    : await vehicleJobRepository.updateVehicleJobStatus(
        vehicleJobId,
        vehicleStatus,
        connection,
      );

  if (!wasAlreadyTerminal) {
    // เพิกถอน driver session ที่ยัง active ทั้งหมดของรถคันนี้ทันทีที่ TicketNumber จบ (COMPLETED/CANCELLED)
    // เพราะคนขับไม่จำเป็นต้องเปิดหน้า driver ต่อแล้ว ลดอายุของ token ที่ยังใช้ได้โดยไม่จำเป็น
    await driverRepository.revokeDriverSessionsByVehicleJobId(
      vehicleJobId,
      connection,
    );
  }
  const activeAssignments = refreshedVehicleJob.assignments.filter(
    (assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status),
  );
  const completedAssignmentIds = activeAssignments.map(
    (assignment) => assignment.id,
  );
  const completedWorkerAccountIds = activeAssignments.map(
    (assignment) => assignment.workerId,
  );

  if (completedAssignmentIds.length > 0) {
    const completedAt = new Date();

    await assignmentRepository.completeAssignments(
      completedAssignmentIds,
      completedAt,
      connection,
    );
    await workerAssignmentEventRepository.createManyOnce(
      activeAssignments.map((assignment) => ({
        assignment_id: assignment.id,
        worker_id: assignment.workerId,
        vehicle_job_id: assignment.vehicleJobId,
        event_type: WORKER_ASSIGNMENT_EVENT_TYPE.COMPLETED,
        occurred_at: completedAt,
      })),
      connection,
    );
  }

  return vehicleJobDto
    ? {
        vehicle_job: vehicleJobDto,
        completed_assignment_ids: completedAssignmentIds,
        completed_worker_ids: completedWorkerAccountIds,
      }
    : null;
}
