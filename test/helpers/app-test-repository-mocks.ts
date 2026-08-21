import { Prisma } from "@prisma/client";
import { state } from "./app-test-state";
import {
  activateNextTicketForVehicleJob,
  findCurrentOpenTicketForVehicleJob,
  recordWorkerAssignmentEventOnce,
} from "./app-test-fixtures";
import type {
  AccountRecord,
  AssignmentRecord,
  GateClientRecord,
  GateTicketRecord,
  TicketWorkerRecord,
} from "./app-test-harness.records";

const ACTIVE_ASSIGNMENT_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "SCANNED",
  "WORKING",
  "DELIVERED",
  "REJECT",
];
const WORKING_ASSIGNMENT_STATUSES = [
  "SCANNED",
  "WORKING",
  "DELIVERED",
  "REJECT",
];
const SCANNED_ASSIGNMENT_STATUSES = [
  "SCANNED",
  "WORKING",
  "DELIVERED",
  "REJECT",
  "COMPLETED",
];
const FINISHED_ASSIGNMENT_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "SCANNED",
  "WORKING",
  "DELIVERED",
  "REJECT",
  "COMPLETED",
  "RELEASED",
];
const RELEASABLE_ASSIGNMENT_STATUSES = ["SCANNED", "WORKING", "DELIVERED"];

/* -------------------------------------- Repository Mocks -------------------------------------- */

