import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWorkerCodeFromShirtNumber } from "../../../src/utils/worker-code";

/* -------------------------------------- Worker Code Tests -------------------------------------- */

// Test ตรวจว่ารหัสแรงงานสร้างจากเบอร์เสื้อด้วย prefix MN และเติม 0 ให้ครบ 6 หลัก
test("buildWorkerCodeFromShirtNumber formats shirt number with MN prefix and six digits", () => {
  // Step Assert เบอร์เสื้อหลักเดียวและหลายหลักต้องถูกเติม 0 นำหน้าจนครบ 6 หลัก
  assert.equal(buildWorkerCodeFromShirtNumber("4"), "MN000004");
  assert.equal(buildWorkerCodeFromShirtNumber("130"), "MN000130");
});

// Test ตรวจว่าเบอร์เสื้อที่ไม่ใช่เลขจำนวนเต็มต้องถูก reject ก่อนใช้เป็น username/worker_code
test("buildWorkerCodeFromShirtNumber rejects non numeric shirt number", () => {
  // Step Assert ค่าเบอร์เสื้อที่ไม่ใช่เลขจำนวนเต็มต้อง throw error
  assert.throws(() => buildWorkerCodeFromShirtNumber("A4"), {
    name: "ApiError",
  });
});
