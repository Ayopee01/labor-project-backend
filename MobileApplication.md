# Mobile Application API Guide

เน€เธญเธเธชเธฒเธฃเธเธตเนเธชเธณเธซเธฃเธฑเธเธเธฑเนเธ Mobile Application เธเธญเธเธเธเธเธฒเธเน€เธ—เนเธฒเธเธฑเนเธ เนเธเน integrate API เนเธฅเธฐ WebSocket เธ—เธตเนเธเธเธเธฒเธเธเธ”เนเธเนเธเธฒเธเนเธเนเธญเธ

Base URL เธ•เธฑเธงเธญเธขเนเธฒเธ: `http://localhost:8080`

REST protected route เนเธซเนเธชเนเธ:

```http
Authorization: Bearer <access_token>
```

Worker dispatch เนเธเน WebSocket:

```txt
WS /ws/workers?token=<access_token>
```

WebSocket เนเธเนเธชเธณเธซเธฃเธฑเธเธฃเธฑเธเธเธฒเธเน€เธเนเธฒเน€เธเธฃเธทเนเธญเธเนเธเธ real-time เธชเนเธงเธ action เธ—เธตเนเน€เธเธฅเธตเนเธขเธเธเนเธญเธกเธนเธฅเธขเธฑเธเนเธเน REST เธ•เธฒเธกเน€เธ”เธดเธก

## Types

```ts
type ApiError = {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  validation_errors?: Array<{ field: string; message: string }>;
};

type Account = {
  id: number;
  username: string;
  role: "user" | string;
  status: "active" | "inactive" | string;
  full_name: string;
  position: string | null;
  permission_level: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

type WorkerProfile = {
  id: number;
  account_id: number;
  worker_code: string;
  image_url: string | null;
  nationality: string;
  nationality_code: string;
  nationality_name: string;
  work_start_date: string;
  phone: string;
  shirt_type: string | null;
  shirt_number: string | null;
};

type WorkSchedule = {
  id: number;
  account_id: number;
  work_date: string;
  shift_start_time: string;
  shift_end_time: string;
  is_current: boolean;
  shift_name: string;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

type WorkerQueueStatus = "ready" | "waiting" | "break" | "busy" | "offline" | string;

type WorkerQueueEntry = {
  id: number;
  account_id: number;
  status: WorkerQueueStatus;
  ready_at: string | null;
  break_until: string | null;
  break_count_used?: number;
  break_count_limit?: number;
  created_at: string;
  updated_at: string;
};

type WorkerPresence = {
  is_online: boolean;
  last_seen_at: string | null;
  stale_after_seconds: number;
};

type VehicleJobAssignment = {
  id: number;
  vehicle_job_id: number;
  worker_account_id: number;
  status: string;
  accept_deadline_at: string | null;
  scan_deadline_at: string | null;
  accepted_at: string | null;
  scanned_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type VehicleJob = {
  id: number;
  vehicle_job_ref: string;
  gate_transaction_ref: string;
  license_plate: string;
  vehicle_type: string | null;
  workers_required: number;
  status: string;
  worker_qr_token: string;
  created_at: string;
  updated_at: string;
};

type GateTicket = {
  id: number;
  vehicle_job_id: number;
  market_job_id: number;
  stall_job_ref: string;
  ticket_no: string | null;
  stall_no: string | null;
  status: string;
  confirmation_status: string;
  created_at: string;
  updated_at: string;
};

type TicketProduct = {
  id: number;
  ticket_id: number;
  product_type: string | null;
  name: string;
  quantity: string;
  confirmed_quantity: string | null;
  unit: string;
  created_at: string;
  updated_at: string;
};

type WorkerSocketEventType =
  | "WORKER_CONNECTED"
  | "WORKER_DISCONNECTED"
  | "WORKER_ASSIGNED"
  | "ASSIGNMENT_TIMEOUT"
  | "ASSIGNMENT_CANCELLED"
  | "ASSIGNMENT_ACCEPTED"
  | "WORKER_STATUS_CHANGED";

type WorkerSocketEvent<TPayload = Record<string, unknown>> = {
  type: WorkerSocketEventType;
  payload: TPayload;
  occurred_at: string;
};
```

## Auth

### Login

เนเธเนเธ•เธญเธเธเธเธเธฒเธ login เน€เธเนเธฒเนเธญเธ

`POST /api/auth/login`

