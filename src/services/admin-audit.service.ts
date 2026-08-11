import * as adminAuditRepository from "../repositories/admin-audit.repository";

import { parseWithSchema } from "../validation/parser";
import { adminAuditWorkerPerformanceQuerySchema } from "../validation/schemas";
import {
  buildBangkokDateRange,
  buildBangkokDateSpanRange,
  formatBangkokDate,
} from "../utils/time";

import type {
  AdminAuditWorkerPerformanceQuery,
  AdminAuditWorkerPerformanceResponse,
} from "../types/admin-audit.type";

/* -------------------------------------- Functions -------------------------------------- */

export async function listWorkerPerformance(
  query: unknown,
): Promise<AdminAuditWorkerPerformanceResponse> {
  const filters = parseWithSchema(
    adminAuditWorkerPerformanceQuerySchema,
    query,
  ) as AdminAuditWorkerPerformanceQuery;
  const today = formatBangkokDate();
  const dateFrom = filters.date_from ?? today;
  const dateTo = filters.date_to ?? today;
  const dateRange =
    filters.date_from && filters.date_to
      ? buildBangkokDateSpanRange(filters.date_from, filters.date_to)
      : buildBangkokDateRange(today);
  const result = await adminAuditRepository.listWorkerPerformance({
    startAt: dateRange.startAt as Date,
    endAt: dateRange.endAt as Date,
    worker_code: filters.worker_code,
    page: filters.page,
    limit: filters.limit,
    sort_by: filters.sort_by ?? "accept_rate",
    sort_order: filters.sort_order ?? "desc",
  });

  return {
    period: {
      date_from: dateFrom,
      date_to: dateTo,
      timezone: "Asia/Bangkok",
    },
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: result.total,
      total_pages: Math.ceil(result.total / filters.limit),
    },
    data: result.data,
  };
}
