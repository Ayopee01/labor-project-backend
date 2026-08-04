// Import Library
import { Prisma, type MasterMarket, type MasterProduct, type MasterRate } from "@prisma/client";

// Import Dependencies
import { TICKET_STATUS, VEHICLE_JOB_STATUS } from "../constants/job-status";
import { mapVehicleJob } from "./shared/mappers";
import { client, createRandomToken, requireDto } from "./shared/repository-utils";

// Import Types
import type { DbConnection } from "../types/shared/common.type";
import type { GateRequestReplayRecord, GateTicketAppendStateDto, GateVehicleJobCreateInput, GateVehicleJobResponse, GateVendorLineTargetDto } from "../types/gate.type";
import type { VehicleJobDto } from "../types/worker.type";

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

// Function ค้นหา vehicle job ตาม ref จาก DB
export async function findVehicleJobByRef(
  ticketNo: string,
  connection?: DbConnection
): Promise<VehicleJobDto | null> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      ticketNo,
    },
  });

  return mapVehicleJob(vehicleJob);
}

// Function ดึง Gate ticket append state จาก DB
export async function getGateTicketAppendState(
  ticketNo: string,
  boothCode: string,
  connection?: DbConnection
): Promise<GateTicketAppendStateDto | null> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      ticketNo,
    },
    select: {
      id: true,
      boothCount: true,
      tickets: {
        select: {
          boothCode: true,
          marketJob: {
            select: {
              marketCode: true,
            },
          },
        },
      },
    },
  });

  if (!vehicleJob) {
    return null;
  }

  const boothCodes = new Set(vehicleJob.tickets.map((ticket) => ticket.boothCode));
  const duplicateBooth = vehicleJob.tickets.find(
    (ticket) => ticket.boothCode === boothCode
  );

  return {
    vehicle_job_id: vehicleJob.id,
    booth_count: vehicleJob.boothCount,
    existing_booth_count: boothCodes.size,
    duplicate_booth: duplicateBooth
      ? {
          boothCode: duplicateBooth.boothCode,
          marketCode: duplicateBooth.marketJob.marketCode,
        }
      : null,
  };
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

// Function สร้างหรืออัปเดต vehicle job, market, booth และสินค้า จาก payload ของ Gate
export async function createVehicleJobFromGate(
  input: GateVehicleJobCreateInput,
  payloadSnapshot: Prisma.InputJsonValue,
  connection?: DbConnection
): Promise<VehicleJobDto> {
  const db = client(connection);
  const dispatchNow = input.dispatch_now === true;
  const vehicleStatus = dispatchNow ? VEHICLE_JOB_STATUS.WORKING : VEHICLE_JOB_STATUS.WAIT;
  const ticketStatus = TICKET_STATUS.WAIT;
  const requestedWorkersRequired = Math.max(1, input.workers_required);
  const existingVehicleJob = await db.vehicleJob.findUnique({
    where: {
      ticketNo: input.ticketNo,
    },
  });
  const vehicleJob =
    existingVehicleJob ??
    (await db.vehicleJob.create({
      data: {
        ticketNo: input.ticketNo,
        gateTransactionRef: input.gate_transaction_ref,
        licensePlate: input.license_plate,
        vehicleType: input.vehicle_type ?? null,
        ticketCreatedAt: input.ticket_created_at,
        boothCount: input.booth_count,
        workersRequired: requestedWorkersRequired,
        dispatchNow,
        status: vehicleStatus,
        driverQrToken: createRandomToken("driver_qr"),
      },
    }));
  const savedWorkersRequired = existingVehicleJob
    ? Math.max(existingVehicleJob.workersRequired, requestedWorkersRequired)
    : requestedWorkersRequired;
  const shouldUpdateVehicle =
    existingVehicleJob &&
    (existingVehicleJob.gateTransactionRef !== input.gate_transaction_ref ||
      existingVehicleJob.licensePlate !== input.license_plate ||
      existingVehicleJob.vehicleType !== (input.vehicle_type ?? null) ||
      existingVehicleJob.ticketCreatedAt.getTime() !== input.ticket_created_at.getTime() ||
      existingVehicleJob.boothCount !== input.booth_count ||
      existingVehicleJob.workersRequired !== savedWorkersRequired ||
      (dispatchNow && !existingVehicleJob.dispatchNow) ||
      (dispatchNow && existingVehicleJob.status === VEHICLE_JOB_STATUS.WAIT));
  const savedVehicleJob = shouldUpdateVehicle
    ? await db.vehicleJob.update({
        where: {
          id: vehicleJob.id,
        },
        data: {
          gateTransactionRef: input.gate_transaction_ref,
          licensePlate: input.license_plate,
          vehicleType: input.vehicle_type ?? null,
          ticketCreatedAt: input.ticket_created_at,
          boothCount: input.booth_count,
          workersRequired: savedWorkersRequired,
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

  for (const market of input.markets) {
    const createdMarket = await db.marketJob.upsert({
      where: {
        vehicleJobId_marketCode: {
          vehicleJobId: savedVehicleJob.id,
          marketCode: market.marketCode,
        },
      },
      update: {
        marketName: market.marketName,
        dropoffPoint: market.dropoff_point ?? null,
        status: marketStatus,
      },
      create: {
        vehicleJobId: savedVehicleJob.id,
        marketCode: market.marketCode,
        marketName: market.marketName,
        dropoffPoint: market.dropoff_point ?? null,
        status: marketStatus,
      },
    });

    for (const ticket of market.tickets) {
      const createdTicket = await db.gateTicket.upsert({
        where: {
          marketJobId_boothCode: {
            marketJobId: createdMarket.id,
            boothCode: ticket.boothCode,
          },
        },
        update: {
          vehicleJobId: savedVehicleJob.id,
          boothName: ticket.boothName ?? null,
          vendorLineId: ticket.vendor_line_id ?? null,
          rejectReason: ticket.reject_reason ?? null,
        },
        create: {
          vehicleJobId: savedVehicleJob.id,
          marketJobId: createdMarket.id,
          boothCode: ticket.boothCode,
          boothName: ticket.boothName ?? null,
          vendorLineId: ticket.vendor_line_id ?? null,
          rejectReason: ticket.reject_reason ?? null,
          status: ticketStatus,
        },
      });

      for (const product of ticket.products) {
        await db.ticketProduct.upsert({
          where: {
            ticketId_productCode: {
              ticketId: createdTicket.id,
              productCode: product.productCode,
            },
          },
          update: {
            productName: product.productName,
            packageCode: product.packageCode,
            packageName: product.packageName,
            quantity: product.quantity,
          },
          create: {
            ticketId: createdTicket.id,
            productCode: product.productCode,
            productName: product.productName,
            packageCode: product.packageCode,
            packageName: product.packageName,
            quantity: product.quantity,
          },
        });
      }
    }
  }

  await db.gateRequestLog.create({
    data: {
      gateTransactionRef: input.gate_transaction_ref,
      vehicleJobId: savedVehicleJob.id,
      payloadSnapshot,
    },
  });

  return requireDto(mapVehicleJob(savedVehicleJob), "vehicle job create");
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
