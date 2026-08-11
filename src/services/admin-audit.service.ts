import * as adminAuditRepository from "../repositories/admin-audit.repository";

import { ASSIGNMENT_STATUS } from "../constants/job-status";
import {
  WORKER_ASSIGNMENT_EVENT_TYPE,
} from "../types/admin-audit.type";
import { parseWithSchema } from "../validation/parser";
import { adminAuditWorkerPerformanceQuerySchema } from "../validation/schemas";
import {
  buildBangkokDateRange,
  buildBangkokDateSpanRange,
  formatBangkokDate,
} from "../utils/time";

import type {
  AdminAuditWorkerPerformanceQuery,
  AdminAuditWorkerPerformanceRecord,
  AdminAuditWorkerPerformanceResponse,
  WorkerAssignmentEventType,
} from "../types/admin-audit.type";
import type { WorkerPerformanceAssignmentRow } from "../repositories/admin-audit.repository";

interface WorkerMetricAccumulator {
  worker_code: string;
  full_name: string;
  total_assigned_job_count: number;
  accepted_job_count: number;
  accept_timeout_job_count: number;
  scan_timeout_job_count: number;
  completed_job_count: number;
  admin_cancelled_job_count: number;
}

function hasEvent(row: WorkerPerformanceAssignmentRow, eventType: WorkerAssignmentEventType): boolean {
  return row.event_types.includes(eventType);
}

function calculateAcceptRate(acceptedCount: number, acceptTimeoutCount: number): string | null {
  const denominator = acceptedCount + acceptTimeoutCount;

  if (denominator === 0) {
    return null;
  }

  return ((acceptedCount / denominator) * 100).toFixed(2);
}

function buildPerformanceRecord(metric: WorkerMetricAccumulator): AdminAuditWorkerPerformanceRecord {
  return {
    ...metric,
    accept_rate: calculateAcceptRate(
      metric.accepted_job_count,
      metric.accept_timeout_job_count
    ),
  };
}

function compareNullableRates(
  leftRate: string | null,
  rightRate: string | null,
  sortOrder: "asc" | "desc"
): number {
  if (leftRate === null && rightRate === null) {
    return 0;
  }

  if (leftRate === null) {
    return 1;
  }

  if (rightRate === null) {
    return -1;
  }

  const direction = sortOrder === "asc" ? 1 : -1;

  return (Number(leftRate) - Number(rightRate)) * direction;
}

function getNumericSortValue(
  record: AdminAuditWorkerPerformanceRecord,
  sortBy: Exclude<AdminAuditWorkerPerformanceQuery["sort_by"], "accept_rate" | "worker_code">
): number {
  switch (sortBy) {
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
      return 0;
  }
}

function sortPerformanceRecords(
  records: AdminAuditWorkerPerformanceRecord[],
  sortBy: AdminAuditWorkerPerformanceQuery["sort_by"],
  sortOrder: "asc" | "desc"
): AdminAuditWorkerPerformanceRecord[] {
  return [...records].sort((left, right) => {
    if (sortBy === "worker_code") {
      return sortOrder === "asc"
        ? left.worker_code.localeCompare(right.worker_code)
        : right.worker_code.localeCompare(left.worker_code);
    }

    if (sortBy === "accept_rate") {
      const comparedRate = compareNullableRates(left.accept_rate, right.accept_rate, sortOrder);

      if (comparedRate !== 0) {
        return comparedRate;
      }
    } else if (sortBy) {
      const direction = sortOrder === "asc" ? 1 : -1;
      const comparedMetric =
        (getNumericSortValue(left, sortBy) - getNumericSortValue(right, sortBy)) *
        direction;

      if (comparedMetric !== 0) {
        return comparedMetric;
      }
    }

    const leftOpportunity = left.accepted_job_count + left.accept_timeout_job_count;
    const rightOpportunity = right.accepted_job_count + right.accept_timeout_job_count;

    if (leftOpportunity !== rightOpportunity) {
      return rightOpportunity - leftOpportunity;
    }

    if (left.completed_job_count !== right.completed_job_count) {
      return right.completed_job_count - left.completed_job_count;
    }

    return left.worker_code.localeCompare(right.worker_code);
  });
}

