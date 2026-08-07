// Import Library
import { Prisma } from "@prisma/client";

// Import Dependencies
import * as workerApplicationRepository from "../repositories/worker.repository";

// Import Types
import type { DbConnection } from "../types/shared/common.type";

// Import Config
import { TICKET_STATUS } from "../constants/job-status";

// Import Utils
import ApiError from "../utils/api-error";
import {
    calculateProductStallCharge,
    calculateProductWorkerPayment,
} from "../utils/labor-job-pricing";

/* -------------------------------------- Types -------------------------------------- */

export type TicketFinancializationResult = {
    ticketId: number;

    productCount: number;
    workerCount: number;

    finalStallAmount:
    Prisma.Decimal;

    finalizedAt: Date;

    alreadyFinalized: boolean;
};

/* -------------------------------------- Functions -------------------------------------- */

// Functionตรวจสอบว่า Product มี Rate Snapshot
// ที่จำเป็นสำหรับ Financialization ครบหรือไม่
function hasCompleteRateSnapshot(
    product: {
        packageWeightSnapshot:
        Prisma.Decimal | null;

        rateIdSnapshot:
        number | null;

        sourceRateIdSnapshot:
        number | null;

        rateMarketCode:
        string | null;

        rateSource:
        string | null;

        weightRangeName:
        string | null;

        weightMinSnapshot:
        Prisma.Decimal | null;

        weightMaxSnapshot:
        Prisma.Decimal | null;

        stallRateSnapshot:
        Prisma.Decimal | null;

        laborRateSnapshot:
        Prisma.Decimal | null;

        rateSnapshotAt:
        Date | null;
    }
): boolean {
    return (
        product.packageWeightSnapshot !==
        null &&

        product.rateIdSnapshot !==
        null &&

        product.sourceRateIdSnapshot !==
        null &&

        product.rateMarketCode !==
        null &&

        product.rateSource !==
        null &&

        product.weightRangeName !==
        null &&

        product.weightMinSnapshot !==
        null &&

        product.weightMaxSnapshot !==
        null &&

        product.stallRateSnapshot !==
        null &&

        product.laborRateSnapshot !==
        null &&

        product.rateSnapshotAt !==
        null
    );
}

