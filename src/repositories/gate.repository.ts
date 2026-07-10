// import Library
import { Prisma } from "@prisma/client";

// import
import { mapVehicleJob } from "./shared/mappers";
import { client, createRandomToken, requireDto } from "./shared/repository-utils";

// import Types
import type { DbConnection } from "../types/common.type";
import type { GateVehicleJobCreateInput, GateVehicleJobResponse } from "../types/gate.type";
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

// Function หา VehicleJob จากเลขอ้างอิงงานรถ
export async function findVehicleJobByRef(
  vehicleJobRef: string,
  connection?: DbConnection
): Promise<VehicleJobDto | null> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.findUnique({
    where: {
      vehicleJobRef,
    },
  });

  return mapVehicleJob(vehicleJob);
}

export async function createVehicleJobFromGate(
  input: GateVehicleJobCreateInput,
  payloadSnapshot: Prisma.InputJsonValue,
  connection?: DbConnection
): Promise<VehicleJobDto> {
  const db = client(connection);
  const vehicleJob = await db.vehicleJob.create({
    data: {
      vehicleJobRef: input.vehicle_job_ref,
      gateTransactionRef: input.gate_transaction_ref,
      licensePlate: input.license_plate,
      vehicleType: input.vehicle_type ?? null,
      workersRequired: input.workers_required,
      status: "WAIT",
      driverQrToken: createRandomToken("driver_qr"),
      workerQrToken: createRandomToken("worker_qr"),
    },
  });

  for (const market of input.markets) {
    const createdMarket = await db.marketJob.create({
      data: {
        vehicleJobId: vehicleJob.id,
        marketJobRef: market.market_job_ref,
        marketName: market.market_name,
        status: "WAIT",
      },
    });

    for (const ticket of market.tickets) {
      await db.gateTicket.create({
        data: {
          vehicleJobId: vehicleJob.id,
          marketJobId: createdMarket.id,
          stallJobRef: ticket.stall_job_ref,
          ticketNo: ticket.ticket_no ?? null,
          stallNo: ticket.stall_no ?? null,
          vendorName: ticket.vendor_name ?? null,
          vendorLineId: ticket.vendor_line_id ?? null,
          status: "WAIT",
          confirmationStatus: "NOT_SUBMITTED",
          products: {
            create: ticket.products.map((product) => ({
              productType: product.product_type ?? null,
              name: product.name,
              quantity: product.quantity,
              unit: product.unit,
            })),
          },
        },
      });
    }
  }

  await db.gateRequestLog.create({
    data: {
      gateTransactionRef: input.gate_transaction_ref,
      vehicleJobId: vehicleJob.id,
      payloadSnapshot,
    },
  });

  return requireDto(mapVehicleJob(vehicleJob), "vehicle job create");
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
