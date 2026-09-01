import fs from "fs";
import path from "path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/utils/password";

/**
 * Source:
 * [LMSDB].[dbo].[LaborMaster] joined with a Card-side record, exported to docs/worker.csv.
 *
 * File shape (see docs/worker.md #15-#17):
 * - Line 1 is a title line ("[LMSDB].[dbo].[LaborMaster] ,,,..."), NOT the header.
 * - Line 2 is the real header. It has duplicate column names (LaborCode, Nationality,
 *   CreateDate, CreateBy, UpdateDate, UpdateBy) because LaborMaster (left) was joined with a
 *   second Card-side record set (right) that happens to share those column names.
 * - A LaborId can appear on more than one row because a worker can have more than one Card
 *   (LaborCardId differs) — MasterWorker must still end up 1 row per LaborId.
 *
 * Field mapping (left = LaborMaster columns, right = joined Card columns):
 * - Left:  LaborId, LaborCode, LaborStatus, Prefix, Name, WorkStartDate, Telephone,
 *          Nationality, LaborColor, LaborCoat, CoatNo, TimeWork, TimeIn, TimeOut, UpdateDate
 * - Right: Status, FullName, WorkCode, Picture
 *
 * Known data-quality issues in the current export (verified against the real file, not assumed):
 * - UpdateDate (left) is "###############" (Excel column-too-narrow marker) on every row — always
 *   seeded as null, never guessed.
 * - Picture is present on 242/245 rows but every non-empty value is exactly 32,767 characters
 *   (the old Excel/CSV cell length cap) with an odd hex-digit count, i.e. truncated mid-byte and
 *   not valid binary on any row — always seeded as null rather than importing corrupt bytes.
 * Both are still parsed generically below (not hardcoded to null) in case a future export fixes
 * the source data.
 */

const CSV_PATH = path.join(__dirname, "..", "docs", "worker.csv");

const LEFT = 0;
const RIGHT = 1;

interface MasterWorkerSeedRecord {
  laborId: number;
  laborCode: string;
  laborCardId: number;
  prefix: string | null;
  name: string | null;
  fullName: string | null;
  laborStatus: string | null;
  status: number | null;
  workCode: number | null;
  nationality: string | null;
  telephone: string | null;
  workStartDate: Date | null;
  laborColor: string | null;
  laborCoat: string | null;
  coatNo: string | null;
  timeWork: string | null;
  timeIn: string | null;
  timeOut: string | null;
  picture: Uint8Array<ArrayBuffer> | null;
  updateDate: Date | null;
}

/* -------------------------------------- Parsing helpers -------------------------------------- */

// Function จัดการ trim + คืน null แทน empty string จาก field ดิบ
function nullableText(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";

  return trimmed.length > 0 ? trimmed : null;
}

// Function parse จำนวนเต็มจาก field ดิบ, empty/invalid -> null
function nullableInt(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? "";

  if (trimmed.length === 0 || !/^-?\d+$/.test(trimmed)) {
    return null;
  }

  return Number.parseInt(trimmed, 10);
}

// Function parse วันที่รูปแบบ Master D/M/YYYY (ไม่มีเลขศูนย์นำหน้า) -> Date, parse ไม่ได้ -> null
function parseMasterDate(value: string | undefined): Date | null {
  const trimmed = value?.trim() ?? "";
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);

  if (!match) {
    return null;
  }

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