// Function Finalize เงินทั้งหมดของ Ticket/Booth
//
// หลักการ:
// - ใช้ confirmedQuantity เท่านั้น
// - ใช้ Rate Snapshot เท่านั้น
// - ใช้ Worker ที่ COMPLETED ใน Booth นี้จริงเท่านั้น
// - คิดแยก Product
// - ProductCharge ปัดขึ้นแยกแต่ละ Product
// - Worker หารแยกแต่ละ Product
// - Fund คำนวณแยกแต่ละ Product
// - ห้าม Query Master Rate ใหม่
export async function finalizeTicketFinancials(
    ticketId: number,
    connection?: DbConnection
): Promise<TicketFinancializationResult> {
    const context =
        await workerApplicationRepository
            .findTicketFinancializationContext(
                ticketId,
                connection
            );

    if (!context) {
        throw new ApiError(
            404,
            "TICKET_NOT_FOUND",
            "Ticket not found for financialization."
        );
    }

    // Idempotent:
    // ถ้า Financialize แล้วให้คืนค่าเดิม
    // ห้ามคำนวณหรือสร้างรายการใหม่
    if (context.financializedAt) {
        if (
            context.finalStallAmount ===
            null
        ) {
            throw new ApiError(
                500,
                "TICKET_FINANCIAL_STATE_INVALID",
                "Financialized ticket does not have final stall amount."
            );
        }

        return {
            ticketId:
                context.id,

            productCount:
                context.products.length,

            workerCount:
                context.workers.length,

            finalStallAmount:
                context.finalStallAmount,

            finalizedAt:
                context.financializedAt,

            alreadyFinalized:
                true,
        };
    }

    if (
        context.status !==
        TICKET_STATUS.COMPLETED
    ) {
        throw new ApiError(
            409,
            "TICKET_NOT_COMPLETED",
            "Ticket must be completed before financialization."
        );
    }

    if (
        context.products.length === 0
    ) {
        throw new ApiError(
            409,
            "TICKET_PRODUCTS_NOT_FOUND",
            "Ticket does not have products for financialization."
        );
    }

    // จำนวน Worker จริงของ Booth
    //
    // ไม่ใช้:
    // VehicleJob.workersRequired
    // Master Worker Range
    const actualWorkerCount =
        context.workers.length;

    if (actualWorkerCount <= 0) {
        throw new ApiError(
            409,
            "TICKET_WORKERS_NOT_FOUND",
            "Ticket does not have completed workers for financialization."
        );
    }

    // ถ้า Ticket ยังไม่ได้ Financialize
    // แต่มี Product Financial อยู่แล้ว
    // ถือว่าเป็น Partial State ที่ไม่ควรเกิดขึ้น
    //
    // ห้ามเขียนทับข้อมูลทางการเงินเก่า
    const hasExistingFinancial =
        context.products.some(
            (product) =>
                product.financial !== null
        );

    if (hasExistingFinancial) {
        throw new ApiError(
            500,
            "TICKET_FINANCIAL_PARTIAL_STATE",
            "Ticket has partial financial records before finalization."
        );
    }

    const finalizedAt =
        new Date();

    let finalStallAmount =
        new Prisma.Decimal(0);

    for (
        const product
        of context.products
    ) {
        if (
            product.confirmedQuantity ===
            null
        ) {
            throw new ApiError(
                409,
                "CONFIRMED_QUANTITY_MISSING",
                `Confirmed quantity is missing for ticket product ${product.id}.`
            );
        }

        if (
            !hasCompleteRateSnapshot(
                product
            )
        ) {
            throw new ApiError(
                409,
                "TICKET_RATE_SNAPSHOT_INCOMPLETE",
                `Rate snapshot is incomplete for ticket product ${product.id}.`
            );
        }

        /*
         * TypeScript ยังมอง field เป็น nullable
         * แม้ผ่าน hasCompleteRateSnapshot แล้ว
         * จึงเก็บเป็นตัวแปรหลัง validation
         */
        const stallRate =
            product.stallRateSnapshot;

        const laborRate =
            product.laborRateSnapshot;

        if (
            stallRate === null ||
            laborRate === null
        ) {
            throw new ApiError(
                409,
                "TICKET_RATE_SNAPSHOT_INCOMPLETE",
                `Rate snapshot is incomplete for ticket product ${product.id}.`
            );
        }

        // คำนวณยอดที่แผงต้องจ่าย
        // ด้วย confirmed quantity เท่านั้น
        const stallCharge =
            calculateProductStallCharge({
                quantity:
                    product.confirmedQuantity,

                stallRate,

                laborRate,
            });

        // คำนวณเงิน Worker
        // ด้วยจำนวน Worker จริงของ Booth
        const workerPayment =
            calculateProductWorkerPayment({
                laborFeeRaw:
                    stallCharge.laborFeeRaw,

                actualWorkerCount,
            });

        await workerApplicationRepository
            .createTicketProductFinancial(
                {
                    ticketProductId:
                        product.id,

                    confirmedQuantity:
                        product.confirmedQuantity,

                    stallFeeRaw:
                        stallCharge.stallFeeRaw,

                    stallFeeRounded:
                        stallCharge
                            .stallFeeRounded,

                    laborFeeRaw:
                        stallCharge.laborFeeRaw,

                    productCharge:
                        stallCharge.productCharge,

                    workerCount:
                        actualWorkerCount,

                    workerPayoutTotal:
                        workerPayment
                            .workerPayoutTotal,

                    fundAmount:
                        workerPayment
                            .fundAmount,

                    finalizedAt,

                    workerPayments:
                        context.workers.map(
                            (worker) => ({
                                ticketWorkerId:
                                    worker.id,

                                rawAmount:
                                    workerPayment
                                        .rawAmountPerWorker,

                                remainderAmount:
                                    workerPayment
                                        .remainderAmountPerWorker,

                                finalAmount:
                                    workerPayment
                                        .finalAmountPerWorker,
                            })
                        ),
                },
                connection
            );

        // รวมเฉพาะ ProductCharge
        // ที่ผ่านการปัดตาม Method A แล้ว
        finalStallAmount =
            finalStallAmount.plus(
                stallCharge.productCharge
            );
    }

    await workerApplicationRepository
        .markGateTicketFinancialized(
            context.id,
            finalStallAmount,
            finalizedAt,
            connection
        );

    return {
        ticketId:
            context.id,

        productCount:
            context.products.length,

        workerCount:
            actualWorkerCount,

        finalStallAmount,

        finalizedAt,

        alreadyFinalized:
            false,
    };
}