import type { Response } from "express";
import type { AccessTokenPayload } from "./auth.type";

// Type ส่วนกลุ่มผู้รับ notification realtime
export type NotificationAudience = {
  account_ids?: number[];
  roles?: string[];
};

// Type ส่วน event ที่ส่งผ่าน SSE notification stream
export type RealtimeNotificationEvent = {
  type: string;
  title: string;
  message: string;
  payload?: unknown;
  audience?: NotificationAudience;
};

// Type ส่วน client ที่เชื่อมต่อ SSE notification stream
export type NotificationClient = {
  id: number;
  auth: AccessTokenPayload;
  response: Response;
  heartbeat: NodeJS.Timeout;
};
