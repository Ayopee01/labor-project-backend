import type { Express, Request, Response } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { toPascalCaseKey, toPascalCasePayload } from "../middlewares/api-case.middleware";

/* -------------------------------------- Functions -------------------------------------- */

// Function เรียง Swagger tags สำหรับ Swagger/OpenAPI
function sortSwaggerTags(firstTag: string, secondTag: string): number {
  const tagOrder: Record<string, number> = {
    System: 0,
    Auth: 1,
    "Admin Workers": 2,
    "Admin Jobs": 3,
    "Admin Audit": 4,
    "Admin Settings": 5,
    "Admin Realtime": 6,
    "Gate": 7,
    "Driver": 8,
    "Worker Application": 9,
    "LINE": 10,
  };
  const firstOrder = tagOrder[firstTag] ?? 999;
  const secondOrder = tagOrder[secondTag] ?? 999;

  return firstOrder - secondOrder || firstTag.localeCompare(secondTag);
}

// Function เรียง Swagger operations สำหรับ Swagger/OpenAPI
function sortSwaggerOperations(
  firstOperation: { get: (key: string) => string },
  secondOperation: { get: (key: string) => string }
): number {
  const operationOrder: Record<string, number> = {
    // System
    "get /ready": 0,
    // Auth
    "post /api/auth/login": 10,
    "post /api/auth/login/confirm-force": 11,
    "post /api/auth/refresh": 12,
    "post /api/auth/logout": 13,
    "post /api/auth/push-token": 14,
    "get /api/auth/me": 15,
    // Admin
    "get /api/admin/users": 20,
    "get /api/admin/users/{id}": 21,
    "post /api/admin/users": 22,
    "patch /api/admin/users/{id}": 23,
    "patch /api/admin/users/{id}/password": 24,
    "get /api/admin/jobs/workers/status": 26,
    "post /api/admin/jobs/workers/{id}/status/force": 28,
    "post /api/admin/vehicle-jobs/assignment/cancel": 29,
    "get /api/admin/vehicle-jobs/operations": 30,
    "get /api/admin/vehicle-jobs/history": 31,
    "get /api/admin/vehicle-jobs/history/daily-worker-income": 31.5,
    "get /api/admin/vehicle-jobs/{ticketNumber}/financials": 32,
    "post /api/admin/vehicle-jobs/{ticketNumber}/assign-workers": 33,
    "post /api/admin/vehicle-jobs/{ticketNumber}/scan-deadline/extend": 34,
    "post /api/admin/vehicle-jobs/{ticketNumber}/tickets/{ticketNo}/stalls/{stallCode}/override-count": 35.6,
    "post /api/admin/vehicle-jobs/{ticketNumber}/wait": 35.7,
    "post /api/admin/vehicle-jobs/{ticketNumber}/release-workers": 35.8,
    "get /api/admin/audit/workers/performance": 36,
    "get /api/admin/settings": 39,
    "patch /api/admin/settings": 40,
    "get /api/admin/mobile-app-versions": 40.1,
    "post /api/admin/mobile-app-versions": 40.2,
    "patch /api/admin/mobile-app-versions/{id}": 40.3,
    "get /api/admin/roles": 41,
    "get /api/admin/users/{id}/permissions": 42,
    "patch /api/admin/users/{id}/permissions": 43,
    // Gate
    "get /api/gate/options": 49,
    "post /api/gate/tickets": 50,
    // Driver
    "post /api/driver/qr-sessions": 60,
    "get /api/driver/jobs/current": 61,
    "post /api/driver/jobs/{ticketNumber}/ready": 62,
    // Worker Application
    "get /api/workers/app-version/check": 69.5,
    "get /ws/workers": 70,
    "get /api/workers/me/status": 71,
    "get /api/workers/me/assignments/history": 72,
    "get /api/workers/me/earnings/summary": 73,
    "post /api/workers/me/online": 74,
    "post /api/workers/me/offline": 75,
    "post /api/workers/me/break": 76,
    "post /api/workers/me/assignments/{ticketNumber}/accept": 77,
    "post /api/workers/me/assignments/check-in-barcode": 78,
    "get /api/workers/me/products/{productCode}/packages": 78.5,
    "post /api/workers/me/assignments/tickets/complete": 79,
    "get /api/admin/events": 85,
    "post /api/line/webhook": 90,
    "get /api/line/dev": 91,
    "get /api/line/dev/submissions": 92,
    "post /api/line/dev/submissions/{submissionId}/confirm": 93,
    "post /api/line/dev/submissions/{submissionId}/reject": 94,
  };
  const firstKey = `${firstOperation.get("method")} ${firstOperation.get("path")}`;
  const secondKey = `${secondOperation.get("method")} ${secondOperation.get("path")}`;
  const firstOrder = operationOrder[firstKey] ?? 999;
  const secondOrder = operationOrder[secondKey] ?? 999;

  return firstOrder - secondOrder || firstKey.localeCompare(secondKey);
}

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
    "./src/docs/openapi/admin-audit.yaml",
    "./src/docs/openapi/admin-settings.yaml",
    "./src/docs/openapi/gate.yaml",
    "./src/docs/openapi/driver.yaml",
    "./src/docs/openapi/worker.yaml",
    "./src/docs/openapi/notifications.yaml",
    "./src/docs/openapi/line.yaml",
    "./src/docs/openapi/components.yaml",
  ],
});

