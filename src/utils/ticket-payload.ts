import type { GateTicketDto, TicketProductDto, VehicleJobDetailResponse } from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function แปลงรายการสินค้าใน ticket เป็น payload สำหรับ Worker/Admin realtime
export function formatWorkerTicketItems(products: TicketProductDto[]) {
  return products.map((product) => ({
    productCode: product.productCode,
    productName: product.productName,
    packageCode: product.packageCode,
    packageName: product.packageName,
    quantity: product.quantity,
    confirmed_quantity: product.confirmed_quantity,
  }));
}

// Function หา market ของ ticket จากรายละเอียดงานรถเพื่อเติมข้อมูลใน realtime payload
export function findTicketMarket(
  detail: VehicleJobDetailResponse | null,
  ticket: GateTicketDto
): VehicleJobDetailResponse["markets"][number] | null {
  return detail?.markets.find((market) =>
    market.tickets.some((marketTicket) => marketTicket.boothCode === ticket.boothCode)
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
    ticketNo: detail?.vehicle_job.ticketNo ?? null,
    marketCode: market?.marketCode ?? null,
    marketName: market?.marketName ?? null,
    boothCode: ticket.boothCode,
    boothName: ticket.boothName,
    status: ticket.status,
    confirmation_status: ticket.confirmation_status,
    ...extra,
    items: formatWorkerTicketItems(products),
  };
}