function buildMetricAccumulator(row: WorkerPerformanceAssignmentRow): WorkerMetricAccumulator {
  return {
    worker_code: row.worker_code,
    full_name: row.full_name,
    total_assigned_job_count: 0,
    accepted_job_count: 0,
    accept_timeout_job_count: 0,
    scan_timeout_job_count: 0,
    completed_job_count: 0,
    admin_cancelled_job_count: 0,
  };
}

function aggregateRows(rows: WorkerPerformanceAssignmentRow[]): AdminAuditWorkerPerformanceRecord[] {
  const metricsByWorkerCode = new Map<string, WorkerMetricAccumulator>();

  for (const row of rows) {
    const metric =
      metricsByWorkerCode.get(row.worker_code) ?? buildMetricAccumulator(row);

    metric.total_assigned_job_count += 1;

    if (row.accepted_at !== null || hasEvent(row, WORKER_ASSIGNMENT_EVENT_TYPE.ACCEPTED)) {
      metric.accepted_job_count += 1;
    }

    if (
      hasEvent(row, WORKER_ASSIGNMENT_EVENT_TYPE.ACCEPT_TIMEOUT) ||
      adminAuditRepository.classifyHistoricalAcceptTimeout(row)
    ) {
      metric.accept_timeout_job_count += 1;
    }

    if (
      hasEvent(row, WORKER_ASSIGNMENT_EVENT_TYPE.SCAN_TIMEOUT) ||
      adminAuditRepository.classifyHistoricalScanTimeout(row)
    ) {
      metric.scan_timeout_job_count += 1;
    }

    if (row.status === ASSIGNMENT_STATUS.COMPLETED || hasEvent(row, WORKER_ASSIGNMENT_EVENT_TYPE.COMPLETED)) {
      metric.completed_job_count += 1;
    }

    if (row.status === ASSIGNMENT_STATUS.CANCELLED || hasEvent(row, WORKER_ASSIGNMENT_EVENT_TYPE.ADMIN_CANCELLED)) {
      metric.admin_cancelled_job_count += 1;
    }

    metricsByWorkerCode.set(row.worker_code, metric);
  }

  return [...metricsByWorkerCode.values()].map(buildPerformanceRecord);
}

export async function listWorkerPerformance(
  query: unknown
): Promise<AdminAuditWorkerPerformanceResponse> {
  const filters = parseWithSchema(
    adminAuditWorkerPerformanceQuerySchema,
    query
  ) as AdminAuditWorkerPerformanceQuery;
  const today = formatBangkokDate();
  const dateFrom = filters.date_from ?? today;
  const dateTo = filters.date_to ?? today;
  const dateRange = filters.date_from && filters.date_to
    ? buildBangkokDateSpanRange(filters.date_from, filters.date_to)
    : buildBangkokDateRange(today);
  const rows = await adminAuditRepository.listWorkerPerformanceAssignmentRows({
    startAt: dateRange.startAt as Date,
    endAt: dateRange.endAt as Date,
    worker_code: filters.worker_code,
  });
  const sortedRecords = sortPerformanceRecords(
    aggregateRows(rows),
    filters.sort_by ?? "accept_rate",
    filters.sort_order ?? "desc"
  );
  const total = sortedRecords.length;
  const startIndex = (filters.page - 1) * filters.limit;
  const data = sortedRecords.slice(startIndex, startIndex + filters.limit);

  return {
    period: {
      date_from: dateFrom,
      date_to: dateTo,
      timezone: "Asia/Bangkok",
    },
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      total_pages: Math.ceil(total / filters.limit),
    },
    data,
  };
}
