export type NotificationLang = "TH" | "MN" | "CN" | "EN";

export type LocalizedNotification = {
  key: string;
  lang: NotificationLang;
  title: string;
  message: string;
};

type NotificationTemplate = {
  title: string;
  message: string;
};

type TemplateRenderer = (params: Record<string, unknown>) => NotificationTemplate;

const DEFAULT_LANG: NotificationLang = "TH";

const WORKER_NOTIFICATION_KEYS: Record<string, string> = {
  WORKER_ASSIGNED: "worker.assigned",
  ASSIGNMENT_TIMEOUT: "assignment.timeout",
  ASSIGNMENT_CANCELLED: "assignment.cancelled",
  ASSIGNMENT_SCAN_DEADLINE_EXTENDED: "assignment.scan_deadline_extended",
  ASSIGNMENT_SCAN_DEADLINE_SHORTENED: "assignment.scan_deadline_shortened",
  TICKET_COMPLETION_SUBMITTED: "ticket.completion_submitted",
  TICKET_COMPLETION_RESULT: "ticket.completion_result",
  STALL_JOB_CANCELLED: "job.stall_cancelled",
  MARKET_JOB_CANCELLED: "job.market_cancelled",
  VEHICLE_JOB_CANCELLED: "job.vehicle_cancelled",
  SESSION_REVOKED: "auth.session_revoked",
};

function text(value: unknown, fallback = "-"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberText(value: unknown, fallback = "-"): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return fallback;
}

function resolveTicketResultKey(params: Record<string, unknown>): string {
  const submissionStatus = String(params.submission_status ?? params.status ?? "").toUpperCase();

  if (submissionStatus === "COMPLETED") {
    return "ticket.completion_confirmed";
  }

  if (submissionStatus === "REJECT") {
    return "ticket.completion_rejected";
  }

  return "ticket.completion_result";
}

export function normalizeNotificationLang(value?: string | null): NotificationLang {
  const lang = String(value ?? "").trim().toUpperCase();

  if (lang === "TH" || lang === "MN" || lang === "CN" || lang === "EN") {
    return lang;
  }

  if (lang === "MY") {
    return "MN";
  }

  if (lang === "KM") {
    return "CN";
  }

  return DEFAULT_LANG;
}

export function resolveWorkerNotificationKey(
  type: string,
  params: Record<string, unknown> = {},
  explicitKey?: string | null,
): string {
  if (explicitKey) {
    return explicitKey;
  }

  if (type === "TICKET_COMPLETION_RESULT") {
    return resolveTicketResultKey(params);
  }

  return WORKER_NOTIFICATION_KEYS[type] ?? "worker.notification";
}