```ts
type WorkerLoginRequest = {
  username: string;
  password: string;
  client_type: "worker_mobile";
  device_id: string;
  device_name: string;
};

type AuthSuccessResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  account: Account;
  profile: WorkerProfile | null;
  current_work_schedule: WorkSchedule | null;
};
```

เธเธฃเธ“เธตเธกเธต session เน€เธ”เธดเธกเธ—เธตเนเธญเธธเธเธเธฃเธ“เนเธญเธทเนเธ backend เธเธฐเธ•เธญเธ `409 ACTIVE_SESSION_EXISTS` เธเธฃเนเธญเธก `login_challenge_token` เนเธซเนเนเธญเธเนเธชเธ”เธ popup เธขเธทเธเธขเธฑเธ

### Confirm Force Login

เนเธเนเธซเธฅเธฑเธเธเธเธเธฒเธเธเธ”เธขเธทเธเธขเธฑเธเนเธซเนเธญเธธเธเธเธฃเธ“เนเน€เธเนเธฒ logout

`POST /api/auth/login/confirm-force`

```ts
type ConfirmForceLoginRequest = {
  login_challenge_token: string;
  device_id: string;
  device_name: string;
};
```

Response: `AuthSuccessResponse`

### Refresh Token

`POST /api/auth/refresh`

```ts
type RefreshRequest = {
  refresh_token: string;
};

type RefreshSuccessResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
};
```

### Current Account

เนเธเนเนเธซเธฅเธ”เธเนเธญเธกเธนเธฅเธเธเธเธฒเธเธเธฑเธเธเธธเธเธฑเธเธซเธฅเธฑเธเน€เธเธดเธ”เนเธญเธ เธซเธฃเธทเธญเธซเธฅเธฑเธ refresh token

`GET /api/auth/me`

### Logout

เนเธเนเธ•เธญเธเธเธเธเธฒเธเธญเธญเธเธเธฒเธเธฃเธฐเธเธ

`POST /api/auth/logout`

```ts
type ActionMessageResponse = {
  message: string;
};
```

## Worker WebSocket

### Connect

เธซเธฅเธฑเธ login เธชเธณเน€เธฃเนเธเนเธซเน Mobile เน€เธเธดเธ” WebSocket เน€เธเธทเนเธญเธฃเธญเธฃเธฑเธเธเธฒเธเธเธฒเธเธฃเธฐเธเธ dispatch

```txt
WS /ws/workers?token=<access_token>
```

Backend เธ•เธฃเธงเธ:
- access token valid
- role เธ•เนเธญเธเน€เธเนเธ `user`
- session เธ•เนเธญเธ active
- account เธ•เนเธญเธ active

### Events

```ts
type WorkerAssignedEvent = WorkerSocketEvent<{
  assignment: VehicleJobAssignment;
  vehicle_job?: VehicleJob;
  vehicle_job_id?: number;
  accept_deadline_at: string | null;
  source?: "admin_assign";
}>;

type AssignmentTimeoutEvent = WorkerSocketEvent<{
  assignment_id: number;
  vehicle_job_id: number;
}>;

type AssignmentCancelledEvent = WorkerSocketEvent<{
  assignment_id: number;
  vehicle_job_id: number;
  reason: string;
}>;

type WorkerStatusChangedEvent = WorkerSocketEvent<{
  queue?: WorkerQueueEntry | null;
  current_assignment?: VehicleJobAssignment | null;
  reason?: string;
}>;
```

