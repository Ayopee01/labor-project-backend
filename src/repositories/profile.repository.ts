// import Library
import { prisma } from "../db/prisma";

// import Mapper
import { mapProfile } from "./mapper";

// import Types
import type { DbConnection } from "../types/common.type";
import type { ProfileCreateInput, ProfileDto, ProfileUpdateInput } from "../types/users.type";

/* -------------------------------------- Types -------------------------------------- */

type ProfileDataInput = ProfileCreateInput | ProfileUpdateInput;

type ProfileData = {
  workerCode?: string;
  imageUrl?: string | null;
  nationality?: string;
  nationalityCode?: string;
  nationalityName?: string;
  workStartDate?: string;
  phone?: string;
  shirtType?: string | null;
  shirtNumber?: string | null;
};

type ProfileCreateData = {
  workerCode: string;
  imageUrl?: string | null;
  nationality: string;
  nationalityCode: string;
  nationalityName: string;
  workStartDate: string;
  phone: string;
  shirtType?: string | null;
  shirtNumber?: string | null;
};

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
function buildProfileData(profile: ProfileDataInput): ProfileData {
  const data: ProfileData = {};

  if (profile.worker_code !== undefined) {
    data.workerCode = profile.worker_code;
  }

  if (profile.image_url !== undefined) {
    data.imageUrl = profile.image_url;
  }

  if (profile.nationality !== undefined) {
    data.nationality = profile.nationality;
  }

  if (profile.nationality_code !== undefined) {
    data.nationalityCode = profile.nationality_code;
  }

  if (profile.nationality_name !== undefined) {
    data.nationalityName = profile.nationality_name;
  }

  if (profile.work_start_date !== undefined) {
    data.workStartDate = profile.work_start_date;
  }

  if (profile.phone !== undefined) {
    data.phone = profile.phone;
  }

  if (profile.shirt_type !== undefined) {
    data.shirtType = profile.shirt_type;
  }

  if (profile.shirt_number !== undefined) {
    data.shirtNumber = profile.shirt_number;
  }

  return data;
}

// Function สร้างข้อมูล profile แบบครบชุดสำหรับ create
function buildProfileCreateData(profile: ProfileCreateInput): ProfileCreateData {
  return {
    workerCode: profile.worker_code,
    imageUrl: profile.image_url,
    nationality: profile.nationality,
    nationalityCode: profile.nationality_code,
    nationalityName: profile.nationality_name,
    workStartDate: profile.work_start_date,
    phone: profile.phone,
    shirtType: profile.shirt_type,
    shirtNumber: profile.shirt_number,
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
      ...buildProfileCreateData(profile),
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
