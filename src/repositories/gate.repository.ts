// Import Library
import { Prisma, type MasterMarket } from "@prisma/client";

// Import Dependencies
import { TICKET_STATUS, VEHICLE_JOB_STATUS } from "../constants/job-status";
import * as gateTicketRepository from "./shared/gate-ticket.repository";
import { mapMarketJob, mapVehicleJob } from "./shared/mappers";
import { client, createRandomToken, requireDto } from "./shared/repository-utils";

// Import Types
import type { DbConnection } from "../types/shared/common.type";
import type { GateRequestReplayRecord, GateVehicleJobCreateInput, GateVehicleJobResponse, GateBoothOption } from "../types/gate.type";
import type { MarketJobDto, VehicleJobDto, VendorLineTargetDto } from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา gate request replay ตาม ref จาก DB
export async function findGateRequestReplayByRef(
  gateTransactionRef: string,
  connection?: DbConnection
): Promise<GateRequestReplayRecord | null> {
  const db = client(connection);
  const requestLog = await db.gateRequestLog.findUnique({
    where: {
      gateTransactionRef,
    },
  });

  if (!requestLog) {
    return null;
  }

  return {
    gate_transaction_ref: requestLog.gateTransactionRef,
    payload_snapshot: requestLog.payloadSnapshot,
    response_snapshot: requestLog.responseSnapshot as unknown as GateVehicleJobResponse | null,
  };
}

// Function ค้นหา vehicle job (TicketNumber) ตาม ref จาก DB
export async function findVehicleJobByRef(
  ticketNumber: string,
  connection?: DbConnection
): Promise<VehicleJobDto | null> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      ticketNumber,
    },
  });

  return mapVehicleJob(vehicleJob);
}

// Function ค้นหา BoothCode ที่มีอยู่แล้วภายใต้ Business Ticket (market job) หนึ่งใบ — ใช้ตรวจก่อนรับ
// แผงเพิ่มเข้า Ticket เดิม (เมื่อ Gate ส่ง TicketNo + ตลาดเดิมซ้ำ) กัน BoothCode ชนกัน
export async function findGateTicketBoothCodesByMarketJobId(
  marketJobId: number,
  connection?: DbConnection
): Promise<string[]> {
  const db = client(connection);
  const tickets = await db.gateTicket.findMany({
    where: {
      marketJobId,
    },
    select: {
      boothCode: true,
    },
  });

  return tickets.map((ticket) => ticket.boothCode);
}

// Function ค้นหา active vendor LINE targets ตาม stall จาก DB
// ใช้ logic เดียวกับ listActiveVendorLineTargetsForTicket (gate-ticket.repository.ts) ผ่าน helper
// กลาง findActiveVendorLineTargetsByMarketAndBooth เพราะ Gate ยังไม่มี ticketId ตอนสร้าง Ticket ใหม่
export async function findActiveVendorLineTargetsByStall(
  marketCode: string,
  boothCode: string,
  connection?: DbConnection
): Promise<VendorLineTargetDto[]> {
  return gateTicketRepository.findActiveVendorLineTargetsByMarketAndBooth(
    marketCode,
    boothCode,
    connection
  );
}

// TEST HELPER: ใช้โดย GET /api/gate/options
// Function ดึงรายการตลาดที่พร้อมใช้สำหรับ Gate integration testing
export async function listGateMarketOptions(
  marketCode?: string,
  connection?: DbConnection
) {
  const db = client(connection);

  return db.masterMarket.findMany({
    where: {
      ...(marketCode
        ? {
          marketCode,
        }
        : {}),
      boothStatus: "Normal",
      marketName: {
        not: null,
      },
      OR: [
        { marketStatus: null },
        { marketStatus: "Normal" },
      ],
    },
    select: {
      marketCode: true,
      marketName: true,
    },
    distinct: ["marketCode"],
    orderBy: {
      marketCode: "asc",
    },
  });
}

