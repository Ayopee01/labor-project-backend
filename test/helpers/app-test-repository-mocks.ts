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
];

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
    ticketNo: string,
    workerAccountId: number,
  ) => {
    const job = state.vehicleJobs.find(
      (vehicleJob) => vehicleJob.ticketNo === ticketNo,
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
  findVehicleJobByRef: async (ticketNo: string) =>
    state.vehicleJobs.find((job) => job.ticketNo === ticketNo) ?? null,
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
  updateMarketJobStatus: async (_marketJobId: number, _status: string) =>
    undefined,
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

    const marketIds = [
      ...new Set(
        state.gateTickets
          .filter((ticket) => ticket.vehicle_job_id === vehicleJobId)
          .map((ticket) => ticket.market_job_id),
      ),
    ];

    return {
      ...job,
      marketJobs: marketIds.map((marketJobId) => {
        const tickets = state.gateTickets.filter(
          (ticket) => ticket.market_job_id === marketJobId,
        );

        return {
          id: marketJobId,
          status: tickets.every((ticket) => ticket.status === "CANCELLED")
            ? "CANCELLED"
            : tickets.every((ticket) =>
                  ["COMPLETED", "CANCELLED"].includes(ticket.status),
                )
              ? "COMPLETED"
              : "WORKING",
          tickets,
        };
      }),
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
          ticketNo: `JOB-${assignment.vehicle_job_id}`,
          gate_transaction_ref: `GATE-${assignment.vehicle_job_id}`,
          license_plate: "TEST",
          license_plate_province: "Bangkok",
          vehicle_type: null,
          ticket_created_at: assignment.created_at ?? new Date().toISOString(),
          booth_count: 1,
          workers_required: 1,
          status: "WORKING",
          driver_qr_token: `driver-qr-${assignment.vehicle_job_id}`,
          worker_qr_token: `JOB-${assignment.vehicle_job_id}`,
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
          const firstTicket = marketTickets[0];

          return {
            marketCode: firstTicket?.marketCode ?? `MARKET-${marketJobId}`,
            marketName: firstTicket?.marketName ?? `Market ${marketJobId}`,
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

        const ticket = state.gateTickets.find(
          (item) => item.id === ticketWorker.ticket_id,
        );
        const completedAt = ticket?.completed_at
          ? new Date(ticket.completed_at)
          : null;

        return Boolean(
          ticket?.financialized_at &&
          completedAt &&
          completedAt >= startAt &&
          completedAt < endAt,
        );
      })
      .sort((left, right) => {
        const leftTicket = state.gateTickets.find(
          (item) => item.id === left.ticket_id,
        );
        const rightTicket = state.gateTickets.find(
          (item) => item.id === right.ticket_id,
        );

        return (
          new Date(rightTicket?.completed_at ?? 0).getTime() -
            new Date(leftTicket?.completed_at ?? 0).getTime() ||
          left.id - right.id
        );
      })
      .map((ticketWorker) => {
        const ticket = state.gateTickets.find(
          (item) => item.id === ticketWorker.ticket_id,
        );

        if (!ticket) {
          throw new Error("Ticket not found for worker earnings summary.");
        }

        const vehicleJob = state.vehicleJobs.find(
          (job) => job.id === ticket.vehicle_job_id,
        );

        if (!vehicleJob) {
          throw new Error("Vehicle job not found for worker earnings summary.");
        }

        return {
          completed_at: ticket.completed_at ?? "",
          ticketNo: vehicleJob.ticketNo,
          license_plate: vehicleJob.license_plate,
          license_plate_province: vehicleJob.license_plate_province,
          booth_count: vehicleJob.booth_count,
          marketCode: ticket.marketCode ?? `MARKET-${ticket.market_job_id}`,
          marketName: ticket.marketName ?? `Market ${ticket.market_job_id}`,
          boothCode: ticket.boothCode,
          boothName: ticket.boothName,
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
  findGateTicketForCompletionByTicketNoAndBoothCode: async (
    ticketNo: string,
    boothCode: string,
  ) => {
    const vehicleJob = state.vehicleJobs.find(
      (job) => job.ticketNo === ticketNo,
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
  syncTicketWorkersFromVehicleAssignments: async (
    ticketId: number,
    vehicleJobId: number,
  ) => {
    const now = new Date().toISOString();

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
      let ticketWorker = state.ticketWorkers.find(
        (worker) =>
          worker.ticket_id === ticketId &&
          worker.worker_account_id === workerAccountId,
      );

      if (!ticketWorker) {
        ticketWorker = {
          id: state.nextTicketWorkerId++,
          ticket_id: ticketId,
          worker_account_id: workerAccountId,
          status: "WORKING",
          final_earning_amount: null,
          joined_at: now,
          cancelled_at: null,
          completed_at: null,
        };

        state.ticketWorkers.push(ticketWorker);
      } else if (ticketWorker.status !== "COMPLETED") {
        ticketWorker.status = "WORKING";

        ticketWorker.cancelled_at = null;

        ticketWorker.completed_at = null;

        ticketWorker.final_earning_amount = null;
      }
    }

    state.ticketWorkers
      .filter(
        (worker) =>
          worker.ticket_id === ticketId &&
          worker.status !== "COMPLETED" &&
          worker.status !== "CANCELLED" &&
          !activeWorkerAccountIds.includes(worker.worker_account_id),
      )
      .forEach((worker) => {
        worker.status = "CANCELLED";

        worker.cancelled_at = now;

        worker.completed_at = null;

        worker.final_earning_amount = null;
      });

    return state.ticketWorkers.filter(
      (worker) => worker.ticket_id === ticketId,
    );
  },

  listTicketWorkers: async (ticketId: number) =>
    state.ticketWorkers.filter((worker) => worker.ticket_id === ticketId),
  listTicketProducts: async (ticketId: number) =>
    state.ticketProducts.filter((product) => product.ticket_id === ticketId),
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

    state.ticketWorkers
      .filter(
        (worker) =>
          worker.ticket_id === ticketId && worker.status === "WORKING",
      )
      .forEach((worker) => {
        worker.status = "COMPLETED";

        worker.completed_at = completedAt;

        worker.cancelled_at = null;
      });

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

  // Function ดึงข้อมูลทั้งหมดสำหรับ Financialize Ticket ใน route test
  findTicketFinancializationContext: async (ticketId: number) => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);

    if (!ticket) {
      return null;
    }

    const products = state.ticketProducts
      .filter((product) => product.ticket_id === ticketId)
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
      });

    const workers = state.ticketWorkers
      .filter(
        (worker) =>
          worker.ticket_id === ticketId && worker.status === "COMPLETED",
      )
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
      id: ticket.id,

      status: ticket.status,

      finalStallAmount: ticket.final_stall_amount
        ? new Prisma.Decimal(ticket.final_stall_amount)
        : null,

      financializedAt: ticket.financialized_at
        ? new Date(ticket.financialized_at)
        : null,

      products,
      workers,
    };
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

  markGateTicketFinancialized: async (
    ticketId: number,
    finalStallAmount: Prisma.Decimal,
    finalizedAt: Date,
  ): Promise<void> => {
    const ticket = state.gateTickets.find((item) => item.id === ticketId);

    if (!ticket || ticket.status !== "COMPLETED" || ticket.financialized_at) {
      throw new Error(
        "Gate ticket financialization did not update exactly one ticket.",
      );
    }

    ticket.final_stall_amount = finalStallAmount.toFixed(2);
    ticket.financialized_at = finalizedAt.toISOString();
    ticket.updated_at = finalizedAt.toISOString();
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
    }>,
  ) => {
    for (const item of items) {
      const product = state.ticketProducts.find(
        (candidate) =>
          candidate.ticket_id === ticketId &&
          candidate.productCode === item.productCode &&
          candidate.packageCode === item.packageCode,
      );

      if (!product) {
        throw new Error("Ticket product not found.");
      }

      product.confirmed_quantity = String(item.confirmed_quantity);
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

    const tickets = state.gateTickets.filter(
      (ticket) => ticket.vehicle_job_id === vehicleJobId,
    );
    const marketIds = Array.from(
      new Set(tickets.map((ticket) => ticket.market_job_id)),
    );

    return {
      vehicle_job: {
        id: job.id,
        ticketNo: job.ticketNo,
        gate_transaction_ref: job.gate_transaction_ref,
        license_plate: job.license_plate,
        license_plate_province: job.license_plate_province,
        vehicle_type: job.vehicle_type,
        ticket_created_at: job.ticket_created_at,
        booth_count: job.booth_count,
        workers_required: job.workers_required,
        dispatch_now: job.dispatch_now,
        status: job.status,
        driver_qr_token: job.driver_qr_token,
        worker_qr_token: job.worker_qr_token,
        created_at: job.created_at,
        updated_at: job.updated_at,
      },
      markets: marketIds.map((marketJobId) => {
        const marketTickets = tickets.filter(
          (ticket) => ticket.market_job_id === marketJobId,
        );
        const firstTicket = marketTickets[0];

        return {
          id: marketJobId,
          vehicle_job_id: vehicleJobId,
          marketCode: firstTicket?.marketCode ?? `MARKET-${marketJobId}`,
          marketName: firstTicket?.marketName ?? "Market A",
          dropoff_point: firstTicket?.dropoff_point ?? null,
          status: job.status,
          tickets: marketTickets.map((ticket) => ({
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
  findGateTicketForCompletionByTicketNoAndBoothCode,
  findTicketCompletionSubmissionById,
  findTicketFinancializationContext,
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
  listTicketProducts,
  listTicketWorkers,
  listVehicleJobAssignmentTeam,
  listWorkerAssignmentHistoryByDate,
  listWorkerEarningsSummaryRows,
  markGateTicketFinancialized,
  markTicketDelivered,
  markVehicleAssignmentsDelivered,
  markVehicleAssignmentsRejected,
  markVehicleAssignmentsWorking,
  markVehicleJobInProgress,
  profileRepository,
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
};

export const gateTicketRepositoryMock = {
  findGateTicketForCompletion,
  findGateTicketForCompletionByTicketNoAndBoothCode,
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
  findTicketFinancializationContext,
  createTicketProductFinancial,
  updateTicketWorkerFinalEarningAmounts,
  markGateTicketFinancialized,
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
  findVehicleJobByRef: async (ticketNo: string) =>
    state.vehicleJobs.find((job) => job.ticketNo === ticketNo) ?? null,
  getGateTicketAppendState: async (ticketNo: string, boothCode: string) => {
    const vehicleJob = state.vehicleJobs.find(
      (job) => job.ticketNo === ticketNo,
    );

    if (!vehicleJob) {
      return null;
    }

    const tickets = state.gateTickets.filter(
      (ticket) => ticket.vehicle_job_id === vehicleJob.id,
    );
    const boothCodes = new Set(tickets.map((ticket) => ticket.boothCode));
    const duplicateBooth = tickets.find(
      (ticket) => ticket.boothCode === boothCode,
    );

    return {
      vehicle_job_id: vehicleJob.id,
      booth_count: vehicleJob.booth_count,
      existing_booth_count: boothCodes.size,
      duplicate_booth: duplicateBooth
        ? {
            boothCode: duplicateBooth.boothCode,
            marketCode: duplicateBooth.marketCode ?? "",
          }
        : null,
    };
  },

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
      gate_transaction_ref: string;
      ticketNo: string;
      ticket_created_at: Date;
      booth_count: number;
      license_plate: string;
      license_plate_province: string;
      vehicle_type?: string | null;
      workers_required: number;
      dispatch_now?: boolean;
      markets: Array<{
        marketCode: string;
        marketName: string;
        dropoff_point?: string | null;
        tickets: Array<{
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
    let vehicleJob = state.vehicleJobs.find(
      (job) => job.ticketNo === input.ticketNo,
    );

    if (!vehicleJob) {
      const vehicleJobId =
        Math.max(0, ...state.vehicleJobs.map((job) => job.id)) + 1;
      const requestedWorkersRequired = Math.max(1, input.workers_required);
      vehicleJob = {
        id: vehicleJobId,
        ticketNo: input.ticketNo,
        gate_transaction_ref: input.gate_transaction_ref,
        license_plate: input.license_plate,
        license_plate_province: input.license_plate_province,
        vehicle_type: input.vehicle_type ?? null,
        ticket_created_at: input.ticket_created_at.toISOString(),
        booth_count: input.booth_count,
        workers_required: requestedWorkersRequired,
        dispatch_now: dispatchNow,
        status: dispatchNow ? "WORKING" : "WAIT",
        driver_qr_token: `driver-qr-${vehicleJobId}`,
        worker_qr_token: input.ticketNo,
        created_at: now,
        updated_at: now,
      };

      state.vehicleJobs.push(vehicleJob);
    } else {
      const requestedWorkersRequired = Math.max(1, input.workers_required);
      vehicleJob.gate_transaction_ref = input.gate_transaction_ref;
      vehicleJob.license_plate = input.license_plate;
      vehicleJob.license_plate_province = input.license_plate_province;
      vehicleJob.vehicle_type = input.vehicle_type ?? null;
      vehicleJob.ticket_created_at = input.ticket_created_at.toISOString();
      vehicleJob.booth_count = input.booth_count;
      vehicleJob.workers_required = Math.max(
        vehicleJob.workers_required,
        requestedWorkersRequired,
      );
      vehicleJob.worker_qr_token = input.ticketNo;
      vehicleJob.dispatch_now = vehicleJob.dispatch_now || dispatchNow;
      if (dispatchNow && vehicleJob.status === "WAIT") {
        vehicleJob.status = "WORKING";
      }
      vehicleJob.updated_at = now;
    }

    let marketJobId =
      Math.max(0, ...state.gateTickets.map((ticket) => ticket.market_job_id)) +
      1;
    let ticketId =
      Math.max(0, ...state.gateTickets.map((ticket) => ticket.id)) + 1;
    let productId =
      Math.max(0, ...state.ticketProducts.map((product) => product.id)) + 1;

    for (const market of input.markets) {
      const existingMarketTicket = state.gateTickets.find(
        (ticket) =>
          ticket.vehicle_job_id === vehicleJob.id &&
          ticket.marketCode === market.marketCode,
      );
      const currentMarketJobId =
        existingMarketTicket?.market_job_id ?? marketJobId++;

      for (const ticketInput of market.tickets) {
        let ticket = state.gateTickets.find(
          (item) =>
            item.market_job_id === currentMarketJobId &&
            item.boothCode === ticketInput.boothCode,
        );

        if (!ticket) {
          ticket = {
            id: ticketId++,
            vehicle_job_id: vehicleJob.id,
            market_job_id: currentMarketJobId,
            marketCode: market.marketCode,
            marketName: market.marketName,
            dropoff_point: market.dropoff_point ?? null,
            boothCode: ticketInput.boothCode,
            boothName: ticketInput.boothName ?? null,
            vendor_line_id: ticketInput.vendor_line_id ?? null,
            reject_reason: ticketInput.reject_reason ?? null,
            status: "WAIT",
            confirmation_status: "WAIT",
            created_at: now,
            updated_at: now,
          };

          state.gateTickets.push(ticket);
        } else {
          ticket.marketName = market.marketName;
          ticket.dropoff_point = market.dropoff_point ?? null;
          ticket.boothName = ticketInput.boothName ?? null;
          ticket.vendor_line_id = ticketInput.vendor_line_id ?? null;
          ticket.reject_reason = ticketInput.reject_reason ?? null;
          ticket.updated_at = now;
        }

        ticketInput.products.forEach((product) => {
          let ticketProduct = state.ticketProducts.find(
            (item) =>
              item.ticket_id === ticket.id &&
              item.productCode === product.productCode &&
              item.packageCode === product.packageCode,
          );

          if (!ticketProduct) {
            ticketProduct = {
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
          } else {
            ticketProduct.productFullCode = product.productFullCode;

            ticketProduct.productName = product.productName;

            ticketProduct.packageName = product.packageName;

            ticketProduct.quantity = String(product.quantity);

            ticketProduct.package_weight_snapshot =
              product.packageWeightSnapshot;

            ticketProduct.rate_id_snapshot = product.rateIdSnapshot;

            ticketProduct.source_rate_id_snapshot =
              product.sourceRateIdSnapshot;

            ticketProduct.rate_market_code = product.rateMarketCode;

            ticketProduct.rate_source = product.rateSource;

            ticketProduct.weight_range_name = product.weightRangeName;

            ticketProduct.weight_min_snapshot = product.weightMinSnapshot;

            ticketProduct.weight_max_snapshot = product.weightMaxSnapshot;

            ticketProduct.stall_rate_snapshot = product.stallRateSnapshot;

            ticketProduct.labor_rate_snapshot = product.laborRateSnapshot;

            ticketProduct.rate_snapshot_at =
              product.rateSnapshotAt.toISOString();

            ticketProduct.updated_at = now;
          }
        });
      }
    }

    state.gateRequestLogs.push({
      gate_transaction_ref: input.gate_transaction_ref,
      vehicle_job_id: vehicleJob.id,
      payload_snapshot: payloadSnapshot,
      response_snapshot: null,
    });

    return vehicleJob;
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

// Mock repository สำหรับ Admin VehicleJob Financial route test
export const adminJobsRepositoryMock = {
  findVehicleJobByRef: async (ticketNo: string) =>
    state.vehicleJobs.find((job) => job.ticketNo === ticketNo) ?? null,

  findVehicleJobById: async (vehicleJobId: number) =>
    state.vehicleJobs.find((job) => job.id === vehicleJobId) ?? null,

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
    ticketNo: string,
    workerCode: string,
  ) => {
    const vehicleJob = state.vehicleJobs.find(
      (job) => job.ticketNo === ticketNo,
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

        const ticket = state.gateTickets.find(
          (item) => item.id === ticketWorker.ticket_id,
        );

        return (
          ticket?.vehicle_job_id === assignment.vehicle_job_id &&
          !["COMPLETED", "CANCELLED"].includes(ticket.status)
        );
      })
      .forEach((ticketWorker) => {
        ticketWorker.status = "CANCELLED";
        ticketWorker.cancelled_at = now;
        ticketWorker.completed_at = null;
      });

    return assignment;
  },
  findVehicleJobFinancialByRef: async (ticketNo: string) => {
    const vehicleJob = state.vehicleJobs.find(
      (job) => job.ticketNo === ticketNo,
    );

    if (!vehicleJob) {
      return null;
    }

    const tickets = state.gateTickets
      .filter((ticket) => ticket.vehicle_job_id === vehicleJob.id)
      .sort((left, right) => left.id - right.id);

    return {
      id: vehicleJob.id,
      ticketNo: vehicleJob.ticketNo,
      gateTransactionRef: vehicleJob.gate_transaction_ref,
      licensePlate: vehicleJob.license_plate,
      licensePlateProvince: vehicleJob.license_plate_province,
      vehicleType: vehicleJob.vehicle_type,
      status: vehicleJob.status,

      tickets: tickets.map((ticket) => {
        const ticketWorkers = state.ticketWorkers
          .filter((worker) => worker.ticket_id === ticket.id)
          .sort((left, right) => left.id - right.id);

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

          marketJob: {
            marketCode: ticket.marketCode ?? `MARKET-${ticket.market_job_id}`,
            marketName: ticket.marketName ?? `Market ${ticket.market_job_id}`,
          },

          workers: ticketWorkers.map((ticketWorker) => {
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
