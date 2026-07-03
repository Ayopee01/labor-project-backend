// import Library
import { prisma } from "../db/prisma";

// import Mapper
import { mapProfile } from "./mapper";

// import Types
import type { DbConnection } from "../types/common.type";
import type { ProfileCreateInput, ProfileDto, ProfileUpdateInput } from "../types/users.type";

/* -------------------------------------- Types -------------------------------------- */

type ProfileDataInput = ProfileCreateInput | ProfileUpdateInput;

/* -------------------------------------- Functions -------------------------------------- */

// Function เลือก prisma client ปกติ หรือ transaction client ที่ส่งเข้ามา
function client(connection?: DbConnection): DbConnection {
  return connection ?? prisma;
}

// Function แปลง account id ให้เป็น number ก่อนส่งเข้า Prisma
function toAccountId(id: number | string): number {
  return Number(id);
}

// Function รวม field ของ profile เพื่อใช้ทั้ง create และ update
function buildProfileData(profile: ProfileDataInput) {
  return {
    workerCode: profile.worker_code,
    nationalityCode: profile.nationality_code,
    nationalityName: profile.nationality_name,
    workStartDate: profile.work_start_date,
    phone: profile.phone,
  };
}

// Function ตรวจสอบว่า Prisma คืน profile กลับมาหลัง create/update
function requireMappedProfile(
  profile: ProfileDto | null,
  action: string
): ProfileDto {
  if (!profile) {
    throw new Error(`Profile ${action} did not return a record.`);
  }

  return profile;
}

// Function ค้นหา profile จาก account id
export async function findByAccountId(
  accountId: number | string,
  connection?: DbConnection
): Promise<ProfileDto | null> {
  const db = client(connection);

  const profile = await db.userProfile.findUnique({
    where: {
      accountId: toAccountId(accountId),
    },
  });

  return mapProfile(profile);
}

// Function ตรวจสอบว่า worker code ถูกใช้แล้วหรือยัง
export async function workerCodeExists(
  workerCode: string,
  exceptAccountId?: number | string | null,
  connection?: DbConnection
): Promise<boolean> {
  const db = client(connection);

  const profile = await db.userProfile.findFirst({
    where: {
      workerCode,
      ...(exceptAccountId !== undefined &&
        exceptAccountId !== null && {
        accountId: {
          not: toAccountId(exceptAccountId),
        },
      }),
    },
    select: {
      id: true,
    },
  });

  return Boolean(profile);
}

// Function สร้าง profile ใหม่ใน table user_profiles
export async function create(
  profile: ProfileCreateInput,
  connection?: DbConnection
): Promise<ProfileDto> {
  const db = client(connection);

  const createdProfile = await db.userProfile.create({
    data: {
      accountId: toAccountId(profile.account_id),
      ...buildProfileData(profile),
    },
  });

  return requireMappedProfile(mapProfile(createdProfile), "create");
}

// Function แก้ไข profile จาก account id
export async function updateByAccountId(
  accountId: number | string,
  profile: ProfileUpdateInput,
  connection?: DbConnection
): Promise<ProfileDto> {
  const db = client(connection);

  const updatedProfile = await db.userProfile.update({
    where: {
      accountId: toAccountId(accountId),
    },
    data: buildProfileData(profile),
  });

  return requireMappedProfile(mapProfile(updatedProfile), "update");
}