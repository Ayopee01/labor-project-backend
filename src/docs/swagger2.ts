import type { Express, Request, Response } from "express";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

/* -------------------------------------- Functions -------------------------------------- */

// Function เรียง tag ของ Swagger โดยให้ System แสดงก่อน แล้วตามด้วย Auth และ Admin Users
function sortSwaggerTags(firstTag: string, secondTag: string): number {
  const tagOrder: Record<string, number> = {
    System: 0,
    Auth: 1,
    "Admin Users": 2,
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
    "get /": 0,
    "get /health": 1,
    "post /api/auth/login": 10,
    "post /api/auth/login/confirm-force": 11,
    "post /api/auth/refresh": 12,
    "post /api/auth/logout": 13,
    "get /api/auth/me": 14,
    "post /api/admin/users": 20,
    "get /api/admin/users": 21,
    "get /api/admin/users/{id}": 22,
    "patch /api/admin/users/{id}": 23,
    "delete /api/admin/users/{id}": 24,
    "patch /api/admin/users/{id}/password": 25,
    "patch /api/admin/users/{id}/status": 26,
    "patch /api/admin/users/{id}/work-schedule": 27,
    "get /api/admin/users/{id}/work-schedule": 28,
    "get /api/admin/users/{id}/work-schedules": 29,
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
  apis: ["./src/docs/openapi/**/*.yaml"],
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
