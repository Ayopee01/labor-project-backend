import type { GateTicketDto, TicketProductDto, VehicleJobDetailResponse } from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function จัดรูปแบบ worker ticket items สำหรับ helper กลาง
function formatWorkerTicketItems(products: TicketProductDto[]) {
  return products.map((product) => ({
    productCode: product.productCode,
    productName: product.productName,
    packageCode: product.packageCode,
    packageName: product.packageName,
    quantity: product.quantity,
    confirmed_quantity: product.confirmed_quantity,
  }));
}

// Function ค้นหา Business Ticket (market) ที่ ticket/booth นี้สังกัดอยู่ สำหรับ helper กลาง
export function findTicketMarket(
  detail: VehicleJobDetailResponse | null,
  ticket: GateTicketDto
): VehicleJobDetailResponse["markets"][number] | null {
  return detail?.markets.find((market) =>
    market.booths.some((booth) => booth.boothCode === ticket.boothCode)
  ) ?? null;
}

// Function สร้าง worker ticket payload สำหรับ helper กลาง
export function buildWorkerTicketPayload(
  ticket: GateTicketDto,
  detail: VehicleJobDetailResponse | null,
  products: TicketProductDto[],
  extra: Record<string, unknown> = {}
) {
  const market = findTicketMarket(detail, ticket);

  return {
    ticket_number: detail?.vehicle_job.ticket_number ?? null,
    ticket_no: market?.ticket_no ?? null,
    ticket_completed_at:
      detail?.vehicle_job.status === "COMPLETED"
        ? detail.vehicle_job.updated_at
        : null,
    marketCode: market?.marketCode ?? null,
    marketName: market?.marketName ?? null,
    boothCode: ticket.boothCode,
    boothName: ticket.boothName,
    status: ticket.status,
    confirmation_status: ticket.confirmation_status,
    completed_at: ticket.completed_at,
    ...extra,
    items: formatWorkerTicketItems(products),
  };
}