const TEMPLATES: Record<NotificationLang, Record<string, TemplateRenderer>> = {
  TH: {
    "worker.assigned": (params) => ({
      title: "มีงานใหม่",
      message: `คุณได้รับงานใหม่ Ticket ${text(params.ticketNo)} กรุณากดรับงาน`,
    }),
    "assignment.timeout": (params) => ({
      title: "หมดเวลางาน",
      message: `หมดเวลารับงานหรือสแกน QR สำหรับ Ticket ${text(params.ticketNo)}`,
    }),
    "assignment.cancelled": (params) => ({
      title: "งานถูกยกเลิก",
      message: `งาน Ticket ${text(params.ticketNo)} ถูกยกเลิก`,
    }),
    "assignment.scan_deadline_extended": (params) => ({
      title: "ต่อเวลาสแกน QR",
      message: `ต่อเวลาสแกน QR สำหรับ Ticket ${text(params.ticketNo)} แล้ว`,
    }),
    "assignment.scan_deadline_shortened": (params) => ({
      title: "เวลา Scan QR ถูกปรับ",
      message: `กรุณาสแกน QR ภายใน ${numberText(params.remaining_minutes)} นาที สำหรับ Ticket ${text(params.ticketNo)}`,
    }),
    "ticket.completion_submitted": (params) => ({
      title: "ส่งยอดงานแล้ว",
      message: `แผง ${text(params.boothCode)} ถูกส่งยอดแล้ว รอแผงค้ายืนยัน`,
    }),
    "ticket.completion_confirmed": (params) => ({
      title: "แผงค้ายืนยันยอดแล้ว",
      message: `แผง ${text(params.boothCode)} ยืนยันยอดเรียบร้อยแล้ว`,
    }),
    "ticket.completion_rejected": (params) => ({
      title: "แผงค้าตีกลับยอด",
      message: `แผง ${text(params.boothCode)} ตีกลับยอดงาน กรุณาตรวจสอบ`,
    }),
    "ticket.completion_result": (params) => ({
      title: "ผลยืนยันยอดอัปเดตแล้ว",
      message: `ผลยืนยันยอดของแผง ${text(params.boothCode)} อัปเดตแล้ว`,
    }),
    "job.stall_cancelled": (params) => ({
      title: "งานแผงถูกยกเลิก",
      message: `งานแผง ${text(params.boothCode)} ถูกยกเลิก`,
    }),
    "job.market_cancelled": (params) => ({
      title: "งานตลาดถูกยกเลิก",
      message: `งานตลาด ${text(params.marketCode)} ถูกยกเลิก`,
    }),
    "job.vehicle_cancelled": (params) => ({
      title: "งานรถถูกยกเลิก",
      message: `งาน Ticket ${text(params.ticketNo)} ถูกยกเลิก`,
    }),
    "auth.session_revoked": (params) => ({
      title: "บัญชีถูกเข้าสู่ระบบจากอุปกรณ์อื่น",
      message: `Session นี้ถูกออกจากระบบ เนื่องจากมีการยืนยันเข้าสู่ระบบจาก ${text(params.new_device_name, "อุปกรณ์อื่น")}`,
    }),
    "worker.notification": () => ({
      title: "แจ้งเตือนงาน",
      message: "มีแจ้งเตือนงานใหม่",
    }),
  },
  MN: {
    "worker.assigned": (params) => ({
      title: "အလုပ်အသစ် ရရှိပါသည်",
      message: `Ticket ${text(params.ticketNo)} အတွက် အလုပ်အသစ် ရရှိပါသည်။ လက်ခံပါ။`,
    }),
    "assignment.timeout": (params) => ({
      title: "အချိန်ကျော်လွန်သွားပါသည်",
      message: `Ticket ${text(params.ticketNo)} အတွက် အလုပ်လက်ခံရန် သို့မဟုတ် QR စကန်ရန် အချိန်ကျော်လွန်သွားပါသည်။`,
    }),
    "assignment.cancelled": (params) => ({
      title: "အလုပ်ကို ပယ်ဖျက်ပြီးပါပြီ",
      message: `Ticket ${text(params.ticketNo)} ကို ပယ်ဖျက်ပြီးပါပြီ။`,
    }),
    "assignment.scan_deadline_extended": (params) => ({
      title: "QR စကန်ချိန် တိုးပြီးပါပြီ",
      message: `Ticket ${text(params.ticketNo)} အတွက် QR စကန်ချိန် တိုးပြီးပါပြီ။`,
    }),
    "assignment.scan_deadline_shortened": (params) => ({
      title: "QR စကန်ချိန် ပြောင်းလဲပါသည်",
      message: `Ticket ${text(params.ticketNo)} အတွက် ${numberText(params.remaining_minutes)} မိနစ်အတွင်း QR စကန်ပါ။`,
    }),
    "ticket.completion_submitted": (params) => ({
      title: "အလုပ်ပမာဏ ပို့ပြီးပါပြီ",
      message: `ဆိုင်ခန်း ${text(params.boothCode)} ၏ အလုပ်ပမာဏ ပို့ပြီးပါပြီ။ အတည်ပြုချက် စောင့်နေပါသည်။`,
    }),
    "ticket.completion_confirmed": (params) => ({
      title: "ဆိုင်ခန်းမှ အတည်ပြုပြီးပါပြီ",
      message: `ဆိုင်ခန်း ${text(params.boothCode)} မှ အလုပ်ပမာဏကို အတည်ပြုပြီးပါပြီ။`,
    }),
    "ticket.completion_rejected": (params) => ({
      title: "ဆိုင်ခန်းမှ ပြန်ပို့ထားပါသည်",
      message: `ဆိုင်ခန်း ${text(params.boothCode)} မှ အလုပ်ပမာဏကို ပြန်ပို့ထားပါသည်။ စစ်ဆေးပါ။`,
    }),
    "ticket.completion_result": (params) => ({
      title: "အတည်ပြုရလဒ် ပြောင်းလဲပါသည်",
      message: `ဆိုင်ခန်း ${text(params.boothCode)} ၏ အတည်ပြုရလဒ် ပြောင်းလဲပါသည်။`,
    }),
    "job.stall_cancelled": (params) => ({
      title: "ဆိုင်ခန်းအလုပ် ပယ်ဖျက်ပြီးပါပြီ",
      message: `ဆိုင်ခန်း ${text(params.boothCode)} ၏ အလုပ်ကို ပယ်ဖျက်ပြီးပါပြီ။`,
    }),
    "job.market_cancelled": (params) => ({
      title: "ဈေးအလုပ် ပယ်ဖျက်ပြီးပါပြီ",
      message: `ဈေး ${text(params.marketCode)} ၏ အလုပ်ကို ပယ်ဖျက်ပြီးပါပြီ။`,
    }),
    "job.vehicle_cancelled": (params) => ({
      title: "ယာဉ်အလုပ် ပယ်ဖျက်ပြီးပါပြီ",
      message: `Ticket ${text(params.ticketNo)} ကို ပယ်ဖျက်ပြီးပါပြီ။`,
    }),
    "auth.session_revoked": (params) => ({
      title: "အကောင့်ကို အခြားစက်မှ ဝင်ရောက်ထားပါသည်",
      message: `${text(params.new_device_name, "အခြားစက်")} မှ ဝင်ရောက်မှုကို အတည်ပြုထားသောကြောင့် ဤ session မှ ထွက်ထားပါသည်။`,
    }),
    "worker.notification": () => ({
      title: "အလုပ်အသိပေးချက်",
      message: "အလုပ်အသိပေးချက် အသစ်ရှိပါသည်။",
    }),
  },
  CN: {
    "worker.assigned": (params) => ({
      title: "មានការងារថ្មី",
      message: `អ្នកទទួលបានការងារថ្មី Ticket ${text(params.ticketNo)} សូមចុចទទួលការងារ`,
    }),
    "assignment.timeout": (params) => ({
      title: "ផុតពេលការងារ",
      message: `ផុតពេលទទួលការងារ ឬ scan QR សម្រាប់ Ticket ${text(params.ticketNo)}`,
    }),
    "assignment.cancelled": (params) => ({
      title: "ការងារត្រូវបានលុបចោល",
      message: `ការងារ Ticket ${text(params.ticketNo)} ត្រូវបានលុបចោល`,
    }),
    "assignment.scan_deadline_extended": (params) => ({
      title: "បានបន្ថែមពេល scan QR",
      message: `បានបន្ថែមពេល scan QR សម្រាប់ Ticket ${text(params.ticketNo)}`,
    }),
    "assignment.scan_deadline_shortened": (params) => ({
      title: "ពេល Scan QR ត្រូវបានកែប្រែ",
      message: `សូម scan QR ក្នុងរយៈពេល ${numberText(params.remaining_minutes)} នាទី សម្រាប់ Ticket ${text(params.ticketNo)}`,
    }),
    "ticket.completion_submitted": (params) => ({
      title: "បានផ្ញើចំនួនការងារ",
      message: `តូប ${text(params.boothCode)} បានផ្ញើចំនួនការងារ ហើយកំពុងរង់ចាំការបញ្ជាក់`,
    }),
    "ticket.completion_confirmed": (params) => ({
      title: "តូបបានបញ្ជាក់ចំនួនហើយ",
      message: `តូប ${text(params.boothCode)} បានបញ្ជាក់ចំនួនការងាររួចរាល់`,
    }),
    "ticket.completion_rejected": (params) => ({
      title: "តូបបានបដិសេធចំនួន",
      message: `តូប ${text(params.boothCode)} បានបដិសេធចំនួនការងារ សូមពិនិត្យមើល`,
    }),
    "ticket.completion_result": (params) => ({
      title: "លទ្ធផលបញ្ជាក់បានធ្វើបច្ចុប្បន្នភាព",
      message: `លទ្ធផលបញ្ជាក់របស់តូប ${text(params.boothCode)} បានធ្វើបច្ចុប្បន្នភាព`,
    }),
    "job.stall_cancelled": (params) => ({
      title: "ការងារតូបត្រូវបានលុបចោល",
      message: `ការងារតូប ${text(params.boothCode)} ត្រូវបានលុបចោល`,
    }),
    "job.market_cancelled": (params) => ({
      title: "ការងារផ្សារត្រូវបានលុបចោល",
      message: `ការងារផ្សារ ${text(params.marketCode)} ត្រូវបានលុបចោល`,
    }),
    "job.vehicle_cancelled": (params) => ({
      title: "ការងាររថយន្តត្រូវបានលុបចោល",
      message: `ការងារ Ticket ${text(params.ticketNo)} ត្រូវបានលុបចោល`,
    }),
    "auth.session_revoked": (params) => ({
      title: "គណនីបានចូលពីឧបករណ៍ផ្សេង",
      message: `Session នេះត្រូវបានចេញ ព្រោះបានបញ្ជាក់ការចូលពី ${text(params.new_device_name, "ឧបករណ៍ផ្សេង")}`,
    }),
    "worker.notification": () => ({
      title: "ការជូនដំណឹងការងារ",
      message: "មានការជូនដំណឹងការងារថ្មី",
    }),
  },
  EN: {
    "worker.assigned": (params) => ({
      title: "New assignment",
      message: `You have a new assignment for ticket ${text(params.ticketNo)}. Please accept it.`,
    }),
    "assignment.timeout": (params) => ({
      title: "Assignment timed out",
      message: `The acceptance or QR scan deadline expired for ticket ${text(params.ticketNo)}.`,
    }),
    "assignment.cancelled": (params) => ({
      title: "Assignment cancelled",
      message: `Assignment ${text(params.ticketNo)} was cancelled.`,
    }),
    "assignment.scan_deadline_extended": (params) => ({
      title: "Scan deadline extended",
      message: `The QR scan deadline was extended for ticket ${text(params.ticketNo)}.`,
    }),
    "assignment.scan_deadline_shortened": (params) => ({
      title: "Scan deadline updated",
      message: `Please scan QR within ${numberText(params.remaining_minutes)} minutes for ticket ${text(params.ticketNo)}.`,
    }),
    "ticket.completion_submitted": (params) => ({
      title: "Ticket submitted",
      message: `Booth ${text(params.boothCode)} was submitted and is waiting for vendor confirmation.`,
    }),
    "ticket.completion_confirmed": (params) => ({
      title: "Vendor confirmed",
      message: `Booth ${text(params.boothCode)} has been confirmed.`,
    }),
    "ticket.completion_rejected": (params) => ({
      title: "Vendor rejected",
      message: `Booth ${text(params.boothCode)} was rejected. Please review it.`,
    }),
    "ticket.completion_result": (params) => ({
      title: "Ticket result updated",
      message: `The confirmation result for booth ${text(params.boothCode)} was updated.`,
    }),
    "job.stall_cancelled": (params) => ({
      title: "Stall job cancelled",
      message: `Stall job ${text(params.boothCode)} was cancelled.`,
    }),
    "job.market_cancelled": (params) => ({
      title: "Market job cancelled",
      message: `Market job ${text(params.marketCode)} was cancelled.`,
    }),
    "job.vehicle_cancelled": (params) => ({
      title: "Vehicle job cancelled",
      message: `Ticket ${text(params.ticketNo)} was cancelled.`,
    }),
    "auth.session_revoked": (params) => ({
      title: "Signed in on another device",
      message: `This session was signed out because login was confirmed on ${text(params.new_device_name, "another device")}.`,
    }),
    "worker.notification": () => ({
      title: "Worker notification",
      message: "A worker notification is available.",
    }),
  },
};

export function buildLocalizedNotification(input: {
  type: string;
  lang?: string | null;
  key?: string | null;
  params?: Record<string, unknown>;
  fallbackTitle?: string;
  fallbackMessage?: string;
}): LocalizedNotification {
  const lang = normalizeNotificationLang(input.lang);
  const key = resolveWorkerNotificationKey(input.type, input.params, input.key);
  const renderer = TEMPLATES[lang][key] ?? TEMPLATES[lang]["worker.notification"];
  const rendered = renderer(input.params ?? {});

  return {
    key,
    lang,
    title: rendered.title || input.fallbackTitle || TEMPLATES[lang]["worker.notification"]({}).title,
    message: rendered.message || input.fallbackMessage || TEMPLATES[lang]["worker.notification"]({}).message,
  };
}
