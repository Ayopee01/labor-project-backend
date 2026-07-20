/* -------------------------------------- Config -------------------------------------- */

// Config รายการ permission ที่ระบบรองรับสำหรับ Admin Web
export const ADMIN_PERMISSIONS = [
  "settings:read",
  "settings:update",
  "roles:read",
  "admins:create",
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
] as const;

// Type permission ที่ระบบรองรับจาก ADMIN_PERMISSIONS
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

// Config ลำดับยศของ admin โดย index น้อยกว่าคือยศสูงกว่า
export const ADMIN_PERMISSION_LEVELS = [
  "owner",
  "manager",
  "supervisor",
] as const;

// Type level ของ admin จาก ADMIN_PERMISSION_LEVELS
export type AdminPermissionLevel = (typeof ADMIN_PERMISSION_LEVELS)[number];

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจว่า string เป็น permission ที่ระบบรองรับหรือไม่
export function isAdminPermission(value: string): value is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

// Function ตรวจว่า string เป็น permission level ที่ระบบรองรับหรือไม่
export function isAdminPermissionLevel(
  value?: string | null
): value is AdminPermissionLevel {
  return !!value && (ADMIN_PERMISSION_LEVELS as readonly string[]).includes(value);
}

// Function ดึงลำดับยศจาก ADMIN_PERMISSION_LEVELS โดย -1 คือไม่รู้จักยศนี้
export function getPermissionLevelOrder(permissionLevel?: string | null): number {
  return ADMIN_PERMISSION_LEVELS.findIndex((level) => level === permissionLevel);
}

// Function ตรวจว่า actor สามารถจัดการ target level ได้หรือไม่
export function canManagePermissionLevel(
  actorLevel?: string | null,
  targetLevel?: string | null
): boolean {
  const actorOrder = getPermissionLevelOrder(actorLevel);
  const targetOrder = getPermissionLevelOrder(targetLevel);

  return actorOrder >= 0 && targetOrder >= 0 && actorOrder < targetOrder;
}