// TEST HELPER: ใช้โดย GET /api/gate/options
// Function ดึงรายการแผงของตลาดที่มี Vendor LINE mapping พร้อมใช้งาน
export async function listGateBoothOptionsByMarketCode(
  marketCode: string,
  connection?: DbConnection
): Promise<GateBoothOption[]> {
  const db = client(connection);

  const [marketBooths, vendorStalls] = await Promise.all([
    db.masterMarket.findMany({
      where: {
        marketCode,
        boothStatus: "Normal",
        OR: [
          { marketStatus: null },
          { marketStatus: "Normal" },
        ],
      },
      select: {
        boothCode: true,
        boothName: true,
      },
      orderBy: {
        boothCode: "asc",
      },
    }),

    db.masterOwnerStall.findMany({
      where: {
        marketCode,
        status: "active",
        ownerStatus: "Normal",
        lineUserId: {
          not: null,
        },
      },
      select: {
        boothCode: true,
      },
    }),
  ]);

  const configuredBoothCodes = new Set(
    vendorStalls.map((stall) => stall.boothCode)
  );

  return marketBooths
    .filter((booth) =>
      configuredBoothCodes.has(booth.boothCode)
    )
    .map((booth) => ({
      BoothCode: booth.boothCode,
      BoothName: booth.boothName,
    }));
}

// TEST HELPER: ใช้โดย GET /api/gate/options
// Function ดึงรายการสินค้าและแพ็กเกจที่ยังใช้งานอยู่สำหรับ Gate integration testing
export async function listGateProductPackageOptions(
  connection?: DbConnection
) {
  const db = client(connection);

  return db.masterProduct.findMany({
    where: {
      status: "ACTIVE",
    },
    select: {
      productCode: true,
      productName: true,
      packageCode: true,
      packageName: true,
      packageWeight: true,
    },
    orderBy: [
      {
        productCode: "asc",
      },
      {
        packageCode: "asc",
      },
    ],
  });
}

// Function ค้นหา master_product จาก productFullCode + packageCode ที่ยังใช้งานอยู่
export async function findActiveMarketBoothByCodes(
  marketCode: string,
  boothCode: string,
  connection?: DbConnection
): Promise<MasterMarket | null> {
  const db = client(connection);
  const marketBooth = await db.masterMarket.findUnique({
    where: {
      marketCode_boothCode: {
        marketCode,
        boothCode,
      },
    },
  });

  if (
    !marketBooth ||
    marketBooth.boothStatus !== "Normal" ||
    (marketBooth.marketStatus !== null && marketBooth.marketStatus !== "Normal")
  ) {
    return null;
  }

  return marketBooth;
}

