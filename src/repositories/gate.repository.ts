// Import Library
import { Prisma, type MasterMarket, type MasterProduct, type MasterRate } from "@prisma/client";

// Import Dependencies
import { TICKET_STATUS, VEHICLE_JOB_STATUS } from "../constants/job-status";
import { mapMarketJob, mapVehicleJob } from "./shared/mappers";
import { client, createRandomToken, requireDto } from "./shared/repository-utils";

// Import Types
import type { DbConnection } from "../types/shared/common.type";
import type { GateRequestReplayRecord, GateVehicleJobCreateInput, GateVehicleJobResponse, GateVendorLineTargetDto, GateBoothOption } from "../types/gate.type";
import type { MarketJobDto, VehicleJobDto } from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function ค้นหา gate request response ตาม ref จาก DB
export async function findGateRequestResponseByRef(
  gateTransactionRef: string,
  connection?: DbConnection
): Promise<GateVehicleJobResponse | null> {
  const db = client(connection);
  const requestLog = await db.gateRequestLog.findUnique({
    where: {
      gateTransactionRef,
    },
  });

  if (!requestLog?.responseSnapshot) {
    return null;
  }

  return requestLog.responseSnapshot as unknown as GateVehicleJobResponse;
}

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

// Function ค้นหา active vendor LINE targets ตาม stall จาก DB
export async function findActiveVendorLineTargetsByStall(
  marketCode: string,
  boothCode: string,
  connection?: DbConnection
): Promise<GateVendorLineTargetDto[]> {
  const db = client(connection);
  const ownerStall = await db.masterOwnerStall.findUnique({
    where: {
      marketCode_boothCode: {
        marketCode,
        boothCode,
      },
    },
  });

  if (
    !ownerStall ||
    ownerStall.status !== "active" ||
    ownerStall.ownerStatus !== "Normal" ||
    !ownerStall.lineUserId
  ) {
    return [];
  }

  const members = await db.masterMemberStall.findMany({
    where: {
      marketCode: ownerStall.marketCode,
      ownerIdCard: ownerStall.cardId,
      ownerLineUserId: ownerStall.lineUserId,
      status: "active",
      memberStallStatusOnStall: "1",
    },
    orderBy: {
      id: "asc",
    },
  });
  const seen = new Set<string>();
  const targets: GateVendorLineTargetDto[] = [];
  const addTarget = (lineUserId: string, targetType: GateVendorLineTargetDto["target_type"]) => {
    if (seen.has(lineUserId)) {
      return;
    }

    seen.add(lineUserId);
    targets.push({
      line_user_id: lineUserId,
      target_type: targetType,
    });
  };

  addTarget(ownerStall.lineUserId, "owner");

  for (const member of members) {
    addTarget(member.memberStallLineUserId, "member");
  }

  return targets;
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
export async function findActiveProductsByProductCodeAndPackageCode(
  productCode: string,
  packageCode: string,
  connection?: DbConnection
): Promise<MasterProduct[]> {
  const db = client(connection);

  return db.masterProduct.findMany({
    where: {
      productCode,
      packageCode,
      status: "ACTIVE",
    },
    orderBy: {
      id: "asc",
    },
  });
}

// Function ค้นหา master_rate ที่ตรง market และช่วงน้ำหนักที่ยังใช้งานอยู่
export async function findActiveRatesByMarketAndWeight(
  marketCode: string,
  packageWeight: Prisma.Decimal,
  connection?: DbConnection
): Promise<MasterRate[]> {
  const db = client(connection);

  return db.masterRate.findMany({
    where: {
      marketCode,
      status: 1,
      weightMin: {
        lt: packageWeight,
      },
      weightMax: {
        gte: packageWeight,
      },
    },
    orderBy: {
      id: "asc",
    },
  });
}

// Function สร้าง VehicleJob (ถ้ายังไม่มี) และสร้าง Business Ticket (market job) ใหม่ใต้ VehicleJob นั้น
// จาก payload ของ Gate
//
// หนึ่ง Gate request = หนึ่ง Business Ticket เสมอ ผู้เรียก (service) ต้องตรวจสอบมาก่อนแล้วว่า
// [vehicleJobId, ticketNo] นี้ยังไม่เคยมี (ผ่าน findMarketJobByVehicleAndTicketNo) ฟังก์ชันนี้จึง
// สร้าง MarketJob/GateTicket/TicketProduct ใหม่เสมอ ไม่ต้อง upsert
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
        expectedTicketCount: input.expected_ticket_count ?? null,
      },
    }));

  const shouldUpdateVehicle =
    existingVehicleJob &&
    (existingVehicleJob.licensePlate !== input.license_plate ||
      existingVehicleJob.licensePlateProvince !== input.license_plate_province ||
      existingVehicleJob.vehicleType !== (input.vehicle_type ?? null) ||
      (input.expected_ticket_count !== undefined &&
        existingVehicleJob.expectedTicketCount !== input.expected_ticket_count) ||
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
        expectedTicketCount: input.expected_ticket_count ?? existingVehicleJob.expectedTicketCount,
      },
    })
    : vehicleJob;
  const marketStatus =
    savedVehicleJob.status === VEHICLE_JOB_STATUS.WORKING || dispatchNow
      ? VEHICLE_JOB_STATUS.WORKING
      : VEHICLE_JOB_STATUS.WAIT;

  const createdMarket = await db.marketJob.create({
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
      workerQrToken: createRandomToken("worker_qr"),
    },
  });

  for (const booth of market.booths) {
    const createdTicket = await db.gateTicket.create({
      data: {
        vehicleJobId: savedVehicleJob.id,
        marketJobId: createdMarket.id,
        boothCode: booth.boothCode,
        boothName: booth.boothName ?? null,
        vendorLineId: booth.vendor_line_id ?? null,
        rejectReason: booth.reject_reason ?? null,
        status: ticketStatus,
      },
    });

    for (const product of booth.products) {
      await db.ticketProduct.create({
        data: {
          ticketId: createdTicket.id,
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

  // Worker requirement ของ TicketNumber = ผลรวม (SUM) ของทุก Business Ticket ใต้รถคันนี้
  // ห้ามใช้ MAX เพราะแต่ละ Business Ticket ต้องการ Worker เพิ่มเข้าไปจริง ไม่ใช่แทนที่กัน
  const workersRequiredSum = await db.marketJob.aggregate({
    where: {
      vehicleJobId: savedVehicleJob.id,
    },
    _sum: {
      workersRequired: true,
    },
  });
  const totalWorkersRequired = workersRequiredSum._sum.workersRequired ?? requestedWorkersRequired;

  // ปิดรับ Ticket เพิ่มอัตโนมัติทันทีที่จำนวน Business Ticket ที่สร้างจริงถึง TicketCount ที่ Gate
  // แจ้งไว้ (ไม่มี endpoint close แยกต่างหากอีกต่อไป — Gate รู้จำนวนนี้แน่นอนตั้งแต่ตอนสร้างออเดอร์)
  let ticketsClosedAt = savedVehicleJob.ticketsClosedAt;

  if (ticketsClosedAt === null) {
    const ticketCount = await db.marketJob.count({
      where: {
        vehicleJobId: savedVehicleJob.id,
      },
    });

    if (ticketCount >= input.expected_ticket_count) {
      ticketsClosedAt = new Date();
    }
  }

  const finalVehicleJob = await db.vehicleJob.update({
    where: {
      id: savedVehicleJob.id,
    },
    data: {
      workersRequired: totalWorkersRequired,
      expectedTicketCount: input.expected_ticket_count,
      ticketsClosedAt,
    },
  });

  await db.gateRequestLog.create({
    data: {
      gateTransactionRef: market.gate_transaction_ref,
      vehicleJobId: finalVehicleJob.id,
      marketJobId: createdMarket.id,
      payloadSnapshot,
    },
  });

  return {
    vehicleJob: requireDto(mapVehicleJob(finalVehicleJob), "vehicle job create"),
    marketJob: requireDto(mapMarketJob(createdMarket), "market job create"),
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