export const workerApplicationRepositoryMock = {
  accountRepository: {
    findById: async (accountId: number) =>
      state.authAccountsById.get(accountId) ?? null,
    findUserById: async (accountId: number) =>
      state.workers.get(accountId) ?? null,
    listByIds: async (accountIds: number[]) =>
      accountIds
        .map((accountId) => state.authAccountsById.get(accountId) ?? null)
        .filter(
          (account): account is NonNullable<typeof account> => account !== null,
        ),
    listAdmins: async () => [],
    listActiveWorkersByUsernames: async (usernames: string[]) =>
      Array.from(state.authAccountsById.values()).filter(
        (account) =>
          account.role === "worker" &&
          account.status === "active" &&
          usernames.includes(account.username),
      ),
  },
  profileRepository: {
    findByAccountId: async (accountId: number) =>
      state.profiles.get(accountId) ?? null,
    findByAccountIds: async (accountIds: number[]) =>
      accountIds
        .map((accountId) => state.profiles.get(accountId) ?? null)
        .filter(
          (profile): profile is NonNullable<typeof profile> => profile !== null,
        ),
    findWorkerCodeByAccountId: async (accountId: number) =>
      (state.profiles.get(accountId) as { worker_code?: string } | undefined)
        ?.worker_code ?? null,
    findWorkerCodeMapByAccountIds: async (accountIds: number[]) =>
      new Map(
        accountIds.map((accountId) => [
          accountId,
          (
            state.profiles.get(accountId) as
              { worker_code?: string } | undefined
          )?.worker_code ?? null,
        ]),
      ),
    findWorkerCodesByAccountIds: async (accountIds: number[]) =>
      accountIds.map(
        (accountId) =>
          (
            state.profiles.get(accountId) as
              { worker_code?: string } | undefined
          )?.worker_code ?? null,
      ),
  },
  workScheduleRepository: {
    findCurrentByAccountId: async (accountId: number) =>
      state.schedules.get(accountId) ?? null,
    findById: async (scheduleId: number) =>
      Array.from(state.schedules.values()).find(
        (schedule) => (schedule as { id?: number }).id === scheduleId,
      ) ?? null,
  },
  workerShiftAttendanceRepository: {
    findByWorkerAndShift: async (input: {
      account_id: number;
      shift_instance_key: string;
    }) =>
      state.shiftAttendances.find(
        (attendance) =>
          attendance.accountId === input.account_id &&
          attendance.shiftInstanceKey === input.shift_instance_key,
      ) ?? null,
    markWorkerShiftOnline: async (input: {
      account_id: number;
      worker_code: string;
      shift_instance_key: string;
      schedule: {
        shift_no: number;
        shift_start_time: string;
        shift_end_time: string;
      };
    }) => {
      const now = new Date().toISOString();
      let attendance = state.shiftAttendances.find(
        (item) =>
          item.accountId === input.account_id &&
          item.shiftInstanceKey === input.shift_instance_key,
      );

      if (!attendance) {
        attendance = {
          id: state.nextShiftAttendanceId++,
          accountId: input.account_id,
          workerCode: input.worker_code,
          shiftInstanceKey: input.shift_instance_key,
          shiftNo: input.schedule.shift_no,
          shiftStartTime: input.schedule.shift_start_time,
          shiftEndTime: input.schedule.shift_end_time,
          firstOnlineAt: now,
          lastOnlineAt: now,
          offlineAt: null,
          closedAt: null,
          closeReason: null,
          acceptTimeoutStreak: 0,
          lastAcceptTimeoutAt: null,
          createdAt: now,
          updatedAt: now,
        };
        state.shiftAttendances.push(attendance);
      } else {
        attendance.workerCode = input.worker_code;
        attendance.shiftNo = input.schedule.shift_no;
        attendance.shiftStartTime = input.schedule.shift_start_time;
        attendance.shiftEndTime = input.schedule.shift_end_time;
        attendance.lastOnlineAt = now;
        attendance.updatedAt = now;
      }

      return attendance;
    },
    incrementAcceptTimeoutStreak: async (input: {
      account_id: number;
      worker_code: string;
      shift_instance_key: string;
      schedule: {
        shift_no: number;
        shift_start_time: string;
        shift_end_time: string;
      };
    }) => {
      const now = new Date().toISOString();
      let attendance = state.shiftAttendances.find(
        (item) =>
          item.accountId === input.account_id &&
          item.shiftInstanceKey === input.shift_instance_key,
      );

      if (!attendance) {
        attendance = {
          id: state.nextShiftAttendanceId++,
          accountId: input.account_id,
          workerCode: input.worker_code,
          shiftInstanceKey: input.shift_instance_key,
          shiftNo: input.schedule.shift_no,
          shiftStartTime: input.schedule.shift_start_time,
          shiftEndTime: input.schedule.shift_end_time,
          firstOnlineAt: now,
          lastOnlineAt: now,
          offlineAt: null,
          closedAt: null,
          closeReason: null,
          acceptTimeoutStreak: 1,
          lastAcceptTimeoutAt: now,
          createdAt: now,
          updatedAt: now,
        };
        state.shiftAttendances.push(attendance);

        return attendance;
      }

      attendance.workerCode = input.worker_code;
      attendance.shiftNo = input.schedule.shift_no;
      attendance.shiftStartTime = input.schedule.shift_start_time;
      attendance.shiftEndTime = input.schedule.shift_end_time;
      attendance.acceptTimeoutStreak += 1;
      attendance.lastAcceptTimeoutAt = now;
      attendance.updatedAt = now;

      return attendance;
    },
    resetAcceptTimeoutStreak: async (input: {
      account_id: number;
      worker_code: string;
      shift_instance_key: string;
      schedule: {
        shift_no: number;
        shift_start_time: string;
        shift_end_time: string;
      };
    }) => {
      const now = new Date().toISOString();
      let attendance = state.shiftAttendances.find(
        (item) =>
          item.accountId === input.account_id &&
          item.shiftInstanceKey === input.shift_instance_key,
      );

      if (!attendance) {
        attendance = {
          id: state.nextShiftAttendanceId++,
          accountId: input.account_id,
          workerCode: input.worker_code,
          shiftInstanceKey: input.shift_instance_key,
          shiftNo: input.schedule.shift_no,
          shiftStartTime: input.schedule.shift_start_time,
          shiftEndTime: input.schedule.shift_end_time,
          firstOnlineAt: now,
          lastOnlineAt: now,
          offlineAt: null,
          closedAt: null,
          closeReason: null,
          acceptTimeoutStreak: 0,
          lastAcceptTimeoutAt: null,
          createdAt: now,
          updatedAt: now,
        };
        state.shiftAttendances.push(attendance);

        return attendance;
      }

      attendance.workerCode = input.worker_code;
      attendance.shiftNo = input.schedule.shift_no;
      attendance.shiftStartTime = input.schedule.shift_start_time;
      attendance.shiftEndTime = input.schedule.shift_end_time;
      attendance.acceptTimeoutStreak = 0;
      attendance.lastAcceptTimeoutAt = null;
      attendance.updatedAt = now;

      return attendance;
    },
    closeWorkerShift: async (input: {
      account_id: number;
      worker_code: string;
      shift_instance_key: string;
      schedule: {
        shift_no: number;
        shift_start_time: string;
        shift_end_time: string;
      };
      reason: string;
    }) => {
      const now = new Date().toISOString();
      let attendance = state.shiftAttendances.find(
        (item) =>
          item.accountId === input.account_id &&
          item.shiftInstanceKey === input.shift_instance_key,
      );

      if (attendance?.closedAt) {
        return attendance;
      }

      if (!attendance) {
        attendance = {
          id: state.nextShiftAttendanceId++,
          accountId: input.account_id,
          workerCode: input.worker_code,
          shiftInstanceKey: input.shift_instance_key,
          shiftNo: input.schedule.shift_no,
          shiftStartTime: input.schedule.shift_start_time,
          shiftEndTime: input.schedule.shift_end_time,
          firstOnlineAt: null,
          lastOnlineAt: null,
          offlineAt: now,
          closedAt: now,
          closeReason: input.reason,
          acceptTimeoutStreak: 0,
          lastAcceptTimeoutAt: null,
          createdAt: now,
          updatedAt: now,
        };
        state.shiftAttendances.push(attendance);

        return attendance;
      }

      attendance.workerCode = input.worker_code;
      attendance.shiftNo = input.schedule.shift_no;
      attendance.shiftStartTime = input.schedule.shift_start_time;
      attendance.shiftEndTime = input.schedule.shift_end_time;
      attendance.offlineAt = now;
      attendance.closedAt = now;
      attendance.closeReason = input.reason;
      attendance.updatedAt = now;

      return attendance;
    },
  },
  listDispatchableVehicleJobs: async () =>
    state.vehicleJobs.filter((job) => job.status === "WORKING"),
  countActiveAssignments: async (vehicleJobId: number) =>
    state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
        ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status),
    ).length,
  createAssignment: async (
    vehicleJobId: number,
    workerAccountId: number,
    acceptDeadlineAt: Date,
    _connection?: unknown,
  ) => {
    const now = new Date().toISOString();
    const assignment = {
      id: state.nextAssignmentId++,
      vehicle_job_id: vehicleJobId,
      worker_account_id: workerAccountId,
      status: "PENDING",
      accept_deadline_at: acceptDeadlineAt.toISOString(),
      scan_deadline_at: null,
      accepted_at: null,
      scanned_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    };

    state.assignments.push(assignment);
    recordWorkerAssignmentEventOnce(
      assignment,
      "ASSIGNED",
      null,
      assignment.created_at,
    );

    return assignment;
  },
  findAssignmentById: async (assignmentId: number) =>
    state.assignments.find((assignment) => assignment.id === assignmentId) ??
    null,
  findAssignmentByIdAndWorker: async (
    assignmentId: number,
    workerAccountId: number,
  ) =>
    state.assignments.find(
      (assignment) =>
        assignment.id === assignmentId &&
        assignment.worker_account_id === workerAccountId,
    ) ?? null,
  findCurrentAssignmentByVehicleJobRefAndWorker: async (
    ticketNumber: string,
    workerAccountId: number,
  ) => {
    const job = state.vehicleJobs.find(
      (vehicleJob) => vehicleJob.ticket_number === ticketNumber,
    );

    if (!job) {
      return null;
    }

    return (
      [...state.assignments]
        .reverse()
        .find(
          (assignment) =>
            assignment.vehicle_job_id === job.id &&
            assignment.worker_account_id === workerAccountId &&
            ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status),
        ) ?? null
    );
  },
  findCurrentAssignmentByWorker: async (workerAccountId: number) =>
    state.assignments.find(
      (assignment) =>
        assignment.worker_account_id === workerAccountId &&
        ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status),
    ) ?? null,
  timeoutAssignment: async (
    assignmentId: number,
    eventType = "ACCEPT_TIMEOUT",
  ) => {
    const assignment = state.assignments.find(
      (item) => item.id === assignmentId,
    );

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    assignment.status = "TIMEOUT";
    assignment.updated_at = new Date().toISOString();
    recordWorkerAssignmentEventOnce(
      assignment,
      eventType,
      null,
      assignment.updated_at,
    );
    return assignment;
  },
  acceptAssignment: async (assignmentId: number, scanDeadlineAt: Date) => {
    const assignment = state.assignments.find(
      (item) => item.id === assignmentId,
    );

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    assignment.status = "ACCEPTED";
    assignment.scan_deadline_at = scanDeadlineAt.toISOString();
    assignment.accepted_at = new Date().toISOString();
    assignment.updated_at = assignment.accepted_at;
    recordWorkerAssignmentEventOnce(
      assignment,
      "ACCEPTED",
      null,
      assignment.accepted_at,
    );
    return assignment;
  },
  listAcceptedAssignmentsByVehicleJob: async (
    vehicleJobId: number,
    excludedAssignmentId?: number,
  ) =>
    state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
        assignment.status === "ACCEPTED" &&
        assignment.id !== excludedAssignmentId,
    ),
  updateAssignmentScanDeadline: async (
    assignmentId: number,
    scanDeadlineAt: Date,
  ) => {
    const assignment = state.assignments.find(
      (item) => item.id === assignmentId,
    );

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    assignment.scan_deadline_at = scanDeadlineAt.toISOString();
    assignment.updated_at = new Date().toISOString();
    return assignment;
  },
  findVehicleJobById: async (vehicleJobId: number) =>
    state.vehicleJobs.find((job) => job.id === vehicleJobId) ?? null,
  findVehicleJobByRef: async (ticketNumber: string) =>
    state.vehicleJobs.find((job) => job.ticket_number === ticketNumber) ?? null,
  scanAssignment: async (assignmentId: number) => {
    const assignment = state.assignments.find(
      (item) => item.id === assignmentId,
    );

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    assignment.status = "SCANNED";
    assignment.scanned_at = new Date().toISOString();
    assignment.updated_at = assignment.scanned_at;
    recordWorkerAssignmentEventOnce(
      assignment,
      "SCANNED",
      null,
      assignment.scanned_at,
    );
    return assignment;
  },
  countScannedAssignments: async (vehicleJobId: number) =>
    state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
        WORKING_ASSIGNMENT_STATUSES.includes(assignment.status),
    ).length,
  listVehicleJobAssignmentTeam: async (vehicleJobId: number) =>
    state.assignments
      .filter(
        (assignment) =>
          assignment.vehicle_job_id === vehicleJobId &&
          FINISHED_ASSIGNMENT_STATUSES.includes(assignment.status),
      )
      .map((assignment) => {
        const worker =
          state.workers.get(assignment.worker_account_id) ??
          state.authAccountsById.get(assignment.worker_account_id);
        const profile = state.profiles.get(assignment.worker_account_id) as
          { worker_code?: string; image_url?: string | null } | undefined;
        const scanStatus =
          assignment.status === "COMPLETED" || assignment.completed_at
            ? "completed"
            : WORKING_ASSIGNMENT_STATUSES.includes(assignment.status) ||
                assignment.scanned_at
              ? "scanned"
              : assignment.status === "ACCEPTED" || assignment.accepted_at
                ? "accepted"
                : "pending";

        return {
          worker_account_id: assignment.worker_account_id,
          full_name:
            worker?.full_name ?? `Worker ${assignment.worker_account_id}`,
          worker_code: profile?.worker_code ?? null,
          shirt_number: worker?.shirt_number ?? null,
          image_url: profile?.image_url ?? null,
          scan_status: scanStatus,
          accepted_at: assignment.accepted_at ?? null,
          scanned_at: assignment.scanned_at ?? null,
        };
      }),
  markVehicleJobInProgress: async (vehicleJobId: number) => {
    const job = state.vehicleJobs.find((item) => item.id === vehicleJobId);

    if (!job) {
      throw new Error("Vehicle job not found.");
    }

    job.status = "WORKING";
    return job;
  },
  findCurrentOpenTicketByVehicleJob: async (vehicleJobId: number) =>
    findCurrentOpenTicketForVehicleJob(vehicleJobId),
  updateMarketJobStatus: async (marketJobId: number, status: string) => {
    const marketJob = state.marketJobs.find((item) => item.id === marketJobId);

    if (marketJob) {
      marketJob.status = status;
      marketJob.updated_at = new Date().toISOString();
    }
  },
  updateGateTicketStatus: async (ticketId: number, status: string) => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);

    if (!ticket) {
      throw new Error("Gate ticket not found.");
    }

    ticket.status = status;
    return ticket;
  },
  findVehicleJobLifecycleState: async (vehicleJobId: number) => {
    const job = state.vehicleJobs.find((item) => item.id === vehicleJobId);

    if (!job) {
      return null;
    }

    const marketJobs = state.marketJobs.filter(
      (market) => market.vehicle_job_id === vehicleJobId,
    );

    return {
      id: job.id,
      ticketNumber: job.ticket_number,
      status: job.status,
      ticketsClosedAt: job.tickets_closed_at ?? null,
      marketJobs: marketJobs.map((market) => ({
        id: market.id,
        status: market.status,
        workerRosterLockedAt: market.worker_roster_locked_at,
        tickets: state.gateTickets.filter(
          (ticket) => ticket.market_job_id === market.id,
        ),
      })),
      assignments: state.assignments
        .filter((assignment) => assignment.vehicle_job_id === vehicleJobId)
        .map((assignment) => ({
          id: assignment.id,
          vehicleJobId: assignment.vehicle_job_id,
          workerAccountId: assignment.worker_account_id,
          status: assignment.status,
        })),
    };
  },
  updateVehicleJobStatus: async (vehicleJobId: number, status: string) => {
    const job = state.vehicleJobs.find((item) => item.id === vehicleJobId);

    if (!job) {
      throw new Error("Vehicle job not found.");
    }

    job.status = status;
    return job;
  },
  completeAssignments: async (assignmentIds: number[], completedAt: Date) => {
    const completedAtIso = completedAt.toISOString();

    state.assignments
      .filter((assignment) => assignmentIds.includes(assignment.id))
      .forEach((assignment) => {
        assignment.status = "COMPLETED";
        assignment.completed_at = completedAtIso;
        assignment.updated_at = completedAtIso;
        recordWorkerAssignmentEventOnce(
          assignment,
          "COMPLETED",
          null,
          completedAtIso,
        );
      });

    return assignmentIds.length;
  },
  listReleasableAssignmentsByVehicleJob: async (vehicleJobId: number) =>
    state.assignments
      .filter(
        (assignment) =>
          assignment.vehicle_job_id === vehicleJobId &&
          RELEASABLE_ASSIGNMENT_STATUSES.includes(assignment.status),
      )
      .sort((a, b) => a.id - b.id),
  releaseAssignments: async (assignmentIds: number[], releasedAt: Date) => {
    const releasedAtIso = releasedAt.toISOString();
    let count = 0;

    state.assignments
      .filter(
        (assignment) =>
          assignmentIds.includes(assignment.id) &&
          RELEASABLE_ASSIGNMENT_STATUSES.includes(assignment.status),
      )
      .forEach((assignment) => {
        assignment.status = "RELEASED";
        assignment.released_at = releasedAtIso;
        assignment.updated_at = releasedAtIso;
        count += 1;
      });

    return count;
  },
  getVehicleWorkReadiness: async (vehicleJobId: number) => {
    const job = state.vehicleJobs.find((item) => item.id === vehicleJobId);
    const workersRequired = job?.workers_required ?? 0;
    const checkedInCount = state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
        SCANNED_ASSIGNMENT_STATUSES.includes(assignment.status),
    ).length;

    return {
      workers_required: workersRequired,
      checked_in_count: checkedInCount,
      remaining_count: Math.max(0, workersRequired - checkedInCount),
      is_ready: workersRequired > 0 && checkedInCount >= workersRequired,
    };
  },
  getVehicleJobTeamScanReadiness: async (vehicleJobId: number) => {
    const eligibleAssignments = state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
        FINISHED_ASSIGNMENT_STATUSES.includes(assignment.status),
    );
    const checkedInCount = eligibleAssignments.filter((assignment) =>
      SCANNED_ASSIGNMENT_STATUSES.includes(assignment.status),
    ).length;

    return {
      workers_required: eligibleAssignments.length,
      checked_in_count: checkedInCount,
      remaining_count: Math.max(0, eligibleAssignments.length - checkedInCount),
      is_ready:
        eligibleAssignments.length > 0 &&
        checkedInCount >= eligibleAssignments.length,
    };
  },
  activateNextTicketIfReady: async (vehicleJobId: number) =>
    activateNextTicketForVehicleJob(vehicleJobId),
  getWorkerDailyAssignmentCounts: async (
    workerAccountId: number,
    startAt: Date,
    endAt: Date,
  ) => {
    const assignments = state.assignments.filter((assignment) => {
      const createdAt = new Date(assignment.created_at ?? Date.now());

      return (
        assignment.worker_account_id === workerAccountId &&
        createdAt >= startAt &&
        createdAt < endAt
      );
    });

    return {
      today_job_count: assignments.filter(
        (assignment) => assignment.status !== "TIMEOUT",
      ).length,
      completed_job_count: assignments.filter(
        (assignment) =>
          assignment.status === "COMPLETED" || assignment.completed_at,
      ).length,
    };
  },
  listWorkerAssignmentHistoryByDate: async (
    workerAccountId: number,
    startAt: Date,
    endAt: Date,
  ) =>
    state.assignments
      .filter((assignment) => {
        const createdAt = new Date(assignment.created_at ?? Date.now());

        return (
          assignment.worker_account_id === workerAccountId &&
          createdAt >= startAt &&
          createdAt < endAt
        );
      })
      .sort(
        (left, right) =>
          new Date(right.created_at ?? 0).getTime() -
          new Date(left.created_at ?? 0).getTime(),
      )
      .map((assignment) => {
        const vehicleJob = state.vehicleJobs.find(
          (job) => job.id === assignment.vehicle_job_id,
        ) ?? {
          id: assignment.vehicle_job_id,
          ticket_number: `JOB-${assignment.vehicle_job_id}`,
          license_plate: "TEST",
          license_plate_province: "Bangkok",
          vehicle_type: null,
          workers_required: 1,
          dispatch_now: true,
          status: "WORKING",
          driver_qr_token: `driver-qr-${assignment.vehicle_job_id}`,
          expected_ticket_count: null,
          tickets_closed_at: null,
          created_at: assignment.created_at ?? new Date().toISOString(),
          updated_at: assignment.created_at ?? new Date().toISOString(),
        };

        const tickets = state.gateTickets
          .filter(
            (ticket) => ticket.vehicle_job_id === assignment.vehicle_job_id,
          )
          .sort((left, right) => left.id - right.id);
        const markets = [
          ...new Set(tickets.map((ticket) => ticket.market_job_id)),
        ].map((marketJobId) => {
          const marketTickets = tickets.filter(
            (ticket) => ticket.market_job_id === marketJobId,
          );
          const marketJob = state.marketJobs.find(
            (item) => item.id === marketJobId,
          );
          const firstTicket = marketTickets[0];

          return {
            ticket_no: marketJob?.ticket_no ?? `TICKET-${marketJobId}`,
            marketCode: marketJob?.marketCode ?? firstTicket?.marketCode ?? `MARKET-${marketJobId}`,
            marketName: marketJob?.marketName ?? firstTicket?.marketName ?? `Market ${marketJobId}`,
            booths: marketTickets.map((ticket) => {
              const rating = state.ticketRatings.find(
                (item) => item.ticket_id === ticket.id,
              );

                return {
                  boothCode: ticket.boothCode,
                  boothName: ticket.boothName,
                  status: ticket.status,
                  confirmation_status: ticket.confirmation_status ?? ticket.status,
                  completed_at: ticket.completed_at ?? null,
                  confirmed_at:
                    state.completionSubmissions.find(
                      (submission) =>
                        submission.ticket_id === ticket.id &&
                        submission.status === "COMPLETED",
                    )?.confirmed_at ?? null,
                  products: state.ticketProducts
                    .filter((product) => product.ticket_id === ticket.id)
                  .sort((left, right) => left.id - right.id)
                  .map((product) => ({
                    productCode: product.productCode,
                    productName: product.productName,
                    packageCode: product.packageCode,
                    packageName: product.packageName,
                    confirmed_quantity:
                      product.confirmed_quantity === null
                        ? null
                        : new Prisma.Decimal(
                            product.confirmed_quantity,
                          ).toFixed(2),
                  })),
                rating: rating?.score ?? null,
              };
            }),
          };
        });

        return {
          assignment,
          vehicle_job: vehicleJob,
          markets,
        };
      }),
  // สรุปรายได้ Worker ต่อ Business Ticket (market job) ไม่ใช่ต่อ Booth เพราะ TicketWorker
  // เป็น Roster ระดับ Business Ticket แล้ว final_earning_amount จึงรวมทุก Booth ของ Ticket นั้น
  listWorkerEarningsSummaryRows: async (
    workerAccountId: number,
    startAt: Date,
    endAt: Date,
  ) =>
    state.ticketWorkers
      .filter((ticketWorker) => {
        if (
          ticketWorker.worker_account_id !== workerAccountId ||
          ticketWorker.final_earning_amount === null ||
          ticketWorker.final_earning_amount === undefined
        ) {
          return false;
        }

        const marketJob = state.marketJobs.find(
          (item) => item.id === ticketWorker.market_job_id,
        );
        const completedAt = marketJob?.completed_at
          ? new Date(marketJob.completed_at)
          : null;

        return Boolean(
          marketJob?.financialized_at &&
          completedAt &&
          completedAt >= startAt &&
          completedAt < endAt,
        );
      })
      .sort((left, right) => {
        const leftMarket = state.marketJobs.find(
          (item) => item.id === left.market_job_id,
        );
        const rightMarket = state.marketJobs.find(
          (item) => item.id === right.market_job_id,
        );

        return (
          new Date(rightMarket?.completed_at ?? 0).getTime() -
            new Date(leftMarket?.completed_at ?? 0).getTime() ||
          left.id - right.id
        );
      })
      .map((ticketWorker) => {
        const marketJob = state.marketJobs.find(
          (item) => item.id === ticketWorker.market_job_id,
        );

        if (!marketJob) {
          throw new Error("Market job not found for worker earnings summary.");
        }

        const vehicleJob = state.vehicleJobs.find(
          (job) => job.id === marketJob.vehicle_job_id,
        );

        if (!vehicleJob) {
          throw new Error("Vehicle job not found for worker earnings summary.");
        }

        return {
          completed_at: marketJob.completed_at ?? "",
          ticket_number: vehicleJob.ticket_number,
          ticket_no: marketJob.ticket_no,
          license_plate: vehicleJob.license_plate,
          license_plate_province: vehicleJob.license_plate_province,
          booth_count: marketJob.booth_count,
          marketCode: marketJob.marketCode,
          marketName: marketJob.marketName,
          earnings: new Prisma.Decimal(
            ticketWorker.final_earning_amount ?? 0,
          ).toFixed(2),
        };
      }),

  findGateTicketForCompletion: async (ticketId: number) =>
    state.gateTickets.find((ticket) => ticket.id === ticketId) ?? null,
  listActiveVendorLineTargetsForTicket: async (ticketId: number) => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);

    if (!ticket?.vendor_line_id) {
      return [];
    }

    return [
      {
        line_user_id: ticket.vendor_line_id,
        target_type: "owner",
      },
      {
        line_user_id: `${ticket.vendor_line_id}-member`,
        target_type: "member",
      },
    ];
  },
  findGateTicketForCompletionByTicketNumberAndBoothCode: async (
    ticketNumber: string,
    boothCode: string,
  ) => {
    const vehicleJob = state.vehicleJobs.find(
      (job) => job.ticket_number === ticketNumber,
    );

    if (!vehicleJob) {
      return null;
    }

    return (
      state.gateTickets.find(
        (ticket) =>
          ticket.vehicle_job_id === vehicleJob.id &&
          ticket.boothCode === boothCode,
      ) ?? null
    );
  },
  findGateTicketForCompletionByTicketNumberAndTicketNoAndBoothCode: async (
    ticketNumber: string,
    ticketNo: string,
    boothCode: string,
  ) => {
    const vehicleJob = state.vehicleJobs.find(
      (job) => job.ticket_number === ticketNumber,
    );

    if (!vehicleJob) {
      return null;
    }

    const marketJob = state.marketJobs.find(
      (market) =>
        market.vehicle_job_id === vehicleJob.id && market.ticket_no === ticketNo,
    );

    if (!marketJob) {
      return null;
    }

    return (
      state.gateTickets.find(
        (ticket) =>
          ticket.market_job_id === marketJob.id && ticket.boothCode === boothCode,
      ) ?? null
    );
  },
  // Sync Worker Roster ของ Business Ticket ให้ตรงกับทีมปัจจุบันของ TicketNumber แบบ Additive
  // เท่านั้น: เพิ่มสมาชิกใหม่ที่ยัง Active กับ TicketNumber, ตัดสมาชิกที่ Assignment หลุดจากทีม
  // แล้ว (WORKING -> CANCELLED) แต่ห้าม Reactivate แถวที่ CANCELLED อยู่แล้ว และห้ามแตะ Roster
  // ที่ Lock แล้ว (worker_roster_locked_at ไม่เป็น null)
  syncTicketWorkersFromVehicleAssignments: async (
    marketJobId: number,
    vehicleJobId: number,
  ) => {
    const now = new Date().toISOString();
    const marketJob = state.marketJobs.find((item) => item.id === marketJobId);

    if (!marketJob || marketJob.worker_roster_locked_at !== null) {
      return state.ticketWorkers.filter(
        (worker) => worker.market_job_id === marketJobId,
      );
    }

    const activeWorkerAccountIds = [
      ...new Set(
        state.assignments
          .filter(
            (assignment) =>
              assignment.vehicle_job_id === vehicleJobId &&
              SCANNED_ASSIGNMENT_STATUSES.includes(assignment.status),
          )
          .map((assignment) => assignment.worker_account_id),
      ),
    ];

    for (const workerAccountId of activeWorkerAccountIds) {
      const existing = state.ticketWorkers.find(
        (worker) =>
          worker.market_job_id === marketJobId &&
          worker.worker_account_id === workerAccountId,
      );

      if (!existing) {
        state.ticketWorkers.push({
          id: state.nextTicketWorkerId++,
          market_job_id: marketJobId,
          worker_account_id: workerAccountId,
          status: "WORKING",
          final_earning_amount: null,
          joined_at: now,
          cancelled_at: null,
          completed_at: null,
        });
      }
    }

    state.ticketWorkers
      .filter(
        (worker) =>
          worker.market_job_id === marketJobId &&
          worker.status === "WORKING" &&
          !activeWorkerAccountIds.includes(worker.worker_account_id),
      )
      .forEach((worker) => {
        worker.status = "CANCELLED";

        worker.cancelled_at = now;

        worker.completed_at = null;

        worker.final_earning_amount = null;
      });

    return state.ticketWorkers.filter(
      (worker) => worker.market_job_id === marketJobId,
    );
  },

  listTicketWorkers: async (marketJobId: number) =>
    state.ticketWorkers.filter((worker) => worker.market_job_id === marketJobId),
  // คืน shallow copy เสมอ (ไม่ใช่ reference ตรงไปยัง state.ticketProducts) ให้ตรงกับพฤติกรรม DB
  // จริงที่ query แต่ละครั้งได้ snapshot ใหม่ — ไม่ใช่ mutate object เดิมที่ caller เก็บไว้ก่อนหน้า
  listTicketProducts: async (ticketId: number) =>
    state.ticketProducts
      .filter((product) => product.ticket_id === ticketId)
      .map((product) => ({ ...product })),
  markTicketDelivered: async (ticketId: number) => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);

    if (!ticket || !["WAIT", "WORKING", "REJECT"].includes(ticket.status)) {
      return false;
    }

    ticket.status = "DELIVERED";
    ticket.confirmation_status = "DELIVERED";
    ticket.reject_reason = null;
    return true;
  },
  createTicketCompletionSubmission: async (
    ticketId: number,
    workerAccountId: number,
  ) => {
    const submission = {
      id: state.nextSubmissionId++,
      ticket_id: ticketId,
      submitted_by_worker_account_id: workerAccountId,
      status: "DELIVERED",
      confirmed_at: null,
      rejected_at: null,
      resolved_by_line_user_id: null,
      created_at: new Date().toISOString(),
    };

    state.completionSubmissions.push(submission);
    return submission;
  },
  markVehicleAssignmentsDelivered: async (vehicleJobId: number) => {
    let count = 0;

    state.assignments
      .filter(
        (assignment) =>
          assignment.vehicle_job_id === vehicleJobId &&
          WORKING_ASSIGNMENT_STATUSES.includes(assignment.status),
      )
      .forEach((assignment) => {
        assignment.status = "DELIVERED";
        assignment.updated_at = new Date().toISOString();
        count += 1;
      });

    return count;
  },
  markVehicleAssignmentsRejected: async (vehicleJobId: number) => {
    let count = 0;

    state.assignments
      .filter(
        (assignment) =>
          assignment.vehicle_job_id === vehicleJobId &&
          WORKING_ASSIGNMENT_STATUSES.includes(assignment.status),
      )
      .forEach((assignment) => {
        assignment.status = "REJECT";
        assignment.updated_at = new Date().toISOString();
        count += 1;
      });

    return count;
  },
  markVehicleAssignmentsWorking: async (vehicleJobId: number) => {
    let count = 0;

    state.assignments
      .filter(
        (assignment) =>
          assignment.vehicle_job_id === vehicleJobId &&
          WORKING_ASSIGNMENT_STATUSES.includes(assignment.status),
      )
      .forEach((assignment) => {
        assignment.status = "WORKING";
        assignment.updated_at = new Date().toISOString();
        count += 1;
      });

    return count;
  },
  findWaitingTicketCompletionSubmission: async (ticketId: number) =>
    state.completionSubmissions
      .filter(
        (submission) =>
          submission.ticket_id === ticketId &&
          submission.status === "DELIVERED",
      )
      .at(-1) ?? null,
  findTicketCompletionSubmissionById: async (submissionId: number) =>
    state.completionSubmissions.find(
      (submission) => submission.id === submissionId,
    ) ?? null,
  confirmTicketCompletion: async (
    ticketId: number,
    submissionId: number,
    _connection?: unknown,
    resolvedByLineUserId?: string | null,
  ) => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);
    const submission = state.completionSubmissions.find(
      (item) => item.id === submissionId,
    );

    if (!ticket || ticket.status !== "DELIVERED" || !submission) {
      throw new Error("Ticket confirm did not update a waiting ticket.");
    }

    const completedAt = new Date().toISOString();
    ticket.status = "COMPLETED";
    ticket.confirmation_status = "COMPLETED";
    ticket.completed_at = completedAt;
    submission.status = "COMPLETED";
    submission.confirmed_at = completedAt;
    submission.resolved_by_line_user_id = resolvedByLineUserId ?? null;

    // หมายเหตุ: TicketWorker (Roster ของ Business Ticket) ไม่ถูกแตะที่นี่อีกต่อไป
    // การปิด Roster เป็น COMPLETED เกิดเฉพาะตอน Lock ที่ finalizeMarketJobFinancials
    // เพราะ Business Ticket หนึ่งอาจมีหลาย Booth และ Booth นี้เป็นเพียงใบเดียวที่จบ

    // Snapshot รายชื่อ TicketWorker ที่ยัง WORKING ณ ตอนแผงนี้ confirm สำเร็จ — ใช้เป็นตัวหารเงิน
    // ของแผงนี้โดยเฉพาะตอน finalize (ดู findMarketJobFinancializationContext)
    const workingWorkers = state.ticketWorkers.filter(
      (worker) =>
        worker.market_job_id === ticket.market_job_id &&
        worker.status === "WORKING",
    );

    for (const worker of workingWorkers) {
      const alreadySnapshotted = state.gateTicketWorkerSnapshots.some(
        (snapshot) =>
          snapshot.gate_ticket_id === ticketId &&
          snapshot.ticket_worker_id === worker.id,
      );

      if (!alreadySnapshotted) {
        state.gateTicketWorkerSnapshots.push({
          id: state.nextGateTicketWorkerSnapshotId++,
          gate_ticket_id: ticketId,
          ticket_worker_id: worker.id,
          created_at: completedAt,
        });
      }
    }

    return {
      ticket,
      submission,
    };
  },
  rejectTicketCompletion: async (
    ticketId: number,
    submissionId: number,
    rejectReason?: string | null,
    _connection?: unknown,
    resolvedByLineUserId?: string | null,
  ) => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);
    const submission = state.completionSubmissions.find(
      (item) => item.id === submissionId,
    );

    if (!ticket || ticket.status !== "DELIVERED" || !submission) {
      throw new Error("Ticket reject did not update a waiting ticket.");
    }

    ticket.status = "REJECT";
    ticket.confirmation_status = "REJECT";
    ticket.reject_reason = rejectReason ?? null;
    submission.status = "REJECT";
    submission.rejected_at = new Date().toISOString();
    submission.resolved_by_line_user_id = resolvedByLineUserId ?? null;

    return {
      ticket,
      submission,
    };
  },

  // Function ดึงข้อมูลทั้งหมดสำหรับ Financialize Business Ticket (market job) ใน route test
  findMarketJobFinancializationContext: async (marketJobId: number) => {
    const marketJob = state.marketJobs.find((item) => item.id === marketJobId);

    if (!marketJob) {
      return null;
    }

    const tickets = state.gateTickets
      .filter((ticket) => ticket.market_job_id === marketJobId)
      .sort((left, right) => left.id - right.id)
      .map((ticket) => ({
        id: ticket.id,
        status: ticket.status,
        workerSnapshots: state.gateTicketWorkerSnapshots
          .filter((snapshot) => snapshot.gate_ticket_id === ticket.id)
          .sort((left, right) => left.id - right.id)
          .map((snapshot) => ({
            id: snapshot.id,
            gateTicketId: snapshot.gate_ticket_id,
            ticketWorkerId: snapshot.ticket_worker_id,
            createdAt: new Date(snapshot.created_at),
          })),
        products: state.ticketProducts
          .filter((product) => product.ticket_id === ticket.id)
          .sort((left, right) => left.id - right.id)
          .map((product) => {
            const financial =
              state.ticketProductFinancials.find(
                (item) => item.ticket_product_id === product.id,
              ) ?? null;

            return {
              id: product.id,

              confirmedQuantity:
                product.confirmed_quantity === null
                  ? null
                  : new Prisma.Decimal(product.confirmed_quantity),

              packageWeightSnapshot:
                product.package_weight_snapshot === null
                  ? null
                  : new Prisma.Decimal(product.package_weight_snapshot),

              rateIdSnapshot: product.rate_id_snapshot,
              sourceRateIdSnapshot: product.source_rate_id_snapshot,
              rateMarketCode: product.rate_market_code,
              rateSource: product.rate_source,
              weightRangeName: product.weight_range_name,
              weightMinSnapshot:
                product.weight_min_snapshot === null
                  ? null
                  : new Prisma.Decimal(product.weight_min_snapshot),
              weightMaxSnapshot:
                product.weight_max_snapshot === null
                  ? null
                  : new Prisma.Decimal(product.weight_max_snapshot),
              stallRateSnapshot:
                product.stall_rate_snapshot === null
                  ? null
                  : new Prisma.Decimal(product.stall_rate_snapshot),
              laborRateSnapshot:
                product.labor_rate_snapshot === null
                  ? null
                  : new Prisma.Decimal(product.labor_rate_snapshot),
              rateSnapshotAt: product.rate_snapshot_at
                ? new Date(product.rate_snapshot_at)
                : null,

              financial,
            };
          }),
      }));

    const ticketWorkers = state.ticketWorkers
      .filter((worker) => worker.market_job_id === marketJobId)
      .sort((left, right) => left.id - right.id)
      .map((worker) => ({
        ...worker,
        finalEarningAmount:
          worker.final_earning_amount === undefined ||
          worker.final_earning_amount === null
            ? null
            : new Prisma.Decimal(worker.final_earning_amount),
      }));

    return {
      id: marketJob.id,

      finalStallAmount: marketJob.final_stall_amount
        ? new Prisma.Decimal(marketJob.final_stall_amount)
        : null,

      financializedAt: marketJob.financialized_at
        ? new Date(marketJob.financialized_at)
        : null,

      tickets,
      ticketWorkers,
    };
  },

  // Function Lock Worker Roster ของ Business Ticket แบบ idempotent
  lockMarketJobWorkerRoster: async (marketJobId: number) => {
    const marketJob = state.marketJobs.find((item) => item.id === marketJobId);

    if (marketJob && marketJob.worker_roster_locked_at === null) {
      marketJob.worker_roster_locked_at = new Date().toISOString();
    }
  },

  // Function ปิด Roster: เปลี่ยน Worker ที่ยัง WORKING ของ Business Ticket นี้เป็น COMPLETED
  markMarketJobTicketWorkersCompleted: async (
    marketJobId: number,
    completedAt: Date,
  ) => {
    const completedAtIso = completedAt.toISOString();

    state.ticketWorkers
      .filter(
        (worker) =>
          worker.market_job_id === marketJobId && worker.status === "WORKING",
      )
      .forEach((worker) => {
        worker.status = "COMPLETED";
        worker.completed_at = completedAtIso;
        worker.cancelled_at = null;
      });
  },

  // Function สร้าง Product Financial
  createTicketProductFinancial: async (input: {
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
  }) => {
    const existing = state.ticketProductFinancials.find(
      (financial) => financial.ticket_product_id === input.ticketProductId,
    );

    if (existing) {
      throw new Error("Ticket product financial already exists.");
    }

    const financial = {
      id: state.nextTicketProductFinancialId++,
      ticket_product_id: input.ticketProductId,
      confirmed_quantity: input.confirmedQuantity.toString(),
      stall_fee_raw: input.stallFeeRaw.toString(),
      stall_fee_rounded: input.stallFeeRounded.toString(),
      labor_fee_raw: input.laborFeeRaw.toString(),
      product_charge: input.productCharge.toString(),
      worker_count: input.workerCount,
      worker_payout_total: input.workerPayoutTotal.toString(),
      fund_amount: input.fundAmount.toString(),
      finalized_at: input.finalizedAt.toISOString(),
    };

    state.ticketProductFinancials.push(financial);

    for (const payment of input.workerPayments) {
      const duplicate = state.ticketWorkerPayments.find(
        (item) =>
          item.ticket_product_financial_id === financial.id &&
          item.ticket_worker_id === payment.ticketWorkerId,
      );

      if (duplicate) {
        throw new Error("Ticket worker payment already exists.");
      }

      state.ticketWorkerPayments.push({
        id: state.nextTicketWorkerPaymentId++,
        ticket_product_financial_id: financial.id,
        ticket_worker_id: payment.ticketWorkerId,
        raw_amount: payment.rawAmount.toString(),
        remainder_amount: payment.remainderAmount.toString(),
        final_amount: payment.finalAmount.toString(),
      });
    }

    return financial;
  },

  // Functionบันทึกยอดรวมและเวลาที่ Financialize Ticket
  updateTicketWorkerFinalEarningAmounts: async (
    amountsByTicketWorkerId: Map<number, Prisma.Decimal>,
  ): Promise<void> => {
    for (const [
      ticketWorkerId,
      finalEarningAmount,
    ] of amountsByTicketWorkerId) {
      const ticketWorker = state.ticketWorkers.find(
        (item) => item.id === ticketWorkerId,
      );

      if (!ticketWorker) {
        throw new Error("Ticket worker not found for final earning update.");
      }

      ticketWorker.final_earning_amount = finalEarningAmount.toFixed(2);
    }
  },

  // Function บันทึกยอดเงินของ Booth แบบข้อมูลประกอบ (ไม่ใช่ guard หลัก)
  markGateTicketFinancializedInfo: async (
    ticketId: number,
    finalStallAmount: Prisma.Decimal,
    finalizedAt: Date,
  ): Promise<void> => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);

    if (ticket) {
      ticket.final_stall_amount = finalStallAmount.toFixed(2);
      ticket.financialized_at = finalizedAt.toISOString();
      ticket.updated_at = finalizedAt.toISOString();
    }
  },

  // Function บันทึกผล Finalize การเงินของ Business Ticket ทั้งใบแบบ idempotent (guard หลัก)
  markMarketJobFinancialized: async (
    marketJobId: number,
    finalStallAmount: Prisma.Decimal,
    finalizedAt: Date,
  ): Promise<void> => {
    const marketJob = state.marketJobs.find((item) => item.id === marketJobId);

    if (!marketJob || marketJob.financialized_at) {
      throw new Error(
        "Market job financialization did not update exactly one market job.",
      );
    }

    marketJob.final_stall_amount = finalStallAmount.toFixed(2);
    marketJob.financialized_at = finalizedAt.toISOString();
    marketJob.completed_at = finalizedAt.toISOString();
    marketJob.status = "COMPLETED";
    marketJob.updated_at = finalizedAt.toISOString();
  },

  closeCompletedVehicleJobIfReady: async (vehicleJobId: number) => {
    const job = state.vehicleJobs.find((item) => item.id === vehicleJobId);
    const tickets = state.gateTickets.filter(
      (ticket) => ticket.vehicle_job_id === vehicleJobId,
    );
    const allTicketsTerminal =
      tickets.length > 0 &&
      tickets.every((ticket) =>
        ["COMPLETED", "CANCELLED"].includes(ticket.status),
      );

    if (!job || !allTicketsTerminal) {
      return null;
    }

    const now = new Date().toISOString();
    job.status = tickets.every((ticket) => ticket.status === "CANCELLED")
      ? "CANCELLED"
      : "COMPLETED";
    job.updated_at = now;

    const activeAssignments = state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
        ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status),
    );
    activeAssignments.forEach((assignment) => {
      assignment.status = "COMPLETED";
      assignment.completed_at = now;
      assignment.updated_at = now;
      recordWorkerAssignmentEventOnce(assignment, "COMPLETED", null, now);
    });

    return {
      vehicle_job: job,
      completed_assignment_ids: activeAssignments.map(
        (assignment) => assignment.id,
      ),
      completed_worker_account_ids: activeAssignments.map(
        (assignment) => assignment.worker_account_id,
      ),
    };
  },
  updateTicketProductConfirmations: async (
    ticketId: number,
    items: Array<{
      productCode: string;
      packageCode: string;
      confirmed_quantity: number;
      original_package_code?: string;
      package_switch?: {
        packageName: string;
        packageWeightSnapshot: string;
        rateIdSnapshot: number;
        sourceRateIdSnapshot: number;
        rateMarketCode: string;
        rateSource: string;
        weightRangeName: string;
        weightMinSnapshot: string;
        weightMaxSnapshot: string;
        stallRateSnapshot: string;
        laborRateSnapshot: string;
        rateSnapshotAt: Date;
      };
    }>,
  ) => {
    for (const item of items) {
      const originalPackageCode = item.original_package_code ?? item.packageCode;
      const product = state.ticketProducts.find(
        (candidate) =>
          candidate.ticket_id === ticketId &&
          candidate.productCode === item.productCode &&
          candidate.packageCode === originalPackageCode,
      );

      if (!product) {
        throw new Error("Ticket product not found.");
      }

      product.confirmed_quantity = String(item.confirmed_quantity);

      if (item.package_switch) {
        product.packageCode = item.packageCode;
        product.packageName = item.package_switch.packageName;
        product.package_weight_snapshot = item.package_switch.packageWeightSnapshot;
        product.rate_id_snapshot = item.package_switch.rateIdSnapshot;
        product.source_rate_id_snapshot = item.package_switch.sourceRateIdSnapshot;
        product.rate_market_code = item.package_switch.rateMarketCode;
        product.rate_source = item.package_switch.rateSource;
        product.weight_range_name = item.package_switch.weightRangeName;
        product.weight_min_snapshot = item.package_switch.weightMinSnapshot;
        product.weight_max_snapshot = item.package_switch.weightMaxSnapshot;
        product.stall_rate_snapshot = item.package_switch.stallRateSnapshot;
        product.labor_rate_snapshot = item.package_switch.laborRateSnapshot;
        product.rate_snapshot_at = item.package_switch.rateSnapshotAt.toISOString();
      }
    }

    return state.ticketProducts.filter(
      (product) => product.ticket_id === ticketId,
    );
  },
  getVehicleJobDetail: async (vehicleJobId: number) => {
    const job = state.vehicleJobs.find((item) => item.id === vehicleJobId);

    if (!job) {
      return null;
    }

    const marketJobs = state.marketJobs.filter(
      (market) => market.vehicle_job_id === vehicleJobId,
    );

    return {
      vehicle_job: {
        id: job.id,
        ticket_number: job.ticket_number,
        license_plate: job.license_plate,
        license_plate_province: job.license_plate_province,
        vehicle_type: job.vehicle_type,
        workers_required: job.workers_required,
        dispatch_now: job.dispatch_now,
        status: job.status,
        driver_qr_token: job.driver_qr_token,
        expected_ticket_count: job.expected_ticket_count ?? null,
        tickets_closed_at: job.tickets_closed_at ?? null,
        created_at: job.created_at,
        updated_at: job.updated_at,
      },
      markets: marketJobs.map((marketJob) => {
        const marketTickets = state.gateTickets.filter(
          (ticket) => ticket.market_job_id === marketJob.id,
        );

        return {
          id: marketJob.id,
          vehicle_job_id: vehicleJobId,
          ticket_no: marketJob.ticket_no,
          ticket_created_at: marketJob.ticket_created_at,
          booth_count: marketJob.booth_count,
          gate_transaction_ref: marketJob.gate_transaction_ref,
          workers_required: marketJob.workers_required,
          marketCode: marketJob.marketCode,
          marketName: marketJob.marketName,
          dropoff_point: marketJob.dropoff_point,
          status: marketJob.status,
          worker_roster_locked_at: marketJob.worker_roster_locked_at,
          final_stall_amount: marketJob.final_stall_amount,
          financialized_at: marketJob.financialized_at,
          completed_at: marketJob.completed_at,
          created_at: marketJob.created_at,
          updated_at: marketJob.updated_at,
          booths: marketTickets.map((ticket) => ({
            ...ticket,
            confirmation_status: ticket.confirmation_status ?? ticket.status,
            products: state.ticketProducts.filter(
              (product) => product.ticket_id === ticket.id,
            ),
          })),
        };
      }),
    };
  },
};

