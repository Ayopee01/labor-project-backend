// Type ส่วน event จาก LINE webhook postback
export type LineWebhookEvent = {
  type?: string;
  source?: {
    userId?: string;
  };
  postback?: {
    data?: string;
  };
};

// Type ส่วน job data สำหรับ queue ส่ง LINE message
export type LineMessageJobData = {
  log_id: number;
  to: string;
  messages: Array<{
    type: "text";
    text: string;
  }>;
};
