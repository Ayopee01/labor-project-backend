import fs from "fs/promises";
import path from "path";

// Config URL prefix คงที่ที่ auth.routes.ts คืนกลับไปให้ client (mount ตรงกับ app.ts) — แยกจาก
// physical directory ที่เขียนไฟล์จริงซึ่งมาจาก ADMIN_IMAGE_STORAGE_DIR (config ได้)
const ADMIN_IMAGE_URL_PREFIX = "/storage/admin-images/";

// Function ลบรูปโปรไฟล์ Admin เก่าออกจาก local disk ตอนอัปโหลดรูปใหม่ทับ (กันไฟล์กำพร้าสะสม) — คู่ขนาน
// กับ deleteAdminProfileImageByUrl ใน config/spaces.ts (Spaces) ที่พักไว้ชั่วคราวระหว่างยังไม่ deploy
// no-op เงียบๆ ถ้า url ไม่ใช่ path local ที่เพิ่งสร้างจากตัวนี้ (เช่น URL เก่าจาก Spaces)
export async function deleteAdminProfileImageLocal(url: string): Promise<void> {
  if (!url.startsWith(ADMIN_IMAGE_URL_PREFIX)) {
    return;
  }

  const storageDir = process.env.ADMIN_IMAGE_STORAGE_DIR ?? "./storage/admin-images";
  const filePath = path.join(storageDir, url.slice(ADMIN_IMAGE_URL_PREFIX.length));

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