เธเธฒเธฃ map UI:
- `WORKER_CONNECTED`: socket เธเธฃเนเธญเธกเนเธเนเธเธฒเธ
- `WORKER_ASSIGNED`: เนเธชเธ”เธเธซเธเนเธฒเธฃเธฑเธเธเธฒเธเธเธฃเนเธญเธก countdown เธเธฒเธ `accept_deadline_at`
- `ASSIGNMENT_TIMEOUT`: เธเธดเธ”เธซเธเนเธฒเธฃเธฑเธเธเธฒเธ เนเธฅเนเธง sync เธ”เนเธงเธข `GET /api/workers/me/status`
- `ASSIGNMENT_CANCELLED`: เธเธดเธ”/เธญเธฑเธเน€เธ”เธ•เธเธฒเธเธ—เธตเนเธ–เธนเธเธขเธเน€เธฅเธดเธ
- `ASSIGNMENT_ACCEPTED`: sync เธชเธ–เธฒเธเธฐเธซเธฅเธฑเธ REST accept เธชเธณเน€เธฃเนเธ
- `WORKER_STATUS_CHANGED`: เธญเธฑเธเน€เธ”เธ•เธเธธเนเธก online/offline/break เนเธฅเธฐเธชเธ–เธฒเธเธฐเธเธดเธง
- `TICKET_COMPLETION_SUBMITTED`: ticket ถูกส่งยอดแล้วและกำลังรอ vendor ตรวจ
- `TICKET_COMPLETION_RESULT`: vendor confirm/reject ยอดผ่าน LINE แล้ว
- `STALL_JOB_REOPENED`: admin reopen แผงให้ส่งยอดใหม่
- `ASSIGNMENT_SCAN_DEADLINE_EXTENDED`: admin ต่อเวลา scan ให้ worker
- `STALL_JOB_CANCELLED`: งานแผงถูกยกเลิก
- `MARKET_JOB_CANCELLED`: งานตลาดถูกยกเลิก
- `VEHICLE_JOB_CANCELLED`: งานรถถูกยกเลิก

Policy เธ•เธญเธ socket เธซเธฅเธธเธ”:
- เธ–เนเธฒ worker เธญเธขเธนเน `ready` เนเธฅเธฐเธขเธฑเธเนเธกเนเธกเธต assignment backend เธเธฐเธฃเธญ grace period เธชเธฑเนเธ เน เนเธฅเนเธงเน€เธเธฅเธตเนเธขเธเน€เธเนเธ `offline`
- เธ–เนเธฒ worker เธกเธต pending assignment backend เธเธฐเธฃเธญเธ–เธถเธ `accept_deadline_at`
- เธ–เนเธฒ reconnect เธเนเธญเธ deadline เนเธซเนเน€เธฃเธตเธขเธ `GET /api/workers/me/status` เนเธฅเนเธงเนเธชเธ”เธ assignment เน€เธ”เธดเธกเธเธฃเนเธญเธก countdown เน€เธงเธฅเธฒเธ—เธตเนเน€เธซเธฅเธทเธญ
- เธ–เนเธฒ accept เธชเธณเน€เธฃเนเธเนเธฅเนเธง socket เธซเธฅเธธเธ” เธเธฒเธเธขเธฑเธเธญเธขเธนเน เนเธซเน reconnect เนเธฅเนเธง sync เธเธฒเธ `GET /api/workers/me/status`

## Home Status
เธ–เนเธฒ WebSocket connected เธเธเธ•เธด backend เธเธฐเนเธเน socket ping/pong เธเนเธงเธขเธ•เธฃเธงเธ connection เธญเธขเธนเนเนเธฅเนเธง

### Get Worker Status

เนเธเนเธซเธเนเธฒ home/dashboard เธเธญเธเธเธเธเธฒเธ เนเธฅเธฐเนเธเน sync เธซเธฅเธฑเธ reconnect เธซเธฃเธทเธญเธซเธฅเธฑเธ event เธชเธณเธเธฑเธ

`GET /api/workers/me/status`

```ts
type WorkerStatusResponse = {
  queue: WorkerQueueEntry | null;
  current_assignment: VehicleJobAssignment | null;
  presence: WorkerPresence;
};
```

เธเธฒเธฃ map UI:
- `queue.status = ready`: เธเธฃเนเธญเธกเธฃเธฑเธเธเธฒเธ
- `queue.status = waiting`: เธฃเธญเน€เธเนเธฒเธเธดเธง เธขเธฑเธเนเธกเนเธฃเธฑเธเธเธฒเธ
- `queue.status = break`: เธญเธขเธนเนเธฃเธฐเธซเธงเนเธฒเธเธเธฑเธ เธ”เธนเน€เธงเธฅเธฒเธเธฒเธ `break_until`
- `queue.status = offline` เธซเธฃเธทเธญ `queue = null`: เธขเธฑเธเนเธกเนเธเธฃเนเธญเธกเธฃเธฑเธเธเธฒเธ
- `current_assignment != null`: เธกเธตเธเธฒเธเธ—เธตเนเธ•เนเธญเธเธเธ”เธฃเธฑเธ/เธเธณเธฅเธฑเธเธ—เธณเธญเธขเธนเน

## Queue Actions

### Go Online

เนเธเนเน€เธกเธทเนเธญเธเธเธเธฒเธเธเธ” โ€เธเธฃเนเธญเธกเธฃเธฑเธเธเธฒเธโ€

`POST /api/workers/me/online`

Response: `WorkerQueueEntry`

เน€เธเธทเนเธญเธเนเธ:
- account เธ•เนเธญเธ active
- เธ•เนเธญเธเธกเธต current work schedule
- เธ•เนเธญเธเธญเธขเธนเนเนเธเน€เธงเธฅเธฒเธเธญเธเธเธฐเธ•เธฑเธงเน€เธญเธ
- เธ•เนเธญเธเน€เธเธดเธ” WebSocket เธชเธณเน€เธฃเนเธเธเนเธญเธ เธ–เนเธฒเธขเธฑเธเนเธกเน connected backend เธเธฐเธ•เธญเธ `409 WORKER_SOCKET_NOT_CONNECTED`

### Go Offline

เนเธเนเน€เธกเธทเนเธญเธเธเธเธฒเธเธเธ” โ€เธญเธญเธเธเธฒเธ/เนเธกเนเธฃเธฑเธเธเธฒเธโ€

`POST /api/workers/me/offline`

Response: `WorkerQueueEntry`

### Take Break

เนเธเนเน€เธกเธทเนเธญเธเธเธเธฒเธเธเธ” โ€เธเธฑเธโ€

`POST /api/workers/me/break`

Response: `WorkerQueueEntry`

เธเธฒเธฃเธ—เธณเธเธฒเธ:
- เธฃเธฐเธขเธฐเน€เธงเธฅเธฒเธเธฑเธเธกเธฒเธเธฒเธ runtime setting `worker_break_duration_minutes`
- เธเธณเธเธงเธเธเธฃเธฑเนเธเธชเธนเธเธชเธธเธ”เธกเธฒเธเธฒเธ `worker_break_limit`
- เน€เธกเธทเนเธญเธเธฃเธเน€เธงเธฅเธฒเธเธฑเธ backend เธเธฐเธเธฅเธฑเธเนเธเน€เธเนเธฒเธเธดเธงเธ—เนเธฒเธขเธชเธธเธ”เนเธซเนเธญเธฑเธ•เนเธเธกเธฑเธ•เธด
- เธ–เนเธฒเนเธเนเธชเธดเธ—เธเธดเนเธเธฑเธเธเธฃเธเนเธฅเนเธง backend เธเธฐเธ•เธญเธ `409`

## Assignment Flow

### Accept Assignment

เน€เธกเธทเนเธญ backend เธเนเธฒเธขเธเธฒเธเนเธซเนเธเธเธเธฒเธ Mobile เธเธฐเนเธ”เนเธฃเธฑเธ `WORKER_ASSIGNED` เธเนเธฒเธ WebSocket เนเธฅเธฐ `GET /api/workers/me/status` เธเธฐเธกเธต `current_assignment`

เนเธซเนเนเธญเธเนเธเน `current_assignment.id` เนเธเธเธ”เธฃเธฑเธเธเธฒเธ

`POST /api/workers/me/assignments/{id}/accept`

Response: `VehicleJobAssignment`

เน€เธเธทเนเธญเธเนเธ:
- เธ•เนเธญเธเธเธ”เธฃเธฑเธเธ เธฒเธขเนเธ `accept_deadline_at`
- เธ–เนเธฒเนเธกเนเธเธ”เธ—เธฑเธเน€เธงเธฅเธฒ backend เธเธฐ timeout
- เธ–เนเธฒ socket เธซเธฅเธธเธ”เนเธ•เน reconnect เธเนเธญเธ deadline เนเธซเน sync status เนเธฅเนเธงเธเธ”เธฃเธฑเธเธเธฒเธเน€เธ”เธดเธกเนเธ”เน

### Check In QR

เธซเธฅเธฑเธเธฃเธฑเธเธเธฒเธเนเธฅเนเธง เธเธเธเธฒเธ scan QR เน€เธเธทเนเธญ check-in เน€เธเนเธฒเธเธฒเธ

`POST /api/workers/me/assignments/{id}/check-in-qr`

```ts
type WorkerCheckInQrRequest = {
  qr_token: string;
};
```

Response: `VehicleJobAssignment`

## Work History

เนเธเนเธ”เธนเธเธฃเธฐเธงเธฑเธ•เธดเธเธฒเธเธเธญเธเธ•เธฑเธงเน€เธญเธเธ•เธฒเธกเธงเธฑเธเธ—เธตเน

`GET /api/workers/me/assignments/history?date=2026-07-07`