// Function ตรวจสอบ plain object ก่อนแปลง schema ของ OpenAPI แบบ recursive
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// Config ข้อความ description ของ field ที่ต้องแสดงเป็น PascalCase ใน Swagger
const swaggerDescriptionReplacements: Array<[string, string]> = [
  ["access_token", "AccessToken"],
  ["refresh_token", "RefreshToken"],
  ["login_challenge_token", "LoginChallengeToken"],
  ["target_type", "TargetType"],
  // Format specific replacement patterns before shorter patterns
  ["driver_qr_token", "DriverQrToken"],
  ["qr_token", "QrToken"],
  ["client_id", "ClientId"],
  ["client_secret", "ClientSecret"],
  ["secret_hash", "SecretHash"],
  ["gate_transaction_ref", "GateTransactionRef"],
  ["assignment.created_at", "assignment.CreatedAt"],
  ["accept_deadline_at", "AcceptDeadlineAt"],
];

// Config acronym ในคำอธิบาย Swagger ที่ต้องคงรูปตัวพิมพ์ใหญ่
const swaggerAcronymDocTerms = new Map<string, string>([
  ["api", "API"],
  ["fcm", "FCM"],
  ["id", "ID"],
  ["qr", "QR"],
  ["sdk", "SDK"],
  ["sse", "SSE"],
  ["ui", "UI"],
]);

// Function ปรับคำอังกฤษในคำอธิบาย Swagger ให้ขึ้นต้นด้วยพิมพ์ใหญ่
function capitalizeSwaggerEnglishTerms(text: string): string {
  const protectedSegments: string[] = [];
  const pathOrUrlPattern = /https?:\/\/\S+|\/[A-Za-z0-9_{}:.-]+(?:\/[A-Za-z0-9_{}:.-]+)*/g;
  const protectedText = text.replace(pathOrUrlPattern, (segment) => {
    const placeholder = `__SWAGGER_DOC_SEGMENT_${protectedSegments.length}__`;
    protectedSegments.push(segment);

    return placeholder;
  });

  return protectedText
    .replace(/\b[a-z][a-z0-9-]*\b/g, (word) => {
      const acronym = swaggerAcronymDocTerms.get(word);

      return acronym ?? word[0].toUpperCase() + word.slice(1);
    })
    .replace(
      /__SWAGGER_DOC_SEGMENT_(\d+)__/g,
      (_placeholder, index) => protectedSegments[Number(index)]
    );
}

// Function เขียน description บาง schema ใหม่ให้ Swagger ตรงกับ contract PascalCase
function transformDescriptionText(description: string): string {
  const replacedDescription = swaggerDescriptionReplacements.reduce(
    (nextDescription, [from, to]) => nextDescription.split(from).join(to),
    description
  );

  return capitalizeSwaggerEnglishTerms(replacedDescription);
}

// Function แปลงชื่อ property ใน OpenAPI schema เป็น PascalCase แบบ recursive สำหรับ docs
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

  if (typeof schema.summary === "string") {
    schema.summary = capitalizeSwaggerEnglishTerms(schema.summary);
  }

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
    if (
      key === "properties" ||
      key === "required" ||
      key === "example" ||
      key === "summary" ||
      key === "description"
    ) {
      continue;
    }

    transformSchemaKeys(value, seen);
  }
}

// Function สร้าง external open API spec สำหรับ Swagger/OpenAPI
function buildExternalOpenApiSpec(): Record<string, unknown> {
  const externalOpenapi = JSON.parse(JSON.stringify(openapi)) as Record<string, unknown>;
  transformSchemaKeys(externalOpenapi);

  return externalOpenapi;
}

const externalOpenapi = buildExternalOpenApiSpec();

// Function ตั้งค่า Swagger สำหรับ Swagger/OpenAPI
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