const {
  accountRepository,
  acceptAssignment,
  completeAssignments,
  countActiveAssignments,
  countScannedAssignments,
  createAssignment,
  createTicketCompletionSubmission,
  createTicketProductFinancial,
  findAssignmentById,
  findAssignmentByIdAndWorker,
  findCurrentAssignmentByVehicleJobRefAndWorker,
  findCurrentAssignmentByWorker,
  findCurrentOpenTicketByVehicleJob,
  findGateTicketForCompletion,
  findGateTicketForCompletionByTicketNumberAndBoothCode,
  findGateTicketForCompletionByTicketNumberAndTicketNoAndBoothCode,
  findTicketCompletionSubmissionById,
  findMarketJobFinancializationContext,
  lockMarketJobWorkerRoster,
  markMarketJobTicketWorkersCompleted,
  findVehicleJobById,
  findVehicleJobByRef,
  findVehicleJobLifecycleState,
  findWaitingTicketCompletionSubmission,
  getVehicleJobDetail,
  getVehicleJobTeamScanReadiness,
  getVehicleWorkReadiness,
  getWorkerDailyAssignmentCounts,
  listAcceptedAssignmentsByVehicleJob,
  listActiveVendorLineTargetsForTicket,
  listDispatchableVehicleJobs,
  listReleasableAssignmentsByVehicleJob,
  listTicketProducts,
  listTicketWorkers,
  listVehicleJobAssignmentTeam,
  listWorkerAssignmentHistoryByDate,
  listWorkerEarningsSummaryRows,
  markGateTicketFinancializedInfo,
  markMarketJobFinancialized,
  markTicketDelivered,
  markVehicleAssignmentsDelivered,
  markVehicleAssignmentsRejected,
  markVehicleAssignmentsWorking,
  markVehicleJobInProgress,
  profileRepository,
  releaseAssignments,
  rejectTicketCompletion,
  scanAssignment,
  syncTicketWorkersFromVehicleAssignments,
  timeoutAssignment,
  updateAssignmentScanDeadline,
  updateGateTicketStatus,
  updateMarketJobStatus,
  updateTicketProductConfirmations,
  updateTicketWorkerFinalEarningAmounts,
  updateVehicleJobStatus,
  workerShiftAttendanceRepository,
  workScheduleRepository,
  confirmTicketCompletion,
} = workerApplicationRepositoryMock;

