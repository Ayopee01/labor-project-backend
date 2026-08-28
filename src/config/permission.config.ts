/* -------------------------------------- Config -------------------------------------- */

// Permission config สำหรับ admin user
export const ADMIN_PERMISSIONS = [
  "settings:read",
  "settings:update",
  "roles:read",
  "admins:create",
  "admins:update",
  "admins:reset_password",
  "gate_clients:read",
  "gate_clients:create",
  "gate_clients:update",
  "gate_clients:rotate_secret",
  "permissions:read",
  "permissions:update",
  "workers:read",
  "workers:create",
  "workers:update",
  "workers:reset_password",
  "workers:force_status",
  "jobs:read",
  "jobs:assign",
  "jobs:cancel",
  "jobs:extend_deadline",
  "jobs:override_count",
  "jobs:wait",
  "jobs:release_workers",
  "mobile_app_versions:read",
  "mobile_app_versions:create",
  "mobile_app_versions:update",
] as const;

// Permission config สำหรับ admin user
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

// Config ระบุว่า permission ไหน "ต้องมี" permission อื่นควบคู่ไปด้วยเสมอ (เช่น create/update ของ
// resource หนึ่ง ต้องมาพร้อม read เสมอ เพราะไม่งั้นจะแก้ข้อมูลได้โดยไม่มีสิทธิ์ดูข้อมูลตัวเอง) — ใช้ตรวจ
// ตอน grant/replace permission set ทั้งฝั่ง createAdminAccount และ updateAdminUserPermissions ออก
// แบบเป็น map กลางแทนการ hardcode เฉพาะ mobile_app_versions เพื่อให้ resource กลุ่มอื่นในอนาคตประกาศ
// dependency แบบเดียวกันได้โดยไม่ต้องเขียน validation ใหม่
export const ADMIN_PERMISSION_DEPENDENCIES: Partial<
  Record<AdminPermission, readonly AdminPermission[]>
> = {
  "mobile_app_versions:create": ["mobile_app_versions:read"],
  "mobile_app_versions:update": ["mobile_app_versions:read"],
};

// Config permission ที่แก้ (grant หรือ revoke) ได้เฉพาะ actor ระดับ owner เท่านั้น แม้ actor เองจะมี
// permission นี้อยู่แล้วและมี permissions:update ก็ตาม — ใช้ร่วมกับ assertOwnerOnlyPermissionsUnchanged
// ใน admin-settings.service.ts ต่างจาก assertPermissionsGrantable เดิมที่เช็คแค่ "actor มี permission
// นี้อยู่แล้วหรือไม่" แต่ไม่เคยจำกัดว่าใครแก้กลุ่มนี้ได้บ้าง
export const OWNER_ONLY_PERMISSIONS: readonly AdminPermission[] = [
  "mobile_app_versions:read",
  "mobile_app_versions:create",
  "mobile_app_versions:update",
];

// Function ตรวจว่า Level admin
export const ADMIN_PERMISSION_LEVELS = [
  "owner",
  "manager",
  "supervisor",
] as const;

// Permission config สำหรับ admin user
export type AdminPermissionLevel = (typeof ADMIN_PERMISSION_LEVELS)[number];

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจว่า admin permission จาก config/env
export function isAdminPermission(value: string): value is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

// Function ตรวจว่า admin permission level จาก config/env
export function isAdminPermissionLevel(
  value?: string | null
): value is AdminPermissionLevel {
  return !!value && (ADMIN_PERMISSION_LEVELS as readonly string[]).includes(value);
}

// Function ดึง permission level order จาก config/env
export function getPermissionLevelOrder(permissionLevel?: string | null): number {
  return ADMIN_PERMISSION_LEVELS.findIndex((level) => level === permissionLevel);
}

// Function ตรวจว่า manage permission level จาก config/env
export function canManagePermissionLevel(
  actorLevel?: string | null,
  targetLevel?: string | null
): boolean {
  const actorOrder = getPermissionLevelOrder(actorLevel);
  const targetOrder = getPermissionLevelOrder(targetLevel);

  return actorOrder >= 0 && targetOrder >= 0 && actorOrder < targetOrder;
}
