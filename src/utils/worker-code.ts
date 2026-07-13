import ApiError from "./api-error";

/* -------------------------------------- Functions -------------------------------------- */

// Function สร้างรหัสแรงงานจากเบอร์เสื้อ โดยเติม 0 นำหน้าให้ครบ 6 หลัก เช่น 4 -> MN000004
export function buildWorkerCodeFromShirtNumber(shirtNumber: string): string {
  const numericShirtNumber = Number(shirtNumber);

  if (!Number.isInteger(numericShirtNumber) || numericShirtNumber < 0) {
    throw new ApiError(
      400,
      "INVALID_SHIRT_NUMBER",
      "Shirt number must be a non-negative integer."
    );
  }

  return `MN${String(numericShirtNumber).padStart(6, "0")}`;
}
