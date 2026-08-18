/* -------------------------------------- Config -------------------------------------- */

// Permission config สำหรับ admin user
export const ADMIN_PERMISSIONS = [
  "settings:read",
  "settings:update",
  "roles:read",
  "admins:create",
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
] as const;

// Permission config สำหรับ admin user
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

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
