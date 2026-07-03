// import library
import argon2 from "argon2";

/* -------------------------------------- Config -------------------------------------- */

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
};

/* -------------------------------------- Functions -------------------------------------- */

// Function ตรวจสอบ password ก่อนนำไป hash หรือ verify
function assertPassword(password: string): void {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("Password must be a non-empty string.");
  }
}

// Function ตรวจสอบ password กับ hash ที่เก็บใน database
export async function hashPassword(password: string): Promise<string> {
  assertPassword(password);

  return argon2.hash(password, ARGON2_OPTIONS);
}

// Function ตรวจสอบ password กับ hash ที่เก็บใน database
export async function verifyPassword(
  password: string,
  passwordHash: string | null | undefined
): Promise<boolean> {
  assertPassword(password);

  if (typeof passwordHash !== "string" || passwordHash.length === 0) {
    return false;
  }

  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}
