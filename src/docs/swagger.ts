import type { Express, Request, Response } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

/* -------------------------------------- Functions -------------------------------------- */

// Function เรียง tag ของ Swagger โดยให้ System แสดงก่อน แล้วตามด้วย Auth และ Admin
function sortSwaggerTags(firstTag: string, secondTag: string): number {
  const tagOrder: Record<string, number> = {
    System: 0,
    Auth: 1,
    "Admin Workers": 2,
    "Admin Jobs": 3,
    "Admin Settings": 4,
    "Admin Realtime": 5,
    Gate: 6,
    Driver: 7,
    "Worker Application": 8,
    LINE: 9,
  };
  const firstOrder = tagOrder[firstTag] ?? 999;
  const secondOrder = tagOrder[secondTag] ?? 999;

  return firstOrder - secondOrder || firstTag.localeCompare(secondTag);
}

// Function เรียง API ใน Swagger ตาม flow การใช้งานของระบบ
function sortSwaggerOperations(
  firstOperation: { get: (key: string) => string },
  secondOperation: { get: (key: string) => string }
): number {
  const operationOrder: Record<string, number> = {
    // System
    "get /": 0,
    "get /health": 1,
    // Auth
    "post /api/auth/login": 10,
    "post /api/auth/login/confirm-force": 11,
    "post /api/auth/refresh": 12,
    "post /api/auth/logout": 13,
    "get /api/auth/me": 14,
    // Admin
    "get /api/admin/users": 20,
    "get /api/admin/users/{id}": 21,
    "post /api/admin/users": 22,
    "patch /api/admin/users/{id}": 23,
    "patch /api/admin/users/{id}/password": 24,
    "get /api/admin/jobs/workers/{id}/work-schedules": 25,
    "get /api/admin/jobs/workers/status": 26,
    "get /api/admin/jobs/workers/status/{id}": 27,
    "post /api/admin/jobs/workers/{id}/status/force": 28,
    "get /api/admin/vehicle-jobs": 29,
    "get /api/admin/vehicle-jobs/{vehicleJobRef}": 30,
    "post /api/admin/vehicle-jobs/{vehicleJobRef}/cancel": 31,
    "post /api/admin/vehicle-jobs/{vehicleJobRef}/cancel-and-requeue": 32,
    "post /api/admin/vehicle-jobs/{vehicleJobRef}/assign-workers": 33,
    "post /api/admin/vehicle-jobs/{vehicleJobRef}/scan-deadline/extend": 34,
    "post /api/admin/vehicle-jobs/{vehicleJobRef}/workers/{workerCode}/assignment/cancel": 35,
    "post /api/admin/market-jobs/{marketJobRef}/cancel": 36,
    "post /api/admin/stall-jobs/{stallJobRef}/cancel": 37,
    "post /api/admin/stall-jobs/{stallJobRef}/reopen": 38,
    "get /api/admin/settings": 39,
    "patch /api/admin/settings": 40,
    "get /api/admin/roles": 41,
    "get /api/admin/users/{id}/permissions": 42,
    "patch /api/admin/users/{id}/permissions": 43,
    "post /api/gate/vehicle-jobs": 50,
    // Driver
    "post /api/driver/qr-sessions": 60,
    "get /api/driver/jobs/current": 61,
    "post /api/driver/jobs/{vehicleJobRef}/ready": 62,
    // Worker Application
    "get /ws/workers": 70,
    "get /api/workers/me/status": 71,
    "get /api/workers/me/assignments/history": 72,
    "post /api/workers/me/online": 73,
    "post /api/workers/me/offline": 74,
    "post /api/workers/me/break": 75,
    "post /api/workers/me/assignments/{vehicleJobRef}/accept": 76,
    "post /api/workers/me/assignments/{vehicleJobRef}/check-in-qr": 77,
    "post /api/workers/me/tickets/{stallJobRef}/complete": 78,
    "get /api/admin/events": 85,
    "post /api/line/webhook": 90,
  };
  const firstKey = `${firstOperation.get("method")} ${firstOperation.get("path")}`;
  const secondKey = `${secondOperation.get("method")} ${secondOperation.get("path")}`;
  const firstOrder = operationOrder[firstKey] ?? 999;
  const secondOrder = operationOrder[secondKey] ?? 999;

  return firstOrder - secondOrder || firstKey.localeCompare(secondKey);
}

// Config OpenAPI specification จากไฟล์ YAML ของแต่ละ Swagger tag
const openapi = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Backend API",
      version: "1.0.0",
    },
  },
  apis: [
    "./src/docs/openapi/system.yaml",
    "./src/docs/openapi/auth.yaml",
    "./src/docs/openapi/admin-workers.yaml",
    "./src/docs/openapi/admin-jobs.yaml",
    "./src/docs/openapi/admin-settings.yaml",
    "./src/docs/openapi/gate.yaml",
    "./src/docs/openapi/driver.yaml",
    "./src/docs/openapi/worker.yaml",
    "./src/docs/openapi/notifications.yaml",
    "./src/docs/openapi/line.yaml",
    "./src/docs/openapi/components.yaml",
  ],
});

export default function setupSwagger(app: Express): void {
  app.get("/api-docs/openapi.json", (_req: Request, res: Response) => {
    res.json(openapi);
  });

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(null, {
      customSiteTitle: "Backend API Docs",
      swaggerOptions: {
        url: "/api-docs/openapi.json",
        tagsSorter: sortSwaggerTags,
        operationsSorter: sortSwaggerOperations,
      },
    })
  );
}
