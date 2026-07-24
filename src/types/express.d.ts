import type { AccessTokenPayload, SessionDto } from "./auth.type";
import type { DriverSessionDto } from "./driver.type";
import type { PublicGateClient } from "./gate-client.type";

declare global {
  namespace Express {
    // Type ส่วน Request extension: เพิ่ม auth/session หลัง middleware ตรวจสอบแล้ว
    interface Request {
      auth?: AccessTokenPayload;
      session?: SessionDto;
      driverSession?: DriverSessionDto;
      gateClient?: PublicGateClient;
      rawBody?: string;
    }
  }
}

export {};
