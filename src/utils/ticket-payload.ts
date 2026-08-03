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

// Function ค้นหา ticket market สำหรับ helper กลาง
export function findTicketMarket(
  detail: VehicleJobDetailResponse | null,
  ticket: GateTicketDto
): VehicleJobDetailResponse["markets"][number] | null {
  return detail?.markets.find((market) =>
    market.tickets.some((marketTicket) => marketTicket.boothCode === ticket.boothCode)
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