```ts
type WorkerAssignmentHistoryResponse = {
  date: string;
  data: Array<{
    assignment: VehicleJobAssignment;
    vehicle_job: VehicleJob;
  }>;
};
```

`date` เธ•เนเธญเธเน€เธเนเธ `YYYY-MM-DD`

## Complete Ticket

เนเธเนเธ•เธญเธเธเธเธเธฒเธเธเธดเธ”เธเธฒเธเธฃเธฐเธ”เธฑเธเนเธเธ/เธ•เธฑเนเธง เนเธ”เธขเธชเนเธเธขเธญเธ”เธชเธดเธเธเนเธฒเธ—เธตเนเธเธฑเธเนเธ”เนเธเธฃเธดเธเธเธฅเธฑเธเนเธเนเธซเน backend

`POST /api/workers/me/tickets/{id}/complete`

`id` เธเธทเธญ `GateTicket.id`

```ts
type WorkerTicketCompleteRequest = {
  items: Array<{
    ticket_product_id: number;
    confirmed_quantity: number;
  }>;
};

type TicketCompletionResponse = {
  message: string;
  ticket: GateTicket;
  submission: {
    id: number;
    ticket_id: number;
    submitted_by_worker_account_id: number;
    status: string;
    confirmed_at: string | null;
    rejected_at: string | null;
    created_at: string;
    updated_at: string;
  };
  products: TicketProduct[];
};
```

เธเธฒเธฃ map UI:
- เนเธชเธ”เธเธฃเธฒเธขเธเธฒเธฃเธชเธดเธเธเนเธฒเธเธฒเธเธเนเธญเธกเธนเธฅ ticket/product เธ—เธตเนเนเธญเธเนเธ”เนเธฃเธฑเธเนเธ flow เธเธฒเธ
- `quantity` เธเธทเธญเธขเธญเธ”เธเธฒเธ Gate
- เธเธเธเธฒเธเธเธฃเธญเธ `confirmed_quantity`
- เธชเนเธเธ—เธธเธ product เนเธ ticket เน€เธเนเธฒ `items`
- เธ–เนเธฒเธขเธญเธ”เนเธกเนเธ•เธฃเธ เนเธซเนเธชเนเธเธเธณเธเธงเธเธเธฃเธดเธเธ—เธตเนเธเธเธเธฒเธเธเธฑเธเนเธ”เน เนเธกเนเธ•เนเธญเธเธชเนเธ note

## Error Handling

เธ—เธธเธ API error เนเธเนเธฃเธนเธเนเธเธเน€เธ”เธตเธขเธงเธเธฑเธ:

```ts
type ApiError = {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  validation_errors?: Array<{ field: string; message: string }>;
};
```

Frontend เธเธงเธฃ map เธเธฒเธ `code` เธกเธฒเธเธเธงเนเธฒ `message`

Code เธ—เธตเนเน€เธเธญเธเนเธญเธข:
- `VALIDATION_ERROR`: body/query เนเธกเนเธ–เธนเธเธ•เนเธญเธ
- `INVALID_TOKEN`: access token เนเธเนเนเธกเนเนเธ”เน
- `EXPIRED_TOKEN`: access token เธซเธกเธ”เธญเธฒเธขเธธ
- `ACTIVE_SESSION_EXISTS`: เธกเธต session เธญเธขเธนเนเนเธเธญเธธเธเธเธฃเธ“เนเธญเธทเนเธ
- `CLIENT_ROLE_NOT_ALLOWED`: login เธ”เนเธงเธข `client_type` เนเธกเนเธ•เธฃเธ role
- `WORKER_OUTSIDE_SHIFT`: เธเธ” online/break เธเธญเธเน€เธงเธฅเธฒเธเธฒเธ
- `WORKER_BREAK_LIMIT_REACHED`: เนเธเนเธชเธดเธ—เธเธดเนเธเธฑเธเธเธฃเธเนเธฅเนเธง
- `WORKER_SOCKET_NOT_CONNECTED`: เธขเธฑเธเนเธกเนเนเธ”เนเน€เธเธดเธ” WebSocket เนเธ•เนเธเธขเธฒเธขเธฒเธกเธเธ” online
- `SESSION_REVOKED`: session เธ–เธนเธ revoke เธซเธฃเธทเธญ login เธเนเธญเธเธเธฒเธเน€เธเธฃเธทเนเธญเธเธญเธทเนเธ
