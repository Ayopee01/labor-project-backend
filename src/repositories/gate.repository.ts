// import Library
import { Prisma } from "@prisma/client";

// import
import { TICKET_STATUS, VEHICLE_JOB_STATUS } from "../constants/job-status";
import { mapVehicleJob } from "./shared/mappers";
import { client, createRandomToken, requireDto } from "./shared/repository-utils";

// import Types
import type { DbConnection } from "../types/common.type";
import type { GateRequestReplayRecord, GateVehicleJobCreateInput, GateVehicleJobResponse } from "../types/gate.type";
import type { VehicleJobDto } from "../types/worker.type";

/* -------------------------------------- Functions -------------------------------------- */

// Function หา log request จาก Gate ด้วย idempotency key
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

// Function หา request log สำหรับตรวจ replay/idempotency ของ gate_transaction_ref
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

// Function หา VehicleJob จากเลขอ้างอิงงานรถ
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

// Function สร้างงานรถจาก Gate พร้อมตลาด ตั๋ว สินค้า QR token และ request log
export async function createVehicleJobFromGate(
  input: GateVehicleJobCreateInput,
  payloadSnapshot: Prisma.InputJsonValue,
  connection?: DbConnection
): Promise<VehicleJobDto> {
  const db = client(connection);
  const dispatchNow = input.dispatch_now === true;
  const vehicleStatus = dispatchNow ? VEHICLE_JOB_STATUS.WORKING : VEHICLE_JOB_STATUS.WAIT;
  const ticketStatus = TICKET_STATUS.WAIT;
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
        workersRequired: 1,
        dispatchNow,
        status: vehicleStatus,
        driverQrToken: createRandomToken("driver_qr"),
        workerQrToken: input.ticketNo,
      },
    }));
  const shouldUpdateVehicle =
    existingVehicleJob &&
    (existingVehicleJob.gateTransactionRef !== input.gate_transaction_ref ||
      existingVehicleJob.licensePlate !== input.license_plate ||
      existingVehicleJob.vehicleType !== (input.vehicle_type ?? null) ||
      existingVehicleJob.workersRequired !== 1 ||
      existingVehicleJob.workerQrToken !== input.ticketNo ||
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
          workersRequired: 1,
          workerQrToken: input.ticketNo,
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
          confirmationStatus: ticketStatus,
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

// Function บันทึก response snapshot ให้ Gate request log
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
