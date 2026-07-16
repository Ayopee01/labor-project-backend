import ApiError from "./api-error";

/* -------------------------------------- Constants -------------------------------------- */

export const WORKER_NATIONALITIES = ["Myanmar", "Cambodia"] as const;
export const WORKER_SHIRT_TYPES = ["Navy", "Blue", "Green"] as const;

type WorkerNationality = (typeof WORKER_NATIONALITIES)[number];
type WorkerShirtType = (typeof WORKER_SHIRT_TYPES)[number];

const WORKER_CODE_PREFIXES: Record<
  WorkerNationality,
  Record<WorkerShirtType, string>
> = {
  Myanmar: {
    Navy: "MN",
    Blue: "MB",
    Green: "MG",
  },
  Cambodia: {
    Navy: "CN",
    Blue: "CB",
    Green: "CG",
  },
};

interface BuildWorkerCodeInput {
  nationality: string;
  shirt_type: string;
  shirt_number: string;
}

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้างรหัสแรงงานจากสัญชาติ สีเสื้อ และเบอร์เสื้อ เช่น Myanmar + Navy + 4 -> MN000004
export function buildWorkerCode(input: BuildWorkerCodeInput): string {
  const nationality = input.nationality as WorkerNationality;
  const shirtType = input.shirt_type as WorkerShirtType;
  const prefix = WORKER_CODE_PREFIXES[nationality]?.[shirtType];
  const shirtNumber = input.shirt_number.trim();
  const numericShirtNumber = Number(shirtNumber);

  if (!prefix) {
    throw new ApiError(
      400,
      "INVALID_WORKER_CODE_PREFIX",
      "Worker code prefix requires nationality Myanmar/Cambodia and shirt_type Navy/Blue/Green."
    );
  }

  if (
    !/^\d+$/.test(shirtNumber) ||
    !Number.isInteger(numericShirtNumber) ||
    numericShirtNumber < 0 ||
    numericShirtNumber > 999999
  ) {
    throw new ApiError(
      400,
      "INVALID_SHIRT_NUMBER",
      "Shirt number must be a non-negative integer with at most 6 digits."
    );
  }

  return `${prefix}${String(numericShirtNumber).padStart(6, "0")}`;
}