export const accountRepositoryMock = accountRepository;

export const profileRepositoryMock = profileRepository;

export const workScheduleRepositoryMock = workScheduleRepository;

export const workerShiftAttendanceRepositoryMock =
  workerShiftAttendanceRepository;

export const workerRepositoryMock = {
  listWorkerAssignmentHistoryByDate,
  listWorkerEarningsSummaryRows,
};

export const vehicleJobRepositoryMock = {
  findVehicleJobById,
  findVehicleJobByRef,
  getVehicleJobDetail,
  markVehicleJobInProgress,
  updateMarketJobStatus,
  updateGateTicketStatus,
  findCurrentOpenTicketByVehicleJob,
  getVehicleWorkReadiness,
  listDispatchableVehicleJobs,
  findVehicleJobLifecycleState,
  updateVehicleJobStatus,
};

export const vehicleJobAssignmentRepositoryMock = {
  countActiveAssignments,
  getWorkerDailyAssignmentCounts,
  createAssignment,
  findCurrentAssignmentByWorker,
  findAssignmentById,
  countScannedAssignments,
  getVehicleJobTeamScanReadiness,
  listVehicleJobAssignmentTeam,
  findAssignmentByIdAndWorker,
  findCurrentAssignmentByVehicleJobRefAndWorker,
  acceptAssignment,
  listAcceptedAssignmentsByVehicleJob,
  updateAssignmentScanDeadline,
  timeoutAssignment,
  scanAssignment,
  markVehicleAssignmentsDelivered,
  markVehicleAssignmentsRejected,
  markVehicleAssignmentsWorking,
  completeAssignments,
  listReleasableAssignmentsByVehicleJob,
  releaseAssignments,
};

export const gateTicketRepositoryMock = {
  findGateTicketForCompletion,
  findGateTicketForCompletionByTicketNumberAndBoothCode,
  findGateTicketForCompletionByTicketNumberAndTicketNoAndBoothCode,
  listActiveVendorLineTargetsForTicket,
  listTicketProducts,
  updateTicketProductConfirmations,
  markTicketDelivered,
  createTicketCompletionSubmission,
  findWaitingTicketCompletionSubmission,
  findTicketCompletionSubmissionById,
  confirmTicketCompletion,
  rejectTicketCompletion,
};

export const ticketWorkerRepositoryMock = {
  listTicketWorkers,
  syncTicketWorkersFromVehicleAssignments,
};

export const ticketFinancialRepositoryMock = {
  findMarketJobFinancializationContext,
  lockMarketJobWorkerRoster,
  markMarketJobTicketWorkersCompleted,
  createTicketProductFinancial,
  updateTicketWorkerFinalEarningAmounts,
  markGateTicketFinancializedInfo,
  markMarketJobFinancialized,
};

export const gateRepositoryMock = {
  findGateRequestResponseByRef: async (gateTransactionRef: string) => {
    const requestLog = state.gateRequestLogs.find(
      (item) => item.gate_transaction_ref === gateTransactionRef,
    );

    return requestLog?.response_snapshot ?? null;
  },
  findGateRequestReplayByRef: async (gateTransactionRef: string) => {
    const requestLog = state.gateRequestLogs.find(
      (item) => item.gate_transaction_ref === gateTransactionRef,
    );

    if (!requestLog) {
      return null;
    }

    return {
      gate_transaction_ref: requestLog.gate_transaction_ref,
      payload_snapshot: requestLog.payload_snapshot,
      response_snapshot: requestLog.response_snapshot,
    };
  },
  findVehicleJobByRef: async (ticketNumber: string) =>
    state.vehicleJobs.find((job) => job.ticket_number === ticketNumber) ?? null,
  findMarketJobByVehicleAndTicketNo: async (
    vehicleJobId: number,
    ticketNo: string,
  ) =>
    state.marketJobs.find(
      (market) =>
        market.vehicle_job_id === vehicleJobId &&
        market.ticket_no === ticketNo &&
        market.status !== "CANCELLED",
    ) ?? null,
  findGateTicketBoothCodesByMarketJobId: async (marketJobId: number) =>
    state.gateTickets
      .filter((ticket) => ticket.market_job_id === marketJobId)
      .map((ticket) => ticket.boothCode),
  listGateMarketOptions: async (marketCode?: string) => {
    const seen = new Set<string>();

    return state.masterMarkets
      .filter(
        (market) =>
          (!marketCode || market.marketCode === marketCode) &&
          market.boothStatus === "Normal" &&
          (market.marketStatus === null || market.marketStatus === "Normal") &&
          market.marketName !== null,
      )
      .filter((market) => {
        if (seen.has(market.marketCode)) {
          return false;
        }

        seen.add(market.marketCode);
        return true;
      })
      .map((market) => ({
        marketCode: market.marketCode,
        marketName: market.marketName,
      }))
      .sort((left, right) => left.marketCode.localeCompare(right.marketCode));
  },

  listGateBoothOptionsByMarketCode: async (marketCode: string) =>
    state.masterMarkets
      .filter(
        (market) =>
          market.marketCode === marketCode &&
          market.boothStatus === "Normal" &&
          (market.marketStatus === null || market.marketStatus === "Normal"),
      )
      .map((market) => ({
        BoothCode: market.boothCode,
        BoothName: market.boothName,
      })),

  listGateProductPackageOptions: async () =>
    state.masterProducts
      .filter((product) => product.status === "ACTIVE")
      .map((product) => ({
        productCode: product.productCode,

        productName: product.productName,

        packageCode: product.packageCode,

        packageName: product.packageName,

        packageWeight: product.packageWeight,
      })),

  findActiveMarketBoothByCodes: async (marketCode: string, boothCode: string) =>
    state.masterMarkets.find(
      (market) =>
        market.marketCode === marketCode &&
        market.boothCode === boothCode &&
        market.boothStatus === "Normal" &&
        (market.marketStatus === null || market.marketStatus === "Normal"),
    ) ?? null,
  findActiveProductByFullCodeAndPackageCode: async (
    productFullCode: string,
    packageCode: string,
  ) =>
    state.masterProducts.find(
      (product) =>
        product.productFullCode === productFullCode &&
        product.packageCode === packageCode &&
        product.status === "ACTIVE",
    ) ?? null,
  findActiveVendorLineTargetsByStall: async (
    _marketCode: string,
    boothCode: string,
  ) => [
    {
      line_user_id: `line-vendor-${boothCode.toLowerCase()}`,
      target_type: "owner",
    },
    {
      line_user_id: `line-member-${boothCode.toLowerCase()}`,
      target_type: "member",
    },
  ],
  createVehicleJobFromGate: async (
    input: {
      ticketNumber: string;
      license_plate: string;
      license_plate_province: string;
      vehicle_type?: string | null;
      dispatch_now?: boolean;
      existingMarketJobId?: number;
      markets: Array<{
        ticketNo: string;
        ticket_created_at: Date;
        booth_count: number;
        gate_transaction_ref: string;
        workers_required: number;
        marketCode: string;
        marketName: string;
        dropoff_point?: string | null;
        booths: Array<{
          boothCode: string;
          boothName?: string | null;
          vendor_line_id?: string | null;
          reject_reason?: string | null;
          products: Array<{
            productCode: string;
            productName: string;
            productFullCode: string;
            packageCode: string;
            packageName: string;
            quantity: number;
            packageWeightSnapshot: string;
            rateIdSnapshot: number;
            sourceRateIdSnapshot: number;
            rateMarketCode: string;
            rateSource: "MARKET_RATE" | "CENTRAL_RATE";
            weightRangeName: string;
            weightMinSnapshot: string;
            weightMaxSnapshot: string;
            stallRateSnapshot: string;
            laborRateSnapshot: string;
            rateSnapshotAt: Date;
          }>;
        }>;
      }>;
    },
    payloadSnapshot: unknown,
  ) => {
    const now = new Date().toISOString();
    const dispatchNow = input.dispatch_now === true;
    const market = input.markets[0];
    const requestedWorkersRequired = Math.max(1, market.workers_required);
    let vehicleJob = state.vehicleJobs.find(
      (job) => job.ticket_number === input.ticketNumber,
    );

    if (!vehicleJob) {
      const vehicleJobId =
        Math.max(0, ...state.vehicleJobs.map((job) => job.id)) + 1;
      vehicleJob = {
        id: vehicleJobId,
        ticket_number: input.ticketNumber,
        license_plate: input.license_plate,
        license_plate_province: input.license_plate_province,
        vehicle_type: input.vehicle_type ?? null,
        workers_required: requestedWorkersRequired,
        dispatch_now: dispatchNow,
        status: dispatchNow ? "WORKING" : "WAIT",
        driver_qr_token: `driver-qr-${vehicleJobId}`,
        expected_ticket_count: null,
        tickets_closed_at: null,
        created_at: now,
        updated_at: now,
      };

      state.vehicleJobs.push(vehicleJob);
    } else {
      vehicleJob.license_plate = input.license_plate;
      vehicleJob.license_plate_province = input.license_plate_province;
      vehicleJob.vehicle_type = input.vehicle_type ?? null;
      vehicleJob.dispatch_now = vehicleJob.dispatch_now || dispatchNow;
      if (dispatchNow && vehicleJob.status === "WAIT") {
        vehicleJob.status = "WORKING";
      }
      vehicleJob.updated_at = now;
    }

    const marketStatus =
      vehicleJob.status === "WORKING" || dispatchNow ? "WORKING" : "WAIT";

    let marketJob: (typeof state.marketJobs)[number];
    let marketJobId: number;

    if (input.existingMarketJobId !== undefined) {
      // Gate ส่งแผงชุดใหม่มาเพิ่มเข้า Ticket เดิม (TicketNo + ตลาดเดิม) — บวก boothCount เพิ่ม และ
      // workers_required ใช้ MAX ระหว่างของเดิมกับของคำขอนี้ (แผงเดิมไม่ถูกแตะ ค่าเดิมยังถูกต้องอยู่)
      const existing = state.marketJobs.find(
        (item) => item.id === input.existingMarketJobId,
      )!;

      existing.booth_count += market.booth_count;
      existing.workers_required = Math.max(
        existing.workers_required,
        requestedWorkersRequired,
      );
      existing.gate_transaction_ref = market.gate_transaction_ref;
      existing.updated_at = now;
      marketJob = existing;
      marketJobId = existing.id;
    } else {
      marketJobId =
        Math.max(0, state.nextMarketJobId - 1, ...state.marketJobs.map((m) => m.id)) +
        1;
      state.nextMarketJobId = marketJobId + 1;

      marketJob = {
        id: marketJobId,
        vehicle_job_id: vehicleJob.id,
        ticket_no: market.ticketNo,
        ticket_created_at: market.ticket_created_at.toISOString(),
        booth_count: market.booth_count,
        gate_transaction_ref: market.gate_transaction_ref,
        workers_required: requestedWorkersRequired,
        marketCode: market.marketCode,
        marketName: market.marketName,
        dropoff_point: market.dropoff_point ?? null,
        status: marketStatus,
        worker_roster_locked_at: null,
        final_stall_amount: null,
        financialized_at: null,
        completed_at: null,
        created_at: now,
        updated_at: now,
      };

      state.marketJobs.push(marketJob);
    }

    let ticketId =
      Math.max(0, ...state.gateTickets.map((ticket) => ticket.id)) + 1;
    let productId =
      Math.max(0, ...state.ticketProducts.map((product) => product.id)) + 1;

    for (const boothInput of market.booths) {
      const ticket: (typeof state.gateTickets)[number] = {
        id: ticketId++,
        vehicle_job_id: vehicleJob.id,
        market_job_id: marketJobId,
        marketCode: market.marketCode,
        marketName: market.marketName,
        dropoff_point: market.dropoff_point ?? null,
        boothCode: boothInput.boothCode,
        boothName: boothInput.boothName ?? null,
        vendor_line_id: boothInput.vendor_line_id ?? null,
        reject_reason: boothInput.reject_reason ?? null,
        status: "WAIT",
        confirmation_status: "WAIT",
        created_at: now,
        updated_at: now,
      };

      state.gateTickets.push(ticket);

      boothInput.products.forEach((product) => {
        const ticketProduct = {
          id: productId++,
          ticket_id: ticket.id,

          productCode: product.productCode,
          productFullCode: product.productFullCode,
          productName: product.productName,

          packageCode: product.packageCode,
          packageName: product.packageName,

          quantity: String(product.quantity),
          confirmed_quantity: null,

          package_weight_snapshot: product.packageWeightSnapshot,

          rate_id_snapshot: product.rateIdSnapshot,

          source_rate_id_snapshot: product.sourceRateIdSnapshot,

          rate_market_code: product.rateMarketCode,

          rate_source: product.rateSource,

          weight_range_name: product.weightRangeName,

          weight_min_snapshot: product.weightMinSnapshot,

          weight_max_snapshot: product.weightMaxSnapshot,

          stall_rate_snapshot: product.stallRateSnapshot,

          labor_rate_snapshot: product.laborRateSnapshot,

          rate_snapshot_at: product.rateSnapshotAt.toISOString(),

          created_at: now,
          updated_at: now,
        };

        state.ticketProducts.push(ticketProduct);
      });
    }

    // Worker requirement ของ TicketNumber = ผลรวม (SUM) ของทุก Business Ticket ที่ยัง active
    // (ไม่นับแถวที่ถูก Admin ยกเลิกไปแล้ว) ห้ามใช้ MAX
    vehicleJob.workers_required = state.marketJobs
      .filter(
        (item) => item.vehicle_job_id === vehicleJob.id && item.status !== "CANCELLED",
      )
      .reduce((total, item) => total + item.workers_required, 0);

    // Gate ไม่ส่งจำนวน Ticket มาบอกล่วงหน้าอีกต่อไป — ปิดรับทันทีตั้งแต่ Ticket แรกที่สร้างสำเร็จ
    // (ตั้งครั้งเดียว) expected_ticket_count เป็นแค่ค่านับ Ticket ที่ active จริง ณ ตอนนี้ไว้แสดงผล
    vehicleJob.tickets_closed_at = vehicleJob.tickets_closed_at ?? now;
    vehicleJob.expected_ticket_count = state.marketJobs.filter(
      (item) => item.vehicle_job_id === vehicleJob.id && item.status !== "CANCELLED",
    ).length;

    state.gateRequestLogs.push({
      gate_transaction_ref: market.gate_transaction_ref,
      vehicle_job_id: vehicleJob.id,
      market_job_id: marketJobId,
      payload_snapshot: payloadSnapshot,
      response_snapshot: null,
    });

    return { vehicleJob, marketJob };
  },
  updateGateRequestResponse: async (
    gateTransactionRef: string,
    responseSnapshot: unknown,
  ) => {
    const requestLog = state.gateRequestLogs.find(
      (item) => item.gate_transaction_ref === gateTransactionRef,
    );

    if (!requestLog) {
      throw new Error("Gate request log not found.");
    }

    requestLog.response_snapshot = responseSnapshot;
  },
};

