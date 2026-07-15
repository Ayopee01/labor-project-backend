import type { GateTicketDto, TicketProductDto, VehicleJobDetailResponse } from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function แปลงรายการสินค้าใน ticket เป็น payload สำหรับ Worker/Admin realtime
export function formatWorkerTicketItems(products: TicketProductDto[]) {
  return products.map((product) => ({
    product_ref: product.product_ref,
    product_type: product.product_type,
    name: product.name,
    quantity: product.quantity,
    confirmed_quantity: product.confirmed_quantity,
    unit: product.unit,
  }));
}

// Function หา market ของ ticket จากรายละเอียดงานรถเพื่อเติมข้อมูลใน realtime payload
export function findTicketMarket(
  detail: VehicleJobDetailResponse | null,
  ticket: GateTicketDto
): VehicleJobDetailResponse["markets"][number] | null {
  return detail?.markets.find((market) =>
    market.tickets.some((marketTicket) => marketTicket.stall_job_ref === ticket.stall_job_ref)
  ) ?? null;
}

// Function สร้าง payload ticket สำหรับ WebSocket/SSE โดยใช้ reference แทน id ภายใน
export function buildWorkerTicketPayload(
  ticket: GateTicketDto,
  detail: VehicleJobDetailResponse | null,
  products: TicketProductDto[],
  extra: Record<string, unknown> = {}
) {
  const market = findTicketMarket(detail, ticket);

  return {
    vehicle_job_ref: detail?.vehicle_job.vehicle_job_ref ?? null,
    market_job_ref: market?.market_job_ref ?? null,
    market_name: market?.market_name ?? null,
    stall_job_ref: ticket.stall_job_ref,
    ticket_no: ticket.ticket_no,
    stall_no: ticket.stall_no,
    stall_name: ticket.vendor_name,
    status: ticket.status,
    confirmation_status: ticket.confirmation_status,
    ...extra,
    items: formatWorkerTicketItems(products),
  };
}

