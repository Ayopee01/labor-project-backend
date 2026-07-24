// Type ส่วน event จาก LINE webhook postback
export type LineWebhookEvent = {
  type?: string;
  source?: {
    userId?: string;
  };
  postback?: {
    data?: string;
  };
  message?: {
    text?: string;
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

export type VendorTicketAction =
  | "vendor_confirm_completion"
  | "vendor_reject_completion";

export interface VendorTicketActionTokenPayload {
  token_type: "vendor_ticket_action";
  action: VendorTicketAction;
  ticket_id: number;
  submission_id: number;
  boothCode: string;
  iat: number;
  exp: number;
}