// Mock ของ src/repositories/shared/master-data.repository.ts
export const masterDataRepositoryMock = {
  findActiveProductsByProductCodeAndPackageCode: async (
    productCode: string,
    packageCode: string,
  ) =>
    state.masterProducts.filter(
      (product) =>
        product.productCode === productCode &&
        product.packageCode === packageCode &&
        product.status === "ACTIVE",
    ),
  findActiveRatesByMarketAndWeight: async (
    marketCode: string,
    packageWeight: Prisma.Decimal,
  ) =>
    state.masterRates.filter(
      (rate) =>
        rate.marketCode === marketCode &&
        rate.status === 1 &&
        rate.weightMin.lt(packageWeight) &&
        rate.weightMax.gte(packageWeight),
    ),
  findActiveMasterProductPackagesByProductCode: async (productCode: string) =>
    state.masterProducts
      .filter(
        (product) =>
          product.productCode === productCode && product.status === "ACTIVE",
      )
      .map((product) => ({
        productCode: product.productCode,
        productName: product.productName,
        packageCode: product.packageCode,
        packageName: product.packageName,
        packageWeight: product.packageWeight,
      }))
      .sort((left, right) => left.packageCode.localeCompare(right.packageCode)),
};

// Mock ของ src/repositories/shared/market-job.repository.ts
export const marketJobRepositoryMock = {
  findMarketJobByVehicleAndTicketNo: async (
    vehicleJobId: number,
    ticketNo: string,
  ) =>
    state.marketJobs.find(
      (market) =>
        market.vehicle_job_id === vehicleJobId &&
        market.ticket_no === ticketNo &&
        market.status !== "CANCELLED",
    ) ?? null,
  findMarketJobById: async (id: number) =>
    state.marketJobs.find((market) => market.id === id) ?? null,
  listActiveTicketNosByVehicleJobId: async (vehicleJobId: number) =>
    state.marketJobs
      .filter(
        (market) =>
          market.vehicle_job_id === vehicleJobId && market.status !== "CANCELLED",
      )
      .sort((left, right) => left.id - right.id)
      .map((market) => market.ticket_no),
};

// Mock ของ src/repositories/shared/admin-action-log.repository.ts
export const adminActionLogRepositoryMock = {
  create: async (input: {
    vehicle_job_id: number;
    gate_ticket_id?: number | null;
    action_type: string;
    reason_code?: string | null;
    reason_text?: string | null;
    actor_account_id: number;
    metadata?: Record<string, unknown> | null;
  }) => {
    const record = {
      id: state.nextAdminActionLogId++,
      vehicle_job_id: input.vehicle_job_id,
      gate_ticket_id: input.gate_ticket_id ?? null,
      action_type: input.action_type,
      reason_code: input.reason_code ?? null,
      reason_text: input.reason_text ?? null,
      actor_account_id: input.actor_account_id,
      metadata: input.metadata ?? null,
      created_at: new Date().toISOString(),
    };

    state.adminActionLogs.push(record);
    return record;
  },
  listByVehicleJobId: async (vehicleJobId: number) => {
    const actorWorkerCodeById = (accountId: number) => {
      const account =
        state.workers.get(accountId) ?? state.authAccountsById.get(accountId);

      return {
        actor_worker_code: account?.username ?? null,
        actor_full_name: account?.full_name ?? null,
      };
    };

    return state.adminActionLogs
      .filter((log) => log.vehicle_job_id === vehicleJobId)
      .sort((left, right) => left.id - right.id)
      .map((log) => ({
        ...log,
        ...actorWorkerCodeById(log.actor_account_id),
      }));
  },
};

export const authRepositoryMock = {
  accountRepository: {
    findByUsername: async (username: string) =>
      state.authAccountsByUsername.get(username) ?? null,
    findById: async (accountId: number) =>
      state.authAccountsById.get(accountId) ?? null,
    updatePassword: async (accountId: number, passwordHash: string) => {
      const account = state.authAccountsById.get(accountId);

      if (!account) {
        throw new Error("Account not found.");
      }

      account.password_hash = passwordHash;
      return account;
    },
    updateLang: async (accountId: number, lang: string) => {
      const account = state.authAccountsById.get(accountId);

      if (!account) {
        throw new Error("Account not found.");
      }

      account.lang = lang;
      return account;
    },
    sanitizeAccount: (account: AccountRecord | null) => {
      if (!account) {
        return null;
      }

      const { password_hash: _passwordHash, ...safeAccount } = account;
      return safeAccount;
    },
  },
  sessionRepository: {
    findActiveByAccountId: async (accountId: number) =>
      Array.from(state.sessions.values()).find(
        (session) => session.account_id === accountId && session.is_active,
      ) ?? null,
    findActiveById: async (sessionId: number) => {
      const session = state.sessions.get(sessionId);

      if (!session || !session.is_active) {
        return null;
      }

      if (
        typeof session.expires_at === "string" &&
        new Date(session.expires_at).getTime() <= Date.now()
      ) {
        return null;
      }

      return session;
    },
    createPending: async (session: Record<string, unknown>) => {
      const created = {
        id: state.nextSessionId++,
        ...session,
        refresh_token_hash: "",
        is_active: true,
        last_active_at: new Date().toISOString(),
      };
      state.sessions.set(created.id, created);
      return created;
    },
    updateRefreshTokenHash: async (
      sessionId: number,
      refreshTokenHash: string,
    ) => {
      const session = state.sessions.get(sessionId);

      if (!session) {
        throw new Error("Session not found.");
      }

      session.refresh_token_hash = refreshTokenHash;
      return session;
    },
    revoke: async (sessionId: number) => {
      const session = state.sessions.get(sessionId);

      if (session) {
        session.is_active = false;
      }

      return session ?? null;
    },
    revokeActiveByAccountIdExcept: async (
      accountId: number,
      exceptSessionId: number,
    ) => {
      for (const session of state.sessions.values()) {
        if (
          session.account_id === accountId &&
          session.id !== exceptSessionId
        ) {
          session.is_active = false;
        }
      }
    },
  },
};

export const workerNotificationRepositoryMock = {
  createWorkerNotification: async (input: {
    worker_account_id: number;
    type: string;
    notification_key?: string | null;
    lang?: string | null;
    title: string;
    message: string;
    payload?: unknown;
  }) => {
    const now = new Date().toISOString();
    const record = {
      id: state.nextWorkerNotificationId++,
      worker_account_id: input.worker_account_id,
      type: input.type,
      notification_key: input.notification_key ?? null,
      lang: input.lang ?? "TH",
      title: input.title,
      message: input.message,
      payload: input.payload ?? null,
      read_at: null,
      created_at: now,
      updated_at: now,
    };

    state.workerNotifications.push(record);

    return record;
  },
  createWorkerNotifications: async (
    inputs: Array<{
      worker_account_id: number;
      type: string;
      notification_key?: string | null;
      lang?: string | null;
      title: string;
      message: string;
      payload?: unknown;
    }>,
  ) => {
    for (const input of inputs) {
      await workerNotificationRepositoryMock.createWorkerNotification(input);
    }
  },
  listWorkerNotifications: async (
    workerAccountId: number,
    page: number,
    limit: number,
  ) => {
    const filtered = state.workerNotifications
      .filter((item) => item.worker_account_id === workerAccountId)
      .sort((left, right) =>
        right.created_at.localeCompare(left.created_at) || right.id - left.id
      );

    return {
      total: filtered.length,
      items: filtered.slice((page - 1) * limit, page * limit),
    };
  },
};

