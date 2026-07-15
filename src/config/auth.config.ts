// Config หน่วยเวลาเทียบเป็นวินาทีสำหรับแปลง duration ของ token
const TIME_UNIT_SECONDS = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
} as const;

// Type ส่วนหน่วยเวลา duration ที่ auth config รองรับ
type DurationUnit = keyof typeof TIME_UNIT_SECONDS;

// Format ตัวเลขตามด้วยหน่วยเวลา ถ้าไม่ใส่หน่วยจะถือว่าเป็นวินาที
const DURATION_PATTERN = /^(\d+)([smhd])?$/;

// Config ค่า default ของ token และ session ในระบบ auth
export const AUTH_DEFAULTS = {
  accessTokenExpiresIn: "15m",
  accessTokenExpiresInSeconds: 15 * TIME_UNIT_SECONDS.m,
  refreshTokenExpiresIn: "7d",
  loginChallengeExpiresIn: "5m",
  sessionExpiresInMilliseconds: 7 * TIME_UNIT_SECONDS.d * 1000,
} as const;

// Function แปลงค่าเวลาเป็นวินาทีสำหรับ config ของ auth
function parseDurationSeconds(
  value: string | number | undefined,
  fallbackSeconds: number
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value !== "string") {
    return fallbackSeconds;
  }

  const match = value.trim().match(DURATION_PATTERN);

  if (!match) {
    return fallbackSeconds;
  }

  const durationAmount = Number(match[1]);
  const durationUnit = (match[2] || "s") as DurationUnit;

  return durationAmount * TIME_UNIT_SECONDS[durationUnit];
}

// Function อ่านอายุ access token จาก env และ fallback เป็นค่า default
export function getAccessTokenExpiresInSeconds(): number {
  return parseDurationSeconds(
    process.env.JWT_ACCESS_EXPIRES_IN,
    AUTH_DEFAULTS.accessTokenExpiresInSeconds
  );
}
