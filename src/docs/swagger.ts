import path from "path";
import type { Express, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";

/* -------------------------------------- Config -------------------------------------- */

// Config ไฟล์ OpenAPI ที่ generate ไว้สำหรับเปิดดู API docs
const openapiTestFile = path.resolve(
  process.cwd(),
  "src/docs/openapi-test/labor-management-openapi.yaml"
);

/* -------------------------------------- Functions -------------------------------------- */

// Function แสดง Swagger UI จากไฟล์ OpenAPI test ที่ generate ไว้แล้ว
export default function setupSwagger(app: Express): void {
  app.get("/api-docs/openapi.yaml", (_req: Request, res: Response) => {
    res.type("application/yaml");
    res.sendFile(openapiTestFile);
  });

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(null, {
      customSiteTitle: "Labor Management API Docs",
      swaggerOptions: {
        url: "/api-docs/openapi.yaml",
      },
    })
  );
}
