// Import Types
import type { GateVehicleJobResponse } from "../types/gate.type";
import type { GateTicketDto, TicketProductDto, VehicleJobDetailResponse } from "../types/worker.type";

import type { LineFlexComponent, LineMessage } from "../types/line.type";

// Import Utils
import { findTicketMarket } from "./ticket-payload";

/* -------------------------------------- Config -------------------------------------- */

// Config สีหลักที่ใช้ซ้ำใน LINE Flex message
const TEXT_COLOR = "#2F3437";
const MUTED_COLOR = "#6B7280";
const BORDER_COLOR = "#E5E7EB";
const GREEN_COLOR = "#17C964";
const NEUTRAL_BUTTON_COLOR = "#D8DDE8";
const WARNING_COLOR = "#EF4444";
const STAR_COLOR = "#F6C343";

/* -------------------------------------- Functions -------------------------------------- */

// Function แปลงค่าที่อาจว่างให้เป็นข้อความสำหรับแสดงใน LINE
function asDisplayText(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value).trim();

  return text || "-";
}

// Function format จำนวนสินค้าให้ตัดทศนิยมส่วนเกินออก
function formatQuantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return String(value);
  }

  return Number.isInteger(numberValue)
    ? String(numberValue)
    : numberValue.toFixed(2).replace(/\.?0+$/, "");
}

// Function format วันที่เป็นรูปแบบวัน/เดือน/ปีตาม timezone กรุงเทพฯ
function formatBangkokDisplayDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

// Function สร้างแถว label/value มาตรฐานใน Flex bubble
function fieldRow(label: string, value: string | number | null | undefined): LineFlexComponent {
  return {
    type: "box",
    layout: "horizontal",
    margin: "sm",
    contents: [
      {
        type: "text",
        text: label,
        size: "sm",
        color: MUTED_COLOR,
        flex: 5,
        wrap: true,
      },
      {
        type: "text",
        text: asDisplayText(value),
        size: "sm",
        color: TEXT_COLOR,
        weight: "bold",
        align: "end",
        flex: 7,
        wrap: true,
      },
    ],
  };
}

// Function สร้างเส้นคั่นใน Flex bubble
function separator(margin = "lg"): LineFlexComponent {
  return {
    type: "separator",
    margin,
    color: BORDER_COLOR,
  };
}

// Function สร้างแถวสรุปรายการสินค้าสำหรับแจ้งลงสินค้า
function productSummaryRow(input: {
  name: string;
  quantity: string | number | null | undefined;
  packageName: string | null | undefined;
}): LineFlexComponent {
  return {
    type: "box",
    layout: "horizontal",
    margin: "sm",
    contents: [
      {
        type: "text",
        text: asDisplayText(input.name),
        size: "sm",
        color: TEXT_COLOR,
        flex: 7,
        wrap: true,
      },
      {
        type: "text",
        text: formatQuantity(input.quantity),
        size: "sm",
        color: TEXT_COLOR,
        align: "end",
        flex: 2,
      },
      {
        type: "text",
        text: asDisplayText(input.packageName),
        size: "sm",
        color: MUTED_COLOR,
        align: "end",
        flex: 3,
        wrap: true,
      },
    ],
  };
}

// Function สร้าง block รายการสินค้าตอนให้ vendor ตรวจสอบยอด
function completionProductBlock(product: TicketProductDto): LineFlexComponent {
  return {
    type: "box",
    layout: "vertical",
    margin: "md",
    contents: [
      {
        type: "text",
        text: asDisplayText(product.productName),
        size: "sm",
        weight: "bold",
        color: TEXT_COLOR,
        wrap: true,
      },
      fieldRow("ตามใบงาน", `${formatQuantity(product.quantity)} ${asDisplayText(product.packageName)}`),
      fieldRow("ส่งยอด", `${formatQuantity(product.confirmed_quantity)} ${asDisplayText(product.packageName)}`),
    ],
  };
}

