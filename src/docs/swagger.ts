import type { Express, Request, Response } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { toPascalCaseKey, toPascalCasePayload } from "../middlewares/api-case.middleware";

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
    "post /api/admin/jobs/workers/{id}/status/force": 28,
    "post /api/admin/jobs/cancel": 29,
    "get /api/admin/vehicle-jobs/operations": 30,
    "get /api/admin/vehicle-jobs/history": 31,
    "post /api/admin/vehicle-jobs/{ticketNo}/assign-workers": 32,
    "post /api/admin/vehicle-jobs/{ticketNo}/scan-deadline/extend": 33,
    "post /api/admin/vehicle-jobs/{ticketNo}/workers/{workerCode}/assignment/cancel": 34,
    "get /api/admin/settings": 39,
    "patch /api/admin/settings": 40,
    "get /api/admin/roles": 41,
    "get /api/admin/users/{id}/permissions": 42,
    "patch /api/admin/users/{id}/permissions": 43,
    "post /api/gate/tickets": 50,
    // Driver
    "post /api/driver/qr-sessions": 60,
    "get /api/driver/jobs/current": 61,
    "post /api/driver/jobs/{ticketNo}/ready": 62,
    // Worker Application
    "get /ws/workers": 70,
    "get /api/workers/me/status": 71,
    "get /api/workers/me/assignments/history": 72,
    "post /api/workers/me/online": 73,
    "post /api/workers/me/offline": 74,
    "post /api/workers/me/break": 75,
    "post /api/workers/me/assignments/{ticketNo}/accept": 76,
    "post /api/workers/me/assignments/{ticketNo}/check-in-qr": 77,
    "post /api/workers/me/tickets/{boothCode}/complete": 78,
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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const swaggerDescriptionReplacements: Array<[string, string]> = [
  ["access_token", "AccessToken"],
  ["refresh_token", "RefreshToken"],
  ["login_challenge_token", "LoginChallengeToken"],
  ["target_type", "TargetType"],
  ["qr_token", "QrToken"],
  ["worker_qr_token", "WorkerQrToken"],
  ["driver_qr_token", "DriverQrToken"],
  ["client_id", "ClientId"],
  ["client_secret", "ClientSecret"],
  ["secret_hash", "SecretHash"],
  ["gate_transaction_ref", "GateTransactionRef"],
  ["assignment.created_at", "assignment.CreatedAt"],
  ["accept_deadline_at", "AcceptDeadlineAt"],
];

function transformDescriptionText(description: string): string {
  return swaggerDescriptionReplacements.reduce(
    (nextDescription, [from, to]) => nextDescription.split(from).join(to),
    description
  );
}

function transformSchemaKeys(schema: unknown, seen = new Set<unknown>()): void {
  if (Array.isArray(schema)) {
    for (const entry of schema) {
      transformSchemaKeys(entry, seen);
    }

    return;
  }

  if (!isObject(schema) || seen.has(schema)) {
    return;
  }

  seen.add(schema);

  if (typeof schema.description === "string") {
    schema.description = transformDescriptionText(schema.description);
  }

  if (Array.isArray(schema.required)) {
    schema.required = schema.required.map((key) =>
      typeof key === "string" ? toPascalCaseKey(key) : key
    );
  }

  if (isObject(schema.properties)) {
    const transformedProperties: Record<string, unknown> = {};

    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      transformedProperties[toPascalCaseKey(key)] = propertySchema;
      transformSchemaKeys(propertySchema, seen);
    }

    schema.properties = transformedProperties;
  }

  if ("example" in schema) {
    schema.example = toPascalCasePayload(schema.example);
  }

  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" || key === "required" || key === "example" || key === "description") {
      continue;
    }

    transformSchemaKeys(value, seen);
  }
}

function buildExternalOpenApiSpec(): Record<string, unknown> {
  const externalOpenapi = JSON.parse(JSON.stringify(openapi)) as Record<string, unknown>;
  transformSchemaKeys(externalOpenapi);

  return externalOpenapi;
}

const externalOpenapi = buildExternalOpenApiSpec();

export default function setupSwagger(app: Express): void {
  app.get("/api-docs/openapi.json", (_req: Request, res: Response) => {
    res.json(externalOpenapi);
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