export const workerPushTokenRepositoryMock = {
  upsertWorkerPushToken: async (input: {
    worker_code: string;
    session_id?: number | null;
    device_id: string;
    platform?: string | null;
    fcm_token: string;
  }) => {
    const platform = input.platform ?? "unknown";
    const existingIndex = state.workerPushTokens.findIndex(
      (token) =>
        token.worker_code === input.worker_code &&
        token.device_id === input.device_id &&
        token.platform === platform,
    );
    const token = {
      worker_code: input.worker_code,
      session_id: input.session_id ?? null,
      device_id: input.device_id,
      platform,
      fcm_token: input.fcm_token,
      fcm_token_hash: `hash:${input.fcm_token}`,
      is_active: true,
    };

    if (existingIndex >= 0) {
      state.workerPushTokens[existingIndex] = token;
    } else {
      state.workerPushTokens.push(token);
    }

    return {
      id:
        existingIndex >= 0 ? existingIndex + 1 : state.workerPushTokens.length,
      ...token,
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  },
  listActiveTokensByWorkerCodes: async (workerCodes: string[]) =>
    state.workerPushTokens
      .filter(
        (token) => token.is_active && workerCodes.includes(token.worker_code),
      )
      .map((token, index) => ({
        id: index + 1,
        ...token,
        last_seen_at: new Date().toISOString(),
        revoked_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
  listAllActiveTokens: async () =>
    state.workerPushTokens
      .filter((token) => token.is_active)
      .map((token, index) => ({
        id: index + 1,
        ...token,
        last_seen_at: new Date().toISOString(),
        revoked_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
  listActiveTokensBySessionId: async (sessionId: number) =>
    state.workerPushTokens
      .filter((token) => token.is_active && token.session_id === sessionId)
      .map((token, index) => ({
        id: index + 1,
        ...token,
        last_seen_at: new Date().toISOString(),
        revoked_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
  revokeBySessionId: async (sessionId: number) => {
    let count = 0;

    for (const token of state.workerPushTokens) {
      if (token.session_id === sessionId && token.is_active) {
        token.is_active = false;
        count += 1;
      }
    }

    return count;
  },
  revokeByTokenHashes: async (hashes: string[]) => {
    let count = 0;

    for (const token of state.workerPushTokens) {
      if (hashes.includes(token.fcm_token_hash) && token.is_active) {
        token.is_active = false;
        count += 1;
      }
    }

    return count;
  },
};

// Function ค้นหา worker account ตาม identifier สำหรับ test
function findWorkerAccountByIdentifier(
  identifier: string,
): AccountRecord | null {
  const directAccount = state.authAccountsByUsername.get(identifier);

  if (directAccount?.role === "worker") {
    return directAccount;
  }

  const profile = (
    Array.from(state.profiles.values()) as Array<{
      account_id: number;
      worker_code?: string;
    }>
  ).find((item) => item.worker_code === identifier);

  if (!profile) {
    return null;
  }

  const account = state.authAccountsById.get(profile.account_id);

  return account?.role === "worker" ? account : null;
}

export const adminWorkersRepositoryMock = {
  accountRepository: {
    findUserById: async (accountId: number | string) => {
      const account = state.authAccountsById.get(Number(accountId));

      return account?.role === "worker" ? account : null;
    },
    findUserByIdentifier: async (identifier: string) =>
      findWorkerAccountByIdentifier(identifier),
    listAllUsers: async () =>
      Array.from(state.authAccountsById.values())
        .filter((account) => account.role === "worker")
        .sort((left, right) => right.id - left.id),
    listUsers: async (filters: {
      status?: string;
      search?: string;
      offset?: number;
      limit?: number;
    }) => {
      let users = Array.from(state.authAccountsById.values())
        .filter((account) => account.role === "worker")
        .sort((left, right) => right.id - left.id);

      if (filters.status) {
        users = users.filter((account) => account.status === filters.status);
      }

      if (filters.search) {
        const needle = filters.search.toLowerCase();

        users = users.filter(
          (account) =>
            account.username.toLowerCase().includes(needle) ||
            account.full_name.toLowerCase().includes(needle),
        );
      }

      const offset = filters.offset ?? 0;
      const limit = filters.limit ?? users.length;

      return users.slice(offset, offset + limit);
    },
    countUsers: async (filters: { status?: string; search?: string }) => {
      let users = Array.from(state.authAccountsById.values()).filter(
        (account) => account.role === "worker",
      );

      if (filters.status) {
        users = users.filter((account) => account.status === filters.status);
      }

      if (filters.search) {
        const needle = filters.search.toLowerCase();

        users = users.filter(
          (account) =>
            account.username.toLowerCase().includes(needle) ||
            account.full_name.toLowerCase().includes(needle),
        );
      }

      return users.length;
    },
  },
  profileRepository: {
    findByAccountId: async (accountId: number) =>
      state.profiles.get(accountId) ?? null,
    findByAccountIds: async (accountIds: number[]) =>
      accountIds
        .map((accountId) => state.profiles.get(accountId) ?? null)
        .filter(
          (profile): profile is NonNullable<typeof profile> => profile !== null,
        ),
  },
  workScheduleRepository: {
    findCurrentByAccountId: async (accountId: number) =>
      state.authSchedules.get(accountId) ?? null,
    listCurrentByAccountId: async (accountId: number) => {
      const schedule = state.authSchedules.get(accountId);

      return schedule ? [schedule] : [];
    },
    findById: async (scheduleId: number) =>
      Array.from(state.authSchedules.values()).find(
        (schedule) => (schedule as { id?: number }).id === scheduleId,
      ) ?? null,
  },
  sessionRepository: authRepositoryMock.sessionRepository,
};

export const adminSettingsRepositoryMock = {
  accountRepository: {
    findAdminById: async (accountId: number) => {
      const account = state.authAccountsById.get(accountId);

      return account?.role === "admin" ? account : null;
    },
    listAdmins: async () =>
      Array.from(state.authAccountsById.values())
        .filter((account) => account.role === "admin")
        .sort((left, right) => left.id - right.id),
    usernameExists: async (username: string) =>
      state.authAccountsByUsername.has(username),
    createAdmin: async (account: {
      username: string;
      password_hash: string;
      role: "admin";
      status?: string;
      full_name: string;
      position?: string | null;
      email?: string | null;
      phone?: string | null;
      permission_level?: string | null;
      created_by?: number | null;
    }) => {
      const nextId = Math.max(0, ...state.authAccountsById.keys()) + 1;
      const created: AccountRecord = {
        id: nextId,
        username: account.username,
        password_hash: account.password_hash,
        role: "admin",
        status: account.status ?? "active",
        full_name: account.full_name,
        position: account.position ?? null,
        email: account.email ?? null,
        phone: account.phone ?? null,
        permission_level: account.permission_level ?? null,
        lang: "TH",
      };

      state.authAccountsByUsername.set(created.username, created);
      state.authAccountsById.set(created.id, created);

      return created;
    },
    updatePermissionLevel: async (
      accountId: number,
      permissionLevel: string,
    ) => {
      const account = state.authAccountsById.get(accountId);

      if (!account) {
        throw new Error("Admin account not found.");
      }

      account.permission_level = permissionLevel;
      return account;
    },
    updateStatus: async (accountId: number, status: string) => {
      const account = state.authAccountsById.get(accountId);

      if (!account) {
        throw new Error("Admin account not found.");
      }

      account.status = status;
      return account;
    },
    sanitizeAccount: (account: AccountRecord | null) => {
      if (!account) {
        return null;
      }

      const { password_hash: _passwordHash, ...safeAccount } = account;
      return safeAccount;
    },
  },
  permissionRepository: {
    listByAccountId: async (accountId: number) =>
      state.adminPermissions.get(accountId) ?? [],
    replaceAccountPermissions: async (
      accountId: number,
      permissions: string[],
    ) => {
      state.adminPermissions.set(accountId, permissions);
    },
  },
  sessionRepository: {
    revokeActiveByAccountId: async (accountId: number) => {
      for (const session of state.sessions.values()) {
        if (session.account_id === accountId) {
          session.is_active = false;
        }
      }
    },
  },
};

export const systemSettingRepositoryMock = {
  listSettings: async () => [],
  upsertSettings: async () => {},
};

export const gateClientRepositoryMock = {
  listGateClients: async () =>
    Array.from(state.gateClients.values()).sort(
      (left, right) => left.id - right.id,
    ),
  findByClientId: async (clientId: string) =>
    state.gateClients.get(clientId) ?? null,
  clientIdExists: async (clientId: string) => state.gateClients.has(clientId),
  createGateClient: async (input: {
    client_id: string;
    name: string;
    secret_hash: string;
    status?: "active" | "inactive";
    created_by?: number | null;
    updated_by?: number | null;
  }) => {
    const now = new Date().toISOString();
    const created: GateClientRecord = {
      id: state.nextGateClientId++,
      client_id: input.client_id,
      name: input.name,
      secret_hash: input.secret_hash,
      status: input.status ?? "active",
      last_used_at: null,
      created_by: input.created_by ?? null,
      updated_by: input.updated_by ?? null,
      created_at: now,
      updated_at: now,
    };

    state.gateClients.set(created.client_id, created);

    return created;
  },
  updateGateClient: async (
    clientId: string,
    input: {
      name?: string;
      status?: "active" | "inactive";
      updated_by?: number | null;
    },
  ) => {
    const existing = state.gateClients.get(clientId);

    if (!existing) {
      throw new Error("Gate client not found.");
    }

    existing.name = input.name ?? existing.name;
    existing.status = input.status ?? existing.status;
    existing.updated_by = input.updated_by ?? null;
    existing.updated_at = new Date().toISOString();

    return existing;
  },
  updateGateClientSecret: async (
    clientId: string,
    secretHash: string,
    updatedBy?: number | null,
  ) => {
    const existing = state.gateClients.get(clientId);

    if (!existing) {
      throw new Error("Gate client not found.");
    }

    existing.secret_hash = secretHash;
    existing.updated_by = updatedBy ?? null;
    existing.updated_at = new Date().toISOString();

    return existing;
  },
  updateLastUsedAt: async (clientId: string) => {
    const existing = state.gateClients.get(clientId);

    if (!existing) {
      throw new Error("Gate client not found.");
    }

    existing.last_used_at = new Date().toISOString();
    existing.updated_at = existing.last_used_at;
  },
};

export const mobileAppVersionRepositoryMock = {
  listMobileAppVersions: async () =>
    [...state.mobileAppVersions].sort((left, right) => right.build_number - left.build_number),
  findMobileAppVersionById: async (id: number) =>
    state.mobileAppVersions.find((version) => version.id === id) ?? null,
  findMobileAppVersionByBuildNumber: async (buildNumber: number) =>
    state.mobileAppVersions.find((version) => version.build_number === buildNumber) ?? null,
  createMobileAppVersion: async (input: {
    version: string;
    build_number: number;
    release_at?: string | null;
    android_download_url?: string | null;
    ios_download_url?: string | null;
    force_update_at?: string | null;
    release_notification_at?: string | null;
    release_message?: string | null;
    release_notes?: string | null;
    created_by?: number | null;
    updated_by?: number | null;
  }) => {
    const now = new Date().toISOString();
    const created = {
      id: state.nextMobileAppVersionId++,
      version: input.version,
      build_number: input.build_number,
      release_at: input.release_at ?? null,
      android_download_url: input.android_download_url ?? null,
      ios_download_url: input.ios_download_url ?? null,
      force_update_at: input.force_update_at ?? null,
      release_notification_at: input.release_notification_at ?? null,
      release_notification_sent_at: null,
      force_update_notification_sent_at: null,
      release_message: input.release_message ?? null,
      release_notes: input.release_notes ?? null,
      created_by: input.created_by ?? null,
      updated_by: input.updated_by ?? null,
      created_at: now,
      updated_at: now,
    };

    state.mobileAppVersions.push(created);

    return created;
  },
  updateMobileAppVersion: async (
    id: number,
    input: {
      version?: string;
      build_number?: number;
      release_at?: string | null;
      android_download_url?: string | null;
      ios_download_url?: string | null;
      force_update_at?: string | null;
      release_notification_at?: string | null;
      release_notification_sent_at?: string | null;
      force_update_notification_sent_at?: string | null;
      release_message?: string | null;
      release_notes?: string | null;
      updated_by?: number | null;
    },
  ) => {
    const existing = state.mobileAppVersions.find((version) => version.id === id);

    if (!existing) {
      throw new Error("Mobile app version not found.");
    }

    if (input.version !== undefined) existing.version = input.version;
    if (input.build_number !== undefined) existing.build_number = input.build_number;
    if (input.release_at !== undefined) existing.release_at = input.release_at;
    if (input.android_download_url !== undefined) existing.android_download_url = input.android_download_url;
    if (input.ios_download_url !== undefined) existing.ios_download_url = input.ios_download_url;
    if (input.force_update_at !== undefined) existing.force_update_at = input.force_update_at;
    if (input.release_notification_at !== undefined) existing.release_notification_at = input.release_notification_at;
    if (input.release_notification_sent_at !== undefined) existing.release_notification_sent_at = input.release_notification_sent_at;
    if (input.force_update_notification_sent_at !== undefined) existing.force_update_notification_sent_at = input.force_update_notification_sent_at;
    if (input.release_message !== undefined) existing.release_message = input.release_message;
    if (input.release_notes !== undefined) existing.release_notes = input.release_notes;
    existing.updated_by = input.updated_by ?? null;
    existing.updated_at = new Date().toISOString();

    return existing;
  },
  claimReleaseNotificationSent: async (id: number) => {
    const existing = state.mobileAppVersions.find((version) => version.id === id);

    if (existing && !existing.release_notification_sent_at) {
      existing.release_notification_sent_at = new Date().toISOString();
      return true;
    }

    return false;
  },
  claimForceUpdateNotificationSent: async (id: number) => {
    const existing = state.mobileAppVersions.find((version) => version.id === id);

    if (existing && !existing.force_update_notification_sent_at) {
      existing.force_update_notification_sent_at = new Date().toISOString();
      return true;
    }

    return false;
  },
};

// Function จำลอง Prisma include ต้นแบบ AdminVehicleJobHistoryRecord (Work History) สำหรับ test
function buildAdminVehicleJobHistoryRecordForTest(vehicleJobId: number) {
  const vehicleJob = state.vehicleJobs.find((job) => job.id === vehicleJobId);

  if (!vehicleJob) {
    throw new Error("Vehicle job not found for admin history test.");
  }

  const resolveWorker = (workerAccountId: number) => {
    const worker =
      state.workers.get(workerAccountId) ??
      state.authAccountsById.get(workerAccountId);

    if (!worker) {
      throw new Error("Worker account not found for admin history test.");
    }

    return {
      id: worker.id,
      username: worker.username,
      fullName: worker.full_name,
      shirtNumber: worker.shirt_number ?? null,
      shiftNo: worker.shift_no ?? null,
    };
  };

  const marketJobs = state.marketJobs
    .filter((market) => market.vehicle_job_id === vehicleJobId)
    .sort((left, right) => left.id - right.id);

  return {
    id: vehicleJob.id,
    ticketNumber: vehicleJob.ticket_number,
    licensePlate: vehicleJob.license_plate,
    licensePlateProvince: vehicleJob.license_plate_province,
    vehicleType: vehicleJob.vehicle_type,
    workersRequired: vehicleJob.workers_required,
    dispatchNow: vehicleJob.dispatch_now,
    status: vehicleJob.status,
    createdAt: new Date(vehicleJob.created_at),
    updatedAt: new Date(vehicleJob.updated_at),

    assignments: state.assignments
      .filter((assignment) => assignment.vehicle_job_id === vehicleJobId)
      .sort((left, right) => left.id - right.id)
      .map((assignment) => ({
        id: assignment.id,
        vehicleJobId: assignment.vehicle_job_id,
        workerAccountId: assignment.worker_account_id,
        status: assignment.status,
        acceptedAt: assignment.accepted_at ? new Date(assignment.accepted_at) : null,
        scannedAt: assignment.scanned_at ? new Date(assignment.scanned_at) : null,
        completedAt: assignment.completed_at ? new Date(assignment.completed_at) : null,
        releasedAt: assignment.released_at ? new Date(assignment.released_at) : null,
        createdAt: new Date(assignment.created_at ?? vehicleJob.created_at),
        updatedAt: new Date(assignment.updated_at ?? vehicleJob.updated_at),
        worker: resolveWorker(assignment.worker_account_id),
        events: state.workerAssignmentEvents
          .filter((event) => event.assignment_id === assignment.id)
          .sort((left, right) => left.id - right.id)
          .map((event) => ({
            id: event.id,
            assignmentId: event.assignment_id,
            eventType: event.event_type,
            occurredAt: new Date(event.occurred_at),
          })),
      })),

    marketJobs: marketJobs.map((marketJob) => {
      const ticketWorkers = state.ticketWorkers
        .filter((worker) => worker.market_job_id === marketJob.id)
        .sort((left, right) => left.id - right.id);
      const tickets = state.gateTickets
        .filter((ticket) => ticket.market_job_id === marketJob.id)
        .sort((left, right) => left.id - right.id);

      return {
        id: marketJob.id,
        ticketNo: marketJob.ticket_no,
        marketCode: marketJob.marketCode,
        marketName: marketJob.marketName,
        dropoffPoint: marketJob.dropoff_point,
        status: marketJob.status,
        completedAt: marketJob.completed_at ? new Date(marketJob.completed_at) : null,
        createdAt: new Date(marketJob.created_at),
        updatedAt: new Date(marketJob.updated_at),

        ticketWorkers: ticketWorkers.map((ticketWorker) => ({
          id: ticketWorker.id,
          workerAccountId: ticketWorker.worker_account_id,
          status: ticketWorker.status,
          worker: resolveWorker(ticketWorker.worker_account_id),
          payments: state.ticketWorkerPayments
            .filter((payment) => payment.ticket_worker_id === ticketWorker.id)
            .sort((left, right) => left.id - right.id)
            .map((payment) => ({
              finalAmount: new Prisma.Decimal(payment.final_amount),
            })),
        })),

        tickets: tickets.map((ticket) => {
          const products = state.ticketProducts
            .filter((product) => product.ticket_id === ticket.id)
            .sort((left, right) => left.id - right.id);
          const completionSubmissions = state.completionSubmissions
            .filter((submission) => submission.ticket_id === ticket.id)
            .sort((left, right) => left.id - right.id);

          return {
            id: ticket.id,
            boothCode: ticket.boothCode,
            boothName: ticket.boothName,
            vendorLineId: ticket.vendor_line_id,
            rejectReason: ticket.reject_reason,
            status: ticket.status,
            finalStallAmount:
              ticket.final_stall_amount === null || ticket.final_stall_amount === undefined
                ? null
                : new Prisma.Decimal(ticket.final_stall_amount),
            completedAt: ticket.completed_at ? new Date(ticket.completed_at) : null,
            financializedAt: ticket.financialized_at
              ? new Date(ticket.financialized_at)
              : null,

            completionSubmissions: completionSubmissions.map((submission) => ({
              id: submission.id,
              ticketId: submission.ticket_id,
              status: submission.status,
              confirmedAt: submission.confirmed_at ? new Date(submission.confirmed_at) : null,
              rejectedAt: submission.rejected_at ? new Date(submission.rejected_at) : null,
              createdAt: new Date(submission.created_at ?? ticket.created_at ?? vehicleJob.created_at),
              submittedByWorkerAccountId: submission.submitted_by_worker_account_id,
              submittedByWorker: resolveWorker(submission.submitted_by_worker_account_id),
            })),

            products: products.map((product) => {
              const financial =
                state.ticketProductFinancials.find(
                  (item) => item.ticket_product_id === product.id,
                ) ?? null;

              return {
                id: product.id,
                productCode: product.productCode,
                productFullCode: product.productFullCode,
                productName: product.productName,
                packageCode: product.packageCode,
                packageName: product.packageName,
                quantity: new Prisma.Decimal(product.quantity),
                confirmedQuantity:
                  product.confirmed_quantity === null
                    ? null
                    : new Prisma.Decimal(product.confirmed_quantity),
                packageWeightSnapshot:
                  product.package_weight_snapshot === null
                    ? null
                    : new Prisma.Decimal(product.package_weight_snapshot),
                rateIdSnapshot: product.rate_id_snapshot,
                sourceRateIdSnapshot: product.source_rate_id_snapshot,
                rateMarketCode: product.rate_market_code,
                rateSource: product.rate_source,
                weightRangeName: product.weight_range_name,
                weightMinSnapshot:
                  product.weight_min_snapshot === null
                    ? null
                    : new Prisma.Decimal(product.weight_min_snapshot),
                weightMaxSnapshot:
                  product.weight_max_snapshot === null
                    ? null
                    : new Prisma.Decimal(product.weight_max_snapshot),
                stallRateSnapshot:
                  product.stall_rate_snapshot === null
                    ? null
                    : new Prisma.Decimal(product.stall_rate_snapshot),
                laborRateSnapshot:
                  product.labor_rate_snapshot === null
                    ? null
                    : new Prisma.Decimal(product.labor_rate_snapshot),
                rateSnapshotAt: product.rate_snapshot_at
                  ? new Date(product.rate_snapshot_at)
                  : null,

                financial: financial
                  ? {
                    stallFeeRaw: new Prisma.Decimal(financial.stall_fee_raw),
                    stallFeeRounded: new Prisma.Decimal(financial.stall_fee_rounded),
                    laborFeeRaw: new Prisma.Decimal(financial.labor_fee_raw),
                    productCharge: new Prisma.Decimal(financial.product_charge),
                    workerCount: financial.worker_count,
                    workerPayoutTotal: new Prisma.Decimal(financial.worker_payout_total),
                    fundAmount: new Prisma.Decimal(financial.fund_amount),
                    finalizedAt: new Date(financial.finalized_at),
                    workerPayments: state.ticketWorkerPayments
                      .filter(
                        (payment) => payment.ticket_product_financial_id === financial.id,
                      )
                      .sort((left, right) => left.id - right.id)
                      .map((payment) => {
                        const ticketWorker = state.ticketWorkers.find(
                          (worker) => worker.id === payment.ticket_worker_id,
                        );

                        if (!ticketWorker) {
                          throw new Error(
                            "Ticket worker not found for admin history test.",
                          );
                        }

                        return {
                          rawAmount: new Prisma.Decimal(payment.raw_amount),
                          remainderAmount: new Prisma.Decimal(payment.remainder_amount),
                          finalAmount: new Prisma.Decimal(payment.final_amount),
                          ticketWorker: {
                            id: ticketWorker.id,
                            status: ticketWorker.status,
                            worker: resolveWorker(ticketWorker.worker_account_id),
                          },
                        };
                      }),
                  }
                  : null,
              };
            }),
          };
        }),
      };
    }),
  };
}

// Function จำลอง Prisma include ต้นแบบ DailyWorkerIncomeRecord สำหรับ test
function buildDailyWorkerIncomeRecordForTest(ticketWorkerId: number) {
  const ticketWorker = state.ticketWorkers.find((item) => item.id === ticketWorkerId);

  if (!ticketWorker) {
    throw new Error("Ticket worker not found for daily worker income test.");
  }

  const marketJob = state.marketJobs.find(
    (market) => market.id === ticketWorker.market_job_id,
  );

  if (!marketJob) {
    throw new Error("Market job not found for daily worker income test.");
  }

  const vehicleJob = state.vehicleJobs.find(
    (job) => job.id === marketJob.vehicle_job_id,
  );

  if (!vehicleJob) {
    throw new Error("Vehicle job not found for daily worker income test.");
  }

  const worker =
    state.workers.get(ticketWorker.worker_account_id) ??
    state.authAccountsById.get(ticketWorker.worker_account_id);

  if (!worker) {
    throw new Error("Worker account not found for daily worker income test.");
  }

  const tickets = state.gateTickets
    .filter((ticket) => ticket.market_job_id === marketJob.id)
    .sort((left, right) => left.id - right.id);

  return {
    id: ticketWorker.id,
    workerAccountId: ticketWorker.worker_account_id,
    status: ticketWorker.status,
    finalEarningAmount:
      ticketWorker.final_earning_amount === null ||
        ticketWorker.final_earning_amount === undefined
        ? null
        : new Prisma.Decimal(ticketWorker.final_earning_amount),
    joinedAt: new Date(ticketWorker.joined_at),
    cancelledAt: ticketWorker.cancelled_at ? new Date(ticketWorker.cancelled_at) : null,
    completedAt: ticketWorker.completed_at ? new Date(ticketWorker.completed_at) : null,

    worker: {
      id: worker.id,
      username: worker.username,
      fullName: worker.full_name,
      shirtNumber: worker.shirt_number ?? null,
      shiftNo: worker.shift_no ?? null,
    },

    marketJob: {
      id: marketJob.id,
      ticketNo: marketJob.ticket_no,
      marketCode: marketJob.marketCode,
      completedAt: marketJob.completed_at ? new Date(marketJob.completed_at) : null,

      vehicleJob: {
        id: vehicleJob.id,
        ticketNumber: vehicleJob.ticket_number,
        licensePlate: vehicleJob.license_plate,
        assignments: state.assignments
          .filter((assignment) => assignment.vehicle_job_id === vehicleJob.id)
          .sort((left, right) => left.id - right.id)
          .map((assignment) => ({
            id: assignment.id,
            workerAccountId: assignment.worker_account_id,
            acceptedAt: assignment.accepted_at ? new Date(assignment.accepted_at) : null,
            scannedAt: assignment.scanned_at ? new Date(assignment.scanned_at) : null,
            releasedAt: assignment.released_at ? new Date(assignment.released_at) : null,
            createdAt: new Date(assignment.created_at ?? vehicleJob.created_at),
          })),
      },

      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        status: ticket.status,
        finalStallAmount:
          ticket.final_stall_amount === null || ticket.final_stall_amount === undefined
            ? null
            : new Prisma.Decimal(ticket.final_stall_amount),
        completionSubmissions: state.completionSubmissions
          .filter((submission) => submission.ticket_id === ticket.id)
          .sort((left, right) => left.id - right.id)
          .map((submission) => ({
            id: submission.id,
            submittedByWorkerAccountId: submission.submitted_by_worker_account_id,
            createdAt: new Date(submission.created_at ?? ticket.created_at ?? vehicleJob.created_at),
          })),
      })),
    },
  };
}

// Mock repository สำหรับ Admin VehicleJob Financial route test
export const adminJobsRepositoryMock = {
  findVehicleJobByRef: async (ticketNumber: string) =>
    state.vehicleJobs.find((job) => job.ticket_number === ticketNumber) ?? null,

  findVehicleJobById: async (vehicleJobId: number) =>
    state.vehicleJobs.find((job) => job.id === vehicleJobId) ?? null,

  findMarketJobById: async (marketJobId: number) =>
    state.marketJobs.find((market) => market.id === marketJobId) ?? null,

  findMarketJobByRef: async (marketCode: string) =>
    [...state.marketJobs]
      .reverse()
      .find((market) => market.marketCode === marketCode) ?? null,

  findGateTicketByRef: async (boothCode: string) =>
    [...state.gateTickets]
      .reverse()
      .find((ticket) => ticket.boothCode === boothCode) ?? null,

  listActiveAssignmentsByVehicleJob: async (vehicleJobId: number) =>
    state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
        ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status),
    ),

  listAcceptedAssignmentsByVehicleJob: async (
    vehicleJobId: number,
    workerCodes?: string[],
  ) => {
    const workerAccountIds = workerCodes?.length
      ? new Set(
          Array.from(state.workers.values())
            .filter((worker) => workerCodes.includes(worker.username))
            .map((worker) => worker.id),
        )
      : null;

    return state.assignments.filter(
      (assignment) =>
        assignment.vehicle_job_id === vehicleJobId &&
        assignment.status === "ACCEPTED" &&
        (!workerAccountIds || workerAccountIds.has(assignment.worker_account_id)),
    );
  },

  extendAssignmentScanDeadline: async (
    assignmentId: number,
    scanDeadlineAt: Date,
  ) => {
    const assignment = state.assignments.find(
      (item) => item.id === assignmentId,
    );

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    assignment.scan_deadline_at = scanDeadlineAt.toISOString();
    assignment.updated_at = new Date().toISOString();
    return assignment;
  },

  // Function ยกเลิก vehicle job (ทั้ง TicketNumber) จาก DB
  cancelVehicleJob: async (vehicleJobId: number) => {
    const job = state.vehicleJobs.find((item) => item.id === vehicleJobId);

    if (!job) {
      throw new Error("Vehicle job not found.");
    }

    const now = new Date().toISOString();

    state.ticketWorkers
      .filter((ticketWorker) => {
        if (ticketWorker.status !== "WORKING") {
          return false;
        }

        const marketJob = state.marketJobs.find(
          (market) => market.id === ticketWorker.market_job_id,
        );

        return marketJob?.vehicle_job_id === vehicleJobId;
      })
      .forEach((ticketWorker) => {
        ticketWorker.status = "CANCELLED";
        ticketWorker.cancelled_at = now;
        ticketWorker.completed_at = null;
      });

    state.assignments
      .filter(
        (assignment) =>
          assignment.vehicle_job_id === vehicleJobId &&
          ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status),
      )
      .forEach((assignment) => {
        assignment.status = "CANCELLED";
        assignment.updated_at = now;
      });

    state.marketJobs
      .filter((market) => market.vehicle_job_id === vehicleJobId)
      .forEach((market) => {
        market.status = "CANCELLED";
        market.updated_at = now;
      });

    state.gateTickets
      .filter((ticket) => ticket.vehicle_job_id === vehicleJobId)
      .forEach((ticket) => {
        ticket.status = "CANCELLED";
        ticket.updated_at = now;
      });

    job.status = "CANCELLED";
    job.updated_at = now;

    return job;
  },

  // Function ยกเลิก Business Ticket (market job) จาก DB
  cancelMarketJob: async (marketJobId: number) => {
    const marketJob = state.marketJobs.find((item) => item.id === marketJobId);

    if (!marketJob) {
      throw new Error("Market job not found.");
    }

    const now = new Date().toISOString();

    state.ticketWorkers
      .filter(
        (ticketWorker) =>
          ticketWorker.market_job_id === marketJobId &&
          ticketWorker.status === "WORKING",
      )
      .forEach((ticketWorker) => {
        ticketWorker.status = "CANCELLED";
        ticketWorker.cancelled_at = now;
        ticketWorker.completed_at = null;
      });

    state.gateTickets
      .filter((ticket) => ticket.market_job_id === marketJobId)
      .forEach((ticket) => {
        ticket.status = "CANCELLED";
        ticket.updated_at = now;
      });

    marketJob.status = "CANCELLED";
    marketJob.updated_at = now;

    return marketJob;
  },

  // Function ยกเลิก Gate ticket (booth) จาก DB — ไม่แตะ TicketWorker (Roster) อีกต่อไป
  cancelGateTicket: async (ticketId: number) => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);

    if (!ticket) {
      throw new Error("Gate ticket not found.");
    }

    ticket.status = "CANCELLED";
    ticket.updated_at = new Date().toISOString();

    return ticket;
  },

  // Function ยกเลิก Worker หนึ่งคนออกจาก Business Ticket ใบเดียว
  cancelTicketWorkerForMarketJob: async (
    marketJobId: number,
    workerAccountId: number,
  ) => {
    const ticketWorker = state.ticketWorkers.find(
      (worker) =>
        worker.market_job_id === marketJobId &&
        worker.worker_account_id === workerAccountId &&
        worker.status === "WORKING",
    );

    if (!ticketWorker) {
      return false;
    }

    ticketWorker.status = "CANCELLED";
    ticketWorker.cancelled_at = new Date().toISOString();
    ticketWorker.completed_at = null;

    return true;
  },

  findWorkerByCode: async (workerCode: string) =>
    Array.from(state.workers.values()).find(
      (worker) => worker.username === workerCode,
    ) ?? null,

  findCurrentAssignmentByWorker: async (workerAccountId: number) =>
    state.assignments.find(
      (assignment) =>
        assignment.worker_account_id === workerAccountId &&
        ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status),
    ) ?? null,

  createAssignment: async (
    vehicleJobId: number,
    workerAccountId: number,
    acceptDeadlineAt: Date,
  ) => {
    const now = new Date().toISOString();

    const assignment = {
      id: state.nextAssignmentId++,
      vehicle_job_id: vehicleJobId,
      worker_account_id: workerAccountId,
      status: "PENDING",
      accept_deadline_at: acceptDeadlineAt.toISOString(),
      scan_deadline_at: null,
      accepted_at: null,
      scanned_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    };

    state.assignments.push(assignment);
    recordWorkerAssignmentEventOnce(
      assignment,
      "ASSIGNED",
      null,
      assignment.created_at,
    );

    return assignment;
  },

  findActiveAssignmentByVehicleJobRefAndWorkerCode: async (
    ticketNumber: string,
    workerCode: string,
  ) => {
    const vehicleJob = state.vehicleJobs.find(
      (job) => job.ticket_number === ticketNumber,
    );

    const worker = Array.from(state.workers.values()).find(
      (item) => item.username === workerCode,
    );

    if (!vehicleJob || !worker) {
      return null;
    }

    return (
      [...state.assignments]
        .reverse()
        .find(
          (assignment) =>
            assignment.vehicle_job_id === vehicleJob.id &&
            assignment.worker_account_id === worker.id &&
            ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status),
        ) ?? null
    );
  },

  cancelAssignment: async (assignmentId: number) => {
    const assignment = state.assignments.find(
      (item) => item.id === assignmentId,
    );

    if (!assignment) {
      throw new Error("Assignment not found.");
    }

    const now = new Date().toISOString();

    assignment.status = "CANCELLED";
    assignment.updated_at = now;
    recordWorkerAssignmentEventOnce(
      assignment,
      "ADMIN_CANCELLED",
      {
        source: "admin_assignment_cancel",
      },
      now,
    );

    state.ticketWorkers
      .filter((ticketWorker) => {
        if (
          ticketWorker.worker_account_id !== assignment.worker_account_id ||
          ticketWorker.status !== "WORKING"
        ) {
          return false;
        }

        const marketJob = state.marketJobs.find(
          (market) => market.id === ticketWorker.market_job_id,
        );

        return (
          marketJob?.vehicle_job_id === assignment.vehicle_job_id &&
          !["COMPLETED", "CANCELLED"].includes(marketJob.status)
        );
      })
      .forEach((ticketWorker) => {
        ticketWorker.status = "CANCELLED";
        ticketWorker.cancelled_at = now;
        ticketWorker.completed_at = null;
      });

    return assignment;
  },
  findVehicleJobFinancialByRef: async (ticketNumber: string) => {
    const vehicleJob = state.vehicleJobs.find(
      (job) => job.ticket_number === ticketNumber,
    );

    if (!vehicleJob) {
      return null;
    }

    const marketJobs = state.marketJobs
      .filter((market) => market.vehicle_job_id === vehicleJob.id)
      .sort((left, right) => left.id - right.id);

    return {
      id: vehicleJob.id,
      ticketNumber: vehicleJob.ticket_number,
      licensePlate: vehicleJob.license_plate,
      licensePlateProvince: vehicleJob.license_plate_province,
      vehicleType: vehicleJob.vehicle_type,
      status: vehicleJob.status,

      marketJobs: marketJobs.map((marketJob) => {
        const ticketWorkers = state.ticketWorkers
          .filter((worker) => worker.market_job_id === marketJob.id)
          .sort((left, right) => left.id - right.id);
        const tickets = state.gateTickets
          .filter((ticket) => ticket.market_job_id === marketJob.id)
          .sort((left, right) => left.id - right.id);

        return {
          id: marketJob.id,
          ticketNo: marketJob.ticket_no,
          marketCode: marketJob.marketCode,
          marketName: marketJob.marketName,

          ticketWorkers: ticketWorkers.map((ticketWorker) => {
            const worker =
              state.workers.get(ticketWorker.worker_account_id) ??
              state.authAccountsById.get(ticketWorker.worker_account_id);

            if (!worker) {
              throw new Error(
                "Worker account not found for admin financial test.",
              );
            }

            return {
              id: ticketWorker.id,
              status: ticketWorker.status,

              worker: {
                username: worker.username,
                fullName: worker.full_name,
              },

              payments: state.ticketWorkerPayments
                .filter(
                  (payment) => payment.ticket_worker_id === ticketWorker.id,
                )
                .sort((left, right) => left.id - right.id)
                .map((payment) => ({
                  finalAmount: new Prisma.Decimal(payment.final_amount),
                })),
            };
          }),

          tickets: tickets.map((ticket) => {
            const products = state.ticketProducts
              .filter((product) => product.ticket_id === ticket.id)
              .sort((left, right) => left.id - right.id);

            return {
              id: ticket.id,
              boothCode: ticket.boothCode,
              boothName: ticket.boothName,
              status: ticket.status,

              finalStallAmount:
                ticket.final_stall_amount === null ||
                ticket.final_stall_amount === undefined
                  ? null
                  : new Prisma.Decimal(ticket.final_stall_amount),

              completedAt: ticket.completed_at
                ? new Date(ticket.completed_at)
                : null,

              financializedAt: ticket.financialized_at
                ? new Date(ticket.financialized_at)
                : null,

              products: products.map((product) => {
            const financial =
              state.ticketProductFinancials.find(
                (item) => item.ticket_product_id === product.id,
              ) ?? null;

            return {
              id: product.id,
              productCode: product.productCode,
              productFullCode: product.productFullCode,
              productName: product.productName,

              packageCode: product.packageCode,
              packageName: product.packageName,

              quantity: new Prisma.Decimal(product.quantity),

              confirmedQuantity:
                product.confirmed_quantity === null
                  ? null
                  : new Prisma.Decimal(product.confirmed_quantity),

              packageWeightSnapshot:
                product.package_weight_snapshot === null
                  ? null
                  : new Prisma.Decimal(product.package_weight_snapshot),

              rateIdSnapshot: product.rate_id_snapshot,
              sourceRateIdSnapshot: product.source_rate_id_snapshot,

              rateMarketCode: product.rate_market_code,
              rateSource: product.rate_source,
              weightRangeName: product.weight_range_name,

              weightMinSnapshot:
                product.weight_min_snapshot === null
                  ? null
                  : new Prisma.Decimal(product.weight_min_snapshot),

              weightMaxSnapshot:
                product.weight_max_snapshot === null
                  ? null
                  : new Prisma.Decimal(product.weight_max_snapshot),

              stallRateSnapshot:
                product.stall_rate_snapshot === null
                  ? null
                  : new Prisma.Decimal(product.stall_rate_snapshot),

              laborRateSnapshot:
                product.labor_rate_snapshot === null
                  ? null
                  : new Prisma.Decimal(product.labor_rate_snapshot),

              rateSnapshotAt: product.rate_snapshot_at
                ? new Date(product.rate_snapshot_at)
                : null,

              financial: financial
                ? {
                    stallFeeRaw: new Prisma.Decimal(financial.stall_fee_raw),

                    stallFeeRounded: new Prisma.Decimal(
                      financial.stall_fee_rounded,
                    ),

                    laborFeeRaw: new Prisma.Decimal(financial.labor_fee_raw),

                    productCharge: new Prisma.Decimal(financial.product_charge),

                    workerCount: financial.worker_count,

                    workerPayoutTotal: new Prisma.Decimal(
                      financial.worker_payout_total,
                    ),

                    fundAmount: new Prisma.Decimal(financial.fund_amount),

                    finalizedAt: new Date(financial.finalized_at),

                    workerPayments: state.ticketWorkerPayments
                      .filter(
                        (payment) =>
                          payment.ticket_product_financial_id === financial.id,
                      )
                      .sort((left, right) => left.id - right.id)
                      .map((payment) => {
                        const ticketWorker = state.ticketWorkers.find(
                          (worker) => worker.id === payment.ticket_worker_id,
                        );

                        if (!ticketWorker) {
                          throw new Error(
                            "Ticket worker not found for admin financial test.",
                          );
                        }

                        const worker =
                          state.workers.get(ticketWorker.worker_account_id) ??
                          state.authAccountsById.get(
                            ticketWorker.worker_account_id,
                          );

                        if (!worker) {
                          throw new Error(
                            "Worker account not found for admin financial payment test.",
                          );
                        }

                        return {
                          rawAmount: new Prisma.Decimal(payment.raw_amount),

                          remainderAmount: new Prisma.Decimal(
                            payment.remainder_amount,
                          ),

                          finalAmount: new Prisma.Decimal(payment.final_amount),

                          ticketWorker: {
                            id: ticketWorker.id,
                            status: ticketWorker.status,

                            worker: {
                              username: worker.username,
                              fullName: worker.full_name,
                            },
                          },
                        };
                      }),
                  }
                : null,
            };
          }),
        };
          }),
        };
      }),
    };
  },

  // ใช้ทั้งของ /vehicle-jobs/history และ /vehicle-jobs/history/daily-worker-income เพื่อจำลอง
  // Prisma include ต้นแบบ (AdminVehicleJobHistoryRecord / DailyWorkerIncomeRecord) แบบเดียวกัน
  listVehicleJobs: async (filters: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
    startAt?: Date;
    endAt?: Date;
  }) => {
    let vehicleJobs = [...state.vehicleJobs].sort(
      (left, right) => right.id - left.id,
    );

    if (filters.startAt) {
      vehicleJobs = vehicleJobs.filter(
        (job) => new Date(job.created_at).getTime() >= filters.startAt!.getTime(),
      );
    }

    if (filters.endAt) {
      vehicleJobs = vehicleJobs.filter(
        (job) => new Date(job.created_at).getTime() < filters.endAt!.getTime(),
      );
    }

    if (filters.search) {
      const needle = filters.search.toLowerCase();

      vehicleJobs = vehicleJobs.filter(
        (job) =>
          job.ticket_number.toLowerCase().includes(needle) ||
          job.license_plate.toLowerCase().includes(needle),
      );
    }

    if (filters.status) {
      vehicleJobs = vehicleJobs.filter(
        (job) => job.status.toLowerCase() === filters.status!.toLowerCase(),
      );
    }

    const total = vehicleJobs.length;
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const paged =
      filters.page === undefined
        ? vehicleJobs
        : vehicleJobs.slice((page - 1) * limit, page * limit);

    return {
      data: paged.map((job) => buildAdminVehicleJobHistoryRecordForTest(job.id)),
      total,
    };
  },

  listDailyWorkerIncome: async (filters: {
    workerCode?: string;
    status?: string;
    shift?: number;
    search?: string;
    page?: number;
    limit?: number;
    startAt?: Date;
    endAt?: Date;
  }) => {
    let ticketWorkers = [...state.ticketWorkers].sort(
      (left, right) => right.id - left.id,
    );

    const resolveDateBasis = (ticketWorker: (typeof state.ticketWorkers)[number]) =>
      new Date(ticketWorker.completed_at ?? ticketWorker.joined_at);

    if (filters.startAt) {
      ticketWorkers = ticketWorkers.filter(
        (item) => resolveDateBasis(item).getTime() >= filters.startAt!.getTime(),
      );
    }

    if (filters.endAt) {
      ticketWorkers = ticketWorkers.filter(
        (item) => resolveDateBasis(item).getTime() < filters.endAt!.getTime(),
      );
    }

    if (filters.status) {
      ticketWorkers = ticketWorkers.filter(
        (item) => item.status.toLowerCase() === filters.status!.toLowerCase(),
      );
    }

    if (filters.workerCode || filters.shift !== undefined || filters.search) {
      ticketWorkers = ticketWorkers.filter((item) => {
        const worker =
          state.workers.get(item.worker_account_id) ??
          state.authAccountsById.get(item.worker_account_id);

        if (!worker) {
          return false;
        }

        if (
          filters.workerCode &&
          worker.username.toLowerCase() !== filters.workerCode.toLowerCase()
        ) {
          return false;
        }

        if (
          filters.shift !== undefined &&
          (worker as { shift_no?: number | null }).shift_no !== filters.shift
        ) {
          return false;
        }

        if (filters.search) {
          const needle = filters.search.toLowerCase();
          const marketJob = state.marketJobs.find(
            (market) => market.id === item.market_job_id,
          );

          if (
            !worker.username.toLowerCase().includes(needle) &&
            !worker.full_name.toLowerCase().includes(needle) &&
            !(marketJob?.ticket_no.toLowerCase().includes(needle) ?? false)
          ) {
            return false;
          }
        }

        return true;
      });
    }

    const total = ticketWorkers.length;
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const paged = ticketWorkers.slice((page - 1) * limit, page * limit);

    return {
      data: paged.map((item) => buildDailyWorkerIncomeRecordForTest(item.id)),
      total,
    };
  },
};