// Function สร้าง bubble กลางที่ใช้ร่วมกันในข้อความ LINE หลายแบบ
function buildBubble(title: string, contents: LineFlexComponent[], footer?: LineFlexComponent): Record<string, unknown> {
  return {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      contents: [
        {
          type: "text",
          text: title,
          size: "xl",
          weight: "bold",
          color: TEXT_COLOR,
          wrap: true,
        },
        ...contents,
      ],
    },
    ...(footer ? { footer } : {}),
  };
}

// Function สร้างปุ่ม postback สำหรับ confirm/reject/rating
function postbackButton(input: {
  label: string;
  data: string;
  displayText: string;
  style?: "primary" | "secondary" | "link";
  color?: string;
}): LineFlexComponent {
  return {
    type: "button",
    style: input.style ?? "primary",
    height: "sm",
    color: input.color,
    action: {
      type: "postback",
      label: input.label,
      data: input.data,
      displayText: input.displayText,
    },
  };
}

// Function สร้างข้อความแจ้งเจ้าของแผงเมื่อ Gate สร้าง ticket ลงสินค้า
export function buildGateTicketCreatedFlexMessage(response: GateVehicleJobResponse): LineMessage {
  return {
    type: "flex",
    altText: `แจ้งลงสินค้า ${response.Ticket.TicketNo}`,
    contents: buildBubble("แจ้งลงสินค้า", [
      fieldRow("เลขที่งาน:", response.Ticket.TicketNo),
      fieldRow("รหัสแผง:", response.Booth.BoothCode),
      fieldRow("ชื่อแผง:", response.Booth.BoothName),
      fieldRow("ทะเบียนรถ:", response.Ticket.LicensePlate),
      separator(),
      productSummaryRow({
        name: response.Product.ProductName,
        quantity: response.Product.Quantity,
        packageName: response.Product.PackageName,
      }),
      separator(),
      {
        type: "text",
        text: "หากไม่ใช่สินค้าของท่าน กรุณาติดต่อร้านค้าต้นทางของท่าน",
        size: "xs",
        color: TEXT_COLOR,
        weight: "bold",
        margin: "md",
        wrap: true,
      },
    ]),
  };
}

// Function สร้างข้อความให้ vendor ตรวจสอบยอดและกดถูกต้อง/ไม่ถูกต้อง
export function buildVendorCompletionReviewFlexMessage(input: {
  ticket: GateTicketDto;
  postbackData: { confirm: string; reject: string };
  detail: VehicleJobDetailResponse | null;
  products: TicketProductDto[];
}): LineMessage {
  const market = findTicketMarket(input.detail, input.ticket);
  const footer: LineFlexComponent = {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: [
      postbackButton({
        label: "ถูกต้อง",
        data: input.postbackData.confirm,
        displayText: "ถูกต้อง",
        color: GREEN_COLOR,
      }),
      postbackButton({
        label: "ไม่ถูกต้อง",
        data: input.postbackData.reject,
        displayText: "ไม่ถูกต้อง",
        style: "secondary",
        color: NEUTRAL_BUTTON_COLOR,
      }),
    ],
  };

  return {
    type: "flex",
    altText: `กรุณาตรวจสอบข้อมูล ${input.detail?.vehicle_job.ticketNo ?? input.ticket.boothCode}`,
    contents: buildBubble("กรุณาตรวจสอบข้อมูล", [
      fieldRow("เลขที่งาน:", input.detail?.vehicle_job.ticketNo),
      fieldRow("รหัสแผง:", input.ticket.boothCode),
      fieldRow("ชื่อแผง:", input.ticket.boothName),
      fieldRow("ทะเบียนรถ:", input.detail?.vehicle_job.license_plate),
      fieldRow("ตลาด:", market?.marketName),
      separator(),
      ...input.products.flatMap((product, index) => [
        ...(index > 0 ? [separator("md")] : []),
        completionProductBlock(product),
      ]),
    ], footer),
  };
}

