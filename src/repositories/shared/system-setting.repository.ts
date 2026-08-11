import { client } from "./repository-utils";

import type { DbConnection } from "../../types/shared/common.type";
import type { SystemSettingDto } from "../../types/admin-settings.type";

/* -------------------------------------- Functions -------------------------------------- */

function mapSystemSetting(record: {
  key: string;
  value: string;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}): SystemSettingDto {
  return {
    key: record.key,
    value: record.value,
    updated_by: record.updatedBy,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export async function listSettings(
  connection?: DbConnection
): Promise<SystemSettingDto[]> {
  const db = client(connection);
  const settings = await db.systemSetting.findMany({
    orderBy: {
      key: "asc",
    },
  });

  return settings.map(mapSystemSetting);
}

export async function upsertSettings(
  settings: Record<string, string>,
  updatedBy?: number | null,
  connection?: DbConnection
): Promise<void> {
  const db = client(connection);

  for (const [key, value] of Object.entries(settings)) {
    await db.systemSetting.upsert({
      where: {
        key,
      },
      update: {
        value,
        updatedBy: updatedBy ?? null,
      },
      create: {
        key,
        value,
        updatedBy: updatedBy ?? null,
      },
    });
  }
}