// Function ค้นหา master_product จาก productCode + packageCode ที่ยังใช้งานอยู่
// Function สร้าง VehicleJob (ถ้ายังไม่มี) และสร้าง Business Ticket (market job) ใหม่ใต้ VehicleJob นั้น
// จาก payload ของ Gate
//
// หนึ่ง Gate request = หนึ่ง Business Ticket ใหม่เสมอ — Gate สร้างได้อย่างเดียว ไม่มี
// append/correction เข้า Ticket เดิม ผู้เรียก (service) ต้องตรวจสอบมาก่อนแล้วว่า [vehicleJobId,
// ticketNo] นี้ยังไม่มี Ticket ที่ยัง active อยู่ (ผ่าน findMarketJobByVehicleAndTicketNo ซึ่งกรอง
// CANCELLED ออกให้แล้ว) — TicketNo ที่ถูก Admin ยกเลิกไปแล้วนับเป็นว่างอีกครั้ง สร้างใหม่ผ่านฟังก์ชัน
// นี้ได้ตามปกติ (partial unique index ที่ DB อนุญาตไว้แล้ว)
export async function createVehicleJobFromGate(
  input: GateVehicleJobCreateInput,
  payloadSnapshot: Prisma.InputJsonValue,
  connection?: DbConnection
): Promise<{ vehicleJob: VehicleJobDto; marketJob: MarketJobDto }> {
  const db = client(connection);
  const market = input.markets[0];
  const dispatchNow = input.dispatch_now === true;
  const vehicleStatus = dispatchNow ? VEHICLE_JOB_STATUS.WORKING : VEHICLE_JOB_STATUS.WAIT;
  const ticketStatus = TICKET_STATUS.WAIT;
  const requestedWorkersRequired = Math.max(1, market.workers_required);

  const existingVehicleJob = await db.vehicleJob.findUnique({
    where: {
      ticketNumber: input.ticketNumber,
    },
  });

  const vehicleJob =
    existingVehicleJob ??
    (await db.vehicleJob.create({
      data: {
        ticketNumber: input.ticketNumber,
        licensePlate: input.license_plate,
        licensePlateProvince: input.license_plate_province,
        vehicleType: input.vehicle_type ?? null,
        workersRequired: requestedWorkersRequired,
        dispatchNow,
        status: vehicleStatus,
        driverQrToken: createRandomToken("driver_qr"),
      },
    }));

  const shouldUpdateVehicle =
    existingVehicleJob &&
    (existingVehicleJob.licensePlate !== input.license_plate ||
      existingVehicleJob.licensePlateProvince !== input.license_plate_province ||
      existingVehicleJob.vehicleType !== (input.vehicle_type ?? null) ||
      (dispatchNow && !existingVehicleJob.dispatchNow) ||
      (dispatchNow && existingVehicleJob.status === VEHICLE_JOB_STATUS.WAIT));

  const savedVehicleJob = shouldUpdateVehicle
    ? await db.vehicleJob.update({
      where: {
        id: vehicleJob.id,
      },
      data: {
        licensePlate: input.license_plate,
        licensePlateProvince: input.license_plate_province,
        vehicleType: input.vehicle_type ?? null,
        dispatchNow: existingVehicleJob.dispatchNow || dispatchNow,
        status: dispatchNow && existingVehicleJob.status === VEHICLE_JOB_STATUS.WAIT
          ? vehicleStatus
          : existingVehicleJob.status,
      },
    })
    : vehicleJob;
  const marketStatus =
    savedVehicleJob.status === VEHICLE_JOB_STATUS.WORKING || dispatchNow
      ? VEHICLE_JOB_STATUS.WORKING
      : VEHICLE_JOB_STATUS.WAIT;

  let savedMarket;

  if (input.existingMarketJobId) {
    // Gate ส่งแผงชุดใหม่เข้า Ticket เดิม (TicketNo + ตลาดเดิม, ยัง active) — boothCount บวกเพิ่มเฉพาะ
    // แผงใหม่ในคำขอนี้ workersRequired ใช้ MAX ระหว่างของเดิมกับของคำขอนี้ (แผงเดิมไม่ถูกแตะ ค่าเดิม
    // ยังถูกต้องอยู่ ไม่ต้องคำนวณใหม่จากศูนย์)
    const existingMarket = await db.marketJob.findUniqueOrThrow({
      where: {
        id: input.existingMarketJobId,
      },
    });

    savedMarket = await db.marketJob.update({
      where: {
        id: input.existingMarketJobId,
      },
      data: {
        boothCount: { increment: market.booth_count },
        workersRequired: Math.max(existingMarket.workersRequired, requestedWorkersRequired),
        gateTransactionRef: market.gate_transaction_ref,
      },
    });
  } else {
    savedMarket = await db.marketJob.create({
      data: {
        vehicleJobId: savedVehicleJob.id,
        ticketNo: market.ticketNo,
        ticketCreatedAt: market.ticket_created_at,
        boothCount: market.booth_count,
        gateTransactionRef: market.gate_transaction_ref,
        workersRequired: requestedWorkersRequired,
        marketCode: market.marketCode,
        marketName: market.marketName,
        dropoffPoint: market.dropoff_point ?? null,
        status: marketStatus,
      },
    });
  }

  for (const booth of market.booths) {
    const createdTicket = await db.gateTicket.create({
      data: {
        vehicleJobId: savedVehicleJob.id,
        marketJobId: savedMarket.id,
        boothCode: booth.boothCode,
        boothName: booth.boothName ?? null,
        vendorLineId: booth.vendor_line_id ?? null,
        rejectReason: booth.reject_reason ?? null,
        status: ticketStatus,
      },
    });
    const ticketId = createdTicket.id;

    for (const product of booth.products) {
      await db.ticketProduct.create({
        data: {
          ticketId,
          productCode: product.productCode,
          productFullCode: product.productFullCode,
          productName: product.productName,
          packageCode: product.packageCode,
          packageName: product.packageName,
          quantity: product.quantity,
          packageWeightSnapshot: product.packageWeightSnapshot,
          rateIdSnapshot: product.rateIdSnapshot,
          sourceRateIdSnapshot: product.sourceRateIdSnapshot,
          rateMarketCode: product.rateMarketCode,
          rateSource: product.rateSource,
          weightRangeName: product.weightRangeName,
          weightMinSnapshot: product.weightMinSnapshot,
          weightMaxSnapshot: product.weightMaxSnapshot,
          stallRateSnapshot: product.stallRateSnapshot,
          laborRateSnapshot: product.laborRateSnapshot,
          rateSnapshotAt: product.rateSnapshotAt,
        },
      });
    }
  }

  // Worker requirement ของ TicketNumber = ผลรวม (SUM) ของทุก Business Ticket ที่ยัง active (ไม่นับ
  // แถวที่ถูก Admin ยกเลิกไปแล้ว) ใต้รถคันนี้ ห้ามใช้ MAX เพราะแต่ละ Business Ticket ต้องการ Worker
  // เพิ่มเข้าไปจริง ไม่ใช่แทนที่กัน
  const workersRequiredSum = await db.marketJob.aggregate({
    where: {
      vehicleJobId: savedVehicleJob.id,
      status: { not: VEHICLE_JOB_STATUS.CANCELLED },
    },
    _sum: {
      workersRequired: true,
    },
  });
  const totalWorkersRequired = workersRequiredSum._sum.workersRequired ?? requestedWorkersRequired;

  // Gate ไม่ส่ง TicketCount มาบอกล่วงหน้าอีกต่อไป — แต่ละ Gate create คือ Ticket ที่สมบูรณ์ในตัวเองแล้ว
  // เสมอ ไม่มีสัญญาณ "รอ Ticket อื่นตามมาอีก" จาก Gate เลย จึงปิดรับทันทีตั้งแต่ Ticket แรกที่สร้างสำเร็จ
  // (ตั้งครั้งเดียว ไม่ทับค่าเดิมถ้าเคยตั้งไปแล้ว) expectedTicketCount เป็นแค่ค่านับ Ticket ที่ active
  // จริง ณ ตอนนี้ (นับตาม TicketNo/ตลาดที่ต่างกัน ไม่นับแถวที่ถูกยกเลิกไปแล้ว) ไว้แสดงผล ไม่ใช่เงื่อนไข
  // ปิดรับอีกต่อไป
  const ticketsClosedAt = savedVehicleJob.ticketsClosedAt ?? new Date();

  const ticketCount = await db.marketJob.count({
    where: {
      vehicleJobId: savedVehicleJob.id,
      status: { not: VEHICLE_JOB_STATUS.CANCELLED },
    },
  });

  const finalVehicleJob = await db.vehicleJob.update({
    where: {
      id: savedVehicleJob.id,
    },
    data: {
      workersRequired: totalWorkersRequired,
      expectedTicketCount: ticketCount,
      ticketsClosedAt,
    },
  });

  await db.gateRequestLog.create({
    data: {
      gateTransactionRef: market.gate_transaction_ref,
      vehicleJobId: finalVehicleJob.id,
      marketJobId: savedMarket.id,
      payloadSnapshot,
    },
  });

  return {
    vehicleJob: requireDto(mapVehicleJob(finalVehicleJob), "vehicle job create"),
    marketJob: requireDto(mapMarketJob(savedMarket), "market job create"),
  };
}

// Function อัปเดต gate request response จาก DB
export async function updateGateRequestResponse(
  gateTransactionRef: string,
  responseSnapshot: Prisma.InputJsonValue,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);
  await db.gateRequestLog.update({
    where: {
      gateTransactionRef,
    },
    data: {
      responseSnapshot,
    },
  });
}