// Function สร้างข้อความแจ้งผลหลัง vendor confirm หรือ reject ยอด
export function buildVendorCompletionResultFlexMessage(input: {
  ticket: GateTicketDto;
  detail: VehicleJobDetailResponse | null;
  isConfirmed: boolean;
}): LineMessage {
  const text = input.isConfirmed
    ? "คุณได้ยืนยันข้อมูลถูกต้อง ปิดงานเรียบร้อย"
    : "คุณได้แจ้งข้อมูลไม่ถูกต้องแล้ว กรุณารอคนงานส่งยอดใหม่อีกครั้ง";
  const title = input.isConfirmed
    ? "ยืนยันข้อมูลสำเร็จ"
    : "แจ้งตีกลับข้อมูลแล้ว";

  return {
    type: "flex",
    altText: text,
    contents: buildBubble(title, [
      fieldRow("เลขที่งาน:", input.detail?.vehicle_job.ticketNo),
      fieldRow("รหัสแผง:", input.ticket.boothCode),
      fieldRow("ชื่อแผง:", input.ticket.boothName),
      separator(),
      {
        type: "text",
        text,
        size: "md",
        color: input.isConfirmed ? TEXT_COLOR : WARNING_COLOR,
        weight: "bold",
        wrap: true,
        align: "center",
        margin: "md",
      },
    ]),
  };
}

// Function สร้างข้อความขอคะแนนหลัง vendor confirm งานสำเร็จ
export function buildVendorRatingPromptFlexMessage(input: {
  ticket: GateTicketDto;
  detail: VehicleJobDetailResponse | null;
  ratingToken: string;
}): LineMessage {
  return {
    type: "flex",
    altText: `กรุณาให้คะแนน ${input.detail?.vehicle_job.ticketNo ?? input.ticket.boothCode}`,
    contents: buildBubble("กรุณาให้คะแนน", [
      separator(),
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        margin: "lg",
        contents: [1, 2, 3, 4, 5].map((score) =>
          postbackButton({
            label: String(score),
            data: `token=${input.ratingToken}&score=${score}`,
            displayText: String(score),
            style: "link",
            color: MUTED_COLOR,
          })
        ),
      },
    ]),
  };
}

// Function สร้างข้อความขอบคุณและสรุปค่าใช้บริการหลัง vendor ให้คะแนน
export function buildVendorRatingResultFlexMessages(input: {
  ticket: GateTicketDto;
  detail: VehicleJobDetailResponse | null;
  score: number;
  serviceChargeBaht?: number;
}): LineMessage[] {
  const ticketNo = input.detail?.vehicle_job.ticketNo ?? "-";
  const serviceChargeBaht = input.serviceChargeBaht ?? 0;
  const stars = `${"★".repeat(input.score)}${"☆".repeat(5 - input.score)}`;

  return [
    {
      type: "flex",
      altText: `ขอบคุณสำหรับการให้คะแนน ${input.score}/5`,
      contents: buildBubble("ขอบคุณ! สำหรับการให้คะแนน", [
        separator(),
        {
          type: "text",
          text: stars,
          size: "xl",
          color: STAR_COLOR,
          align: "center",
          margin: "lg",
          wrap: true,
        },
      ]),
    },
    {
      type: "flex",
      altText: `สรุปค่าใช้บริการ ${ticketNo}`,
      contents: buildBubble("สรุปค่าใช้บริการ", [
        separator(),
        {
          type: "text",
          text: `เลขที่งาน ${ticketNo}`,
          size: "md",
          color: TEXT_COLOR,
          align: "center",
          margin: "lg",
          wrap: true,
        },
        {
          type: "text",
          text: formatBangkokDisplayDate(input.detail?.vehicle_job.ticket_created_at),
          size: "md",
          color: TEXT_COLOR,
          align: "center",
          wrap: true,
        },
        {
          type: "text",
          text: `ลงแผง ${input.ticket.boothCode} ${asDisplayText(input.ticket.boothName)}`,
          size: "md",
          color: TEXT_COLOR,
          align: "center",
          wrap: true,
        },
        {
          type: "text",
          text: `${serviceChargeBaht.toFixed(2)} บาท`,
          size: "xl",
          weight: "bold",
          color: TEXT_COLOR,
          align: "center",
          margin: "lg",
          wrap: true,
        },
        {
          type: "text",
          text: "ขอบคุณที่ใช้บริการ",
          size: "sm",
          color: TEXT_COLOR,
          align: "center",
          margin: "md",
          wrap: true,
        },
      ]),
    },
  ];
}