// Function parse UpdateDate ของ Master (timestamp เต็มรูปแบบ) — export ปัจจุบันเป็น "#####..."
// (Excel ตัดคอลัมน์) ทุกแถว จึงต้อง null เสมอ ไม่เดาเอาเอง แต่ยังลอง parse จริงไว้เผื่อ export ในอนาคต
// แก้ปัญหานี้แล้วมีค่าจริงมาให้
function parseMasterUpdateDate(value: string | undefined): Date | null {
  const trimmed = value?.trim() ?? "";

  if (trimmed.length === 0 || /[^0-9:./\-\s]/.test(trimmed)) {
    return null;
  }

  const parsed = new Date(trimmed.replace(" ", "T"));

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Function ดึงเฉพาะเวลา HH:mm จาก field TimeIn/TimeOut ของ Master ที่มีวันที่ dummy ติดมาด้วย (เช่น
// "2026-01-01 06:00:00.000") — ห้ามผูก business logic กับส่วนวันที่ตามข้อ 30 ของ worker.md
function extractTimeOfDay(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  const match = /(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(trimmed);

  if (!match) {
    return null;
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

// Function ตรวจ+แปลง Picture hex ("0x...") เป็น Buffer — ต้อง even-length hex ที่สมบูรณ์เท่านั้น
// ข้อมูลที่ถูกตัดทิ้งกลางคัน (เช่น odd hex-digit count) ต้องได้ null ไม่ใช่ error ตามข้อ 12 ของ worker.md
function parsePicture(value: string | undefined): Uint8Array<ArrayBuffer> | null {
  const trimmed = value?.trim() ?? "";

  if (trimmed.length === 0) {
    return null;
  }

  const hex = trimmed.toLowerCase().startsWith("0x") ? trimmed.slice(2) : trimmed;

  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  // @types/node augments the global Uint8Array to default its ArrayBuffer type parameter to
  // ArrayBufferLike, so a plain `new Uint8Array(n)` no longer structurally matches Prisma's
  // generated Bytes type (Uint8Array<ArrayBuffer>) under this project's TS 6 setup.
  return bytes as Uint8Array<ArrayBuffer>;
}

/* -------------------------------------- CSV loading -------------------------------------- */

// Function หา index ของแต่ละชื่อ column ใน header (เก็บทุก occurrence เพราะไฟล์นี้มีชื่อ column ซ้ำ
// จากการ join LaborMaster กับ Card record — ดู docs/worker.md ข้อ 16)
function buildColumnIndex(header: string[]): Map<string, number[]> {
  const index = new Map<string, number[]>();

  header.forEach((name, position) => {
    const trimmedName = name.trim();
    const existing = index.get(trimmedName) ?? [];

    existing.push(position);
    index.set(trimmedName, existing);
  });

  return index;
}

// Function อ่าน worker.csv ดิบ คืนเป็น { columnIndex, dataRows } — ข้าม title line (บรรทัดแรก) แล้วใช้
// บรรทัดที่สองเป็น header จริงตามโครงสร้างไฟล์จริง (ห้าม hard-code ว่าบรรทัดแรกคือ header)
function readWorkerCsv(): { columnIndex: Map<string, number[]>; dataRows: string[][] } {
  const raw = fs.readFileSync(CSV_PATH, "utf-8").replace(/^﻿/, "");
  const lines = raw.split("\n").map((line) => line.replace(/\r$/, ""));
  const [, headerLine, ...dataLines] = lines;

  if (!headerLine) {
    throw new Error(`Unexpected worker.csv structure: missing header line at ${CSV_PATH}`);
  }

  const columnIndex = buildColumnIndex(headerLine.split(","));
  const dataRows = dataLines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(","));

  return { columnIndex, dataRows };
}

// Function ดึงค่า field จาก row ดิบ ตามชื่อ column + occurrence (0 = ฝั่งซ้าย/LaborMaster, 1 = ฝั่ง
// ขวา/Card) ตาม mapping ของ worker.md ข้อ 16
function getField(
  columnIndex: Map<string, number[]>,
  row: string[],
  name: string,
  occurrence: 0 | 1 = LEFT
): string | undefined {
  const positions = columnIndex.get(name);
  const position = positions?.[occurrence] ?? positions?.[positions.length - 1];

  return position === undefined ? undefined : row[position];
}

/* -------------------------------------- Transform + dedupe -------------------------------------- */

// Function แปลง row ดิบหนึ่งแถวเป็น MasterWorkerSeedRecord ตาม field mapping ของ worker.md ข้อ 3/16
function transformRow(
  columnIndex: Map<string, number[]>,
  row: string[]
): MasterWorkerSeedRecord | null {
  const laborId = nullableInt(getField(columnIndex, row, "LaborId"));
  const laborCode = nullableText(getField(columnIndex, row, "LaborCode", LEFT));
  const laborCardId = nullableInt(getField(columnIndex, row, "LaborCardId")) ?? 0;

  if (laborId === null || laborCode === null) {
    return null;
  }

  return {
    laborId,
    laborCode,
    laborCardId,
    prefix: nullableText(getField(columnIndex, row, "Prefix")),
    name: nullableText(getField(columnIndex, row, "Name")),
    fullName: nullableText(getField(columnIndex, row, "FullName", RIGHT)),
    laborStatus: nullableText(getField(columnIndex, row, "LaborStatus")),
    status: nullableInt(getField(columnIndex, row, "Status", RIGHT)),
    workCode: nullableInt(getField(columnIndex, row, "WorkCode", RIGHT)),
    nationality: nullableText(getField(columnIndex, row, "Nationality", LEFT)),
    telephone: nullableText(getField(columnIndex, row, "Telephone")),
    workStartDate: parseMasterDate(getField(columnIndex, row, "WorkStartDate")),
    laborColor: nullableText(getField(columnIndex, row, "LaborColor")),
    laborCoat: nullableText(getField(columnIndex, row, "LaborCoat")),
    coatNo: nullableText(getField(columnIndex, row, "CoatNo")),
    timeWork: nullableText(getField(columnIndex, row, "TimeWork")),
    timeIn: extractTimeOfDay(getField(columnIndex, row, "TimeIn")),
    timeOut: extractTimeOfDay(getField(columnIndex, row, "TimeOut")),
    picture: parsePicture(getField(columnIndex, row, "Picture", RIGHT)),
    updateDate: parseMasterUpdateDate(getField(columnIndex, row, "UpdateDate", LEFT)),
  };
}

// Function dedupe worker ตาม LaborId — 1 LaborId ต้องเหลือ 1 MasterWorker เท่านั้น (ดู worker.md ข้อ
// 17) เลือกแถวที่ LaborCardId น้อยที่สุดเพื่อให้ผล deterministic ไม่ว่าจะรันกี่ครั้ง/ลำดับแถวใน CSV
// เปลี่ยนหรือไม่
function dedupeByLaborId(records: MasterWorkerSeedRecord[]): MasterWorkerSeedRecord[] {
  const byLaborId = new Map<number, MasterWorkerSeedRecord>();

  for (const record of records) {
    const existing = byLaborId.get(record.laborId);

    if (!existing || record.laborCardId < existing.laborCardId) {
      byLaborId.set(record.laborId, record);
    }
  }

  return [...byLaborId.values()].sort((a, b) => a.laborId - b.laborId);
}

/* -------------------------------------- Seed entrypoint -------------------------------------- */

// Function seed ข้อมูล master_workers จาก docs/worker.csv ลง DB — dev/test เท่านั้น ตามข้อ 25 ของ
// worker.md ห้ามให้ runtime การทำงานจริงพึ่งพาไฟล์นี้
export async function seedMasterWorkers(prisma: PrismaClient): Promise<void> {
  const { columnIndex, dataRows } = readWorkerCsv();
  const parsedRows = dataRows
    .map((row) => transformRow(columnIndex, row))
    .filter((record): record is MasterWorkerSeedRecord => record !== null);
  const workers = dedupeByLaborId(parsedRows);

  const inputs: Prisma.MasterWorkerUpsertArgs[] = await Promise.all(
    workers.map(async (worker) => {
      const passwordHash = worker.telephone ? await hashPassword(worker.telephone) : null;
      const data: Prisma.MasterWorkerUncheckedCreateInput = {
        laborId: worker.laborId,
        laborCode: worker.laborCode,
        prefix: worker.prefix,
        name: worker.name,
        fullName: worker.fullName,
        laborStatus: worker.laborStatus,
        status: worker.status,
        workCode: worker.workCode,
        nationality: worker.nationality,
        telephone: worker.telephone,
        workStartDate: worker.workStartDate,
        laborColor: worker.laborColor,
        laborCoat: worker.laborCoat,
        coatNo: worker.coatNo,
        timeWork: worker.timeWork,
        timeIn: worker.timeIn,
        timeOut: worker.timeOut,
        picture: worker.picture,
        updateDate: worker.updateDate,
        source: "master_sync",
        passwordHash,
      };

      return {
        where: { laborId: worker.laborId },
        update: data,
        create: data,
      };
    })
  );

  await prisma.$transaction(inputs.map((input) => prisma.masterWorker.upsert(input)));

  console.log(
    `Seeded ${workers.length} master_workers records (from ${dataRows.length} CSV rows).`
  );
}
