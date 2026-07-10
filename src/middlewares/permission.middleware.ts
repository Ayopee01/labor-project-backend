// import Library
import type { NextFunction, Request, RequestHandler, Response } from "express";

// import Config
import type { AdminPermission } from "../config/permission.config";

// import Utils
import ApiError from "../utils/api-error";

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจสอบว่า access token มี permission ที่ route ต้องการหรือไม่
export default function permissionMiddleware(
  requiredPermissions: AdminPermission[]
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const permissions = req.auth?.permissions ?? [];
    const hasPermission = requiredPermissions.every((permission) =>
      permissions.includes(permission)
    );

    if (!hasPermission) {
      next(new ApiError(403, "FORBIDDEN", "Permission denied."));
      return;
    }

    next();
  };
}
