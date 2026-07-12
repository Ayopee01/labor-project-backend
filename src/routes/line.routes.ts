// import Library
import express from "express";
// import Service
import * as lineService from "../services/line.service";

const router = express.Router();

// Route รับ LINE webhook จาก vendor สำหรับ confirm/reject งาน
router.post(
  "/webhook",
  async (req, res, next) => {
    try {
      const result = await lineService.handleLineWebhook(
        req.body,
        req.headers["x-line-signature"],
        req.rawBody
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