export const adminAuditRepositoryMock = {
  createWorkerAssignmentEventOnce: async (input: {
    assignment_id: number;
    worker_account_id: number;
    vehicle_job_id: number;
    event_type: string;
    occurred_at?: Date;
    metadata?: Record<string, unknown> | null;
  }) => {
    const assignment = state.assignments.find(
      (item) => item.id === input.assignment_id,
    );

    if (!assignment) {
      throw new Error("Assignment not found for audit event.");
    }

    recordWorkerAssignmentEventOnce(
      assignment,
      input.event_type,
      input.metadata ?? null,
      input.occurred_at?.toISOString() ?? new Date().toISOString(),
    );
  },
  createWorkerAssignmentEventsOnce: async (
    inputs: Array<{
      assignment_id: number;
      worker_account_id: number;
      vehicle_job_id: number;
      event_type: string;
      occurred_at?: Date;
      metadata?: Record<string, unknown> | null;
    }>,
  ) => {
    for (const input of inputs) {
      await adminAuditRepositoryMock.createWorkerAssignmentEventOnce(input);
    }
  },
  listWorkerPerformanceAssignmentRows: async (filters: {
    startAt: Date;
    endAt: Date;
    worker_code?: string;
  }) =>
    state.assignments
      .filter((assignment) => {
        const createdAt = new Date(
          assignment.created_at ?? new Date().toISOString(),
        );
        const worker =
          state.workers.get(assignment.worker_account_id) ??
          state.authAccountsById.get(assignment.worker_account_id);

        return (
          createdAt >= filters.startAt &&
          createdAt < filters.endAt &&
          (!filters.worker_code || worker?.username === filters.worker_code)
        );
      })
      .sort((left, right) => {
        const leftWorker =
          state.workers.get(left.worker_account_id) ??
          state.authAccountsById.get(left.worker_account_id);
        const rightWorker =
          state.workers.get(right.worker_account_id) ??
          state.authAccountsById.get(right.worker_account_id);

        return (
          (leftWorker?.username ?? "").localeCompare(
            rightWorker?.username ?? "",
          ) || left.id - right.id
        );
      })
      .map((assignment) => {
        const worker =
          state.workers.get(assignment.worker_account_id) ??
          state.authAccountsById.get(assignment.worker_account_id);

        if (!worker) {
          throw new Error("Worker not found for audit performance row.");
        }

        return {
          assignment_id: assignment.id,
          worker_account_id: assignment.worker_account_id,
          worker_code: worker.username,
          full_name: worker.full_name,
          status: assignment.status,
          accepted_at: assignment.accepted_at
            ? new Date(assignment.accepted_at)
            : null,
          scanned_at: assignment.scanned_at
            ? new Date(assignment.scanned_at)
            : null,
          event_types: state.workerAssignmentEvents
            .filter((event) => event.assignment_id === assignment.id)
            .map((event) => event.event_type),
        };
      }),
  listWorkerPerformance: async (filters: {
    startAt: Date;
    endAt: Date;
    worker_code?: string;
    page: number;
    limit: number;
    sort_by: string;
    sort_order: "asc" | "desc";
  }) => {
    const rows =
      await adminAuditRepositoryMock.listWorkerPerformanceAssignmentRows(
        filters,
      );
    const metricsByWorkerCode = new Map<
      string,
      {
        worker_code: string;
        full_name: string;
        total_assigned_job_count: number;
        accepted_job_count: number;
        accept_timeout_job_count: number;
        scan_timeout_job_count: number;
        completed_job_count: number;
        admin_cancelled_job_count: number;
        accept_rate: string | null;
      }
    >();

    for (const row of rows) {
      const metric = metricsByWorkerCode.get(row.worker_code) ?? {
        worker_code: row.worker_code,
        full_name: row.full_name,
        total_assigned_job_count: 0,
        accepted_job_count: 0,
        accept_timeout_job_count: 0,
        scan_timeout_job_count: 0,
        completed_job_count: 0,
        admin_cancelled_job_count: 0,
        accept_rate: null,
      };

      metric.total_assigned_job_count += 1;

      if (row.accepted_at !== null || row.event_types.includes("ACCEPTED")) {
        metric.accepted_job_count += 1;
      }

      if (
        row.event_types.includes("ACCEPT_TIMEOUT") ||
        (row.status === "TIMEOUT" && row.accepted_at === null)
      ) {
        metric.accept_timeout_job_count += 1;
      }

      if (
        row.event_types.includes("SCAN_TIMEOUT") ||
        (row.status === "TIMEOUT" &&
          row.accepted_at !== null &&
          row.scanned_at === null)
      ) {
        metric.scan_timeout_job_count += 1;
      }

      if (row.status === "COMPLETED" || row.event_types.includes("COMPLETED")) {
        metric.completed_job_count += 1;
      }

      if (row.event_types.includes("ADMIN_CANCELLED")) {
        metric.admin_cancelled_job_count += 1;
      }

      metricsByWorkerCode.set(row.worker_code, metric);
    }

    const data = [...metricsByWorkerCode.values()].map((metric) => {
      const denominator =
        metric.accepted_job_count + metric.accept_timeout_job_count;

      return {
        ...metric,
        accept_rate:
          denominator === 0
            ? null
            : ((metric.accepted_job_count / denominator) * 100).toFixed(2),
      };
    });
    const direction = filters.sort_order === "asc" ? 1 : -1;
    const sorted = data.sort((left, right) => {
      if (filters.sort_by === "worker_code") {
        return direction * left.worker_code.localeCompare(right.worker_code);
      }

      const value = (record: typeof left) => {
        switch (filters.sort_by) {
          case "total_assigned":
            return record.total_assigned_job_count;
          case "accepted":
            return record.accepted_job_count;
          case "accept_timeout":
            return record.accept_timeout_job_count;
          case "scan_timeout":
            return record.scan_timeout_job_count;
          case "completed":
            return record.completed_job_count;
          case "admin_cancelled":
            return record.admin_cancelled_job_count;
          default:
            return record.accept_rate === null
              ? null
              : Number(record.accept_rate);
        }
      };
      const leftValue = value(left);
      const rightValue = value(right);

      if (leftValue === null && rightValue === null) {
        return left.worker_code.localeCompare(right.worker_code);
      }

      if (leftValue === null) {
        return 1;
      }

      if (rightValue === null) {
        return -1;
      }

      if (leftValue !== rightValue) {
        return (leftValue - rightValue) * direction;
      }

      const leftOpportunity =
        left.accepted_job_count + left.accept_timeout_job_count;
      const rightOpportunity =
        right.accepted_job_count + right.accept_timeout_job_count;

      if (leftOpportunity !== rightOpportunity) {
        return rightOpportunity - leftOpportunity;
      }

      if (left.completed_job_count !== right.completed_job_count) {
        return right.completed_job_count - left.completed_job_count;
      }

      return left.worker_code.localeCompare(right.worker_code);
    });
    const startIndex = (filters.page - 1) * filters.limit;

    return {
      total: sorted.length,
      data: sorted.slice(startIndex, startIndex + filters.limit),
    };
  },
};
