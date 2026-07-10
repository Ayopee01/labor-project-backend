# Admin Web API Guide

เน€เธญเธเธชเธฒเธฃเธเธตเนเธชเธฃเธธเธ API เธ—เธตเนเธเธฑเนเธ Admin Web เธ•เนเธญเธเนเธเนเธชเธณเธซเธฃเธฑเธ integrate เธเธฑเธ backend เนเธ”เธขเธญเธดเธเธเธฒเธ route เธเธฑเธเธเธธเธเธฑเธเนเธฅเธฐ Swagger tag: Auth, Admin Workers, Admin Jobs, Admin Settings, Admin Realtime, Gate

Base URL เธ•เธฑเธงเธญเธขเนเธฒเธ: `http://localhost:8080`

เธ—เธธเธ protected route เนเธซเนเธชเนเธ header:

```http
Authorization: Bearer <access_token>
```

## Types

```ts
type AccountRole = "admin" | "user" | string;
type AccountStatus = "active" | "inactive" | string;
type AdminPermissionLevel = "super_admin" | "admin" | "supervisor";
type AdminPermission =
  | "settings:read"
  | "settings:update"
  | "roles:read"
  | "permissions:read"
  | "permissions:update"
  | "workers:read"
  | "workers:create"
  | "workers:update"
  | "workers:reset_password"
  | "workers:force_status"
  | "jobs:read"
  | "jobs:assign"
  | "jobs:cancel"
  | "jobs:reopen"
  | "jobs:extend_deadline";

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
  role: AccountRole;
  status: AccountStatus;
  full_name: string;
  position: string | null;
  permission_level: AdminPermissionLevel | null;
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

type UserDetailResponse = {
  account: Account;
  profile: WorkerProfile | null;
  current_work_schedule: WorkSchedule | null;
  active_session: {
    id: number;
    device_id: string;
    device_name: string;
    last_active_at: string;
  } | null;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
};

type VehicleJob = {
  id: number;
  vehicle_job_ref: string;
  gate_transaction_ref: string;
  license_plate: string;
  vehicle_type: string | null;
  workers_required: number;
  status: string;
  driver_qr_token: string;
  worker_qr_token: string;
  created_at: string;
  updated_at: string;
};

type MarketJob = {
  id: number;
  vehicle_job_id: number;
  market_job_ref: string;
  market_name: string;
  status: string;
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
  vendor_name: string | null;
  vendor_line_id: string | null;
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

type VehicleJobDetailResponse = {
  vehicle_job: VehicleJob;
  markets: Array<MarketJob & {
    tickets: Array<GateTicket & { products: TicketProduct[] }>;
  }>;
};

type WorkerQueueEntry = {
  id: number;
  account_id: number;
  status: "ready" | "waiting" | "break" | "busy" | "offline" | string;
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
```

## Auth

### Login Admin Web

เนเธเนเธ•เธญเธเธซเธเนเธฒ login เธเธญเธ Admin Web

`POST /api/auth/login`

```ts
type LoginRequest = {
  username: string;
  password: string;
  client_type: "admin_web";
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

เธ–เนเธฒ username เธเธตเนเธกเธต session เน€เธ”เธดเธกเธญเธขเธนเนเน€เธเธฃเธทเนเธญเธเธญเธทเนเธ เธเธฐเนเธ”เน `409 ACTIVE_SESSION_EXISTS` เธเธฃเนเธญเธก `login_challenge_token` เนเธซเน UI เธ–เธฒเธกเธขเธทเธเธขเธฑเธ

### Confirm Force Login

เนเธเนเธซเธฅเธฑเธ admin เธเธ”เธขเธทเธเธขเธฑเธเนเธซเน logout เน€เธเธฃเธทเนเธญเธเน€เธเนเธฒ

`POST /api/auth/login/confirm-force`

```ts
type ConfirmForceLoginRequest = {
  login_challenge_token: string;
  device_id?: string;
  device_name?: string;
};
```

Response เน€เธซเธกเธทเธญเธ `AuthSuccessResponse`

### Refresh Token

`POST /api/auth/refresh`

```ts
type RefreshRequest = { refresh_token: string };
type RefreshSuccessResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
};
```

### Current Admin

เนเธเนเน€เธเนเธ session เธ•เธญเธเน€เธเธดเธ”เน€เธงเนเธ/refresh page

`GET /api/auth/me`

Response เน€เธเนเธเธเนเธญเธกเธนเธฅ account/profile/schedule เธเธฑเธเธเธธเธเธฑเธ

### Logout

`POST /api/auth/logout`

Response:

```ts
type ActionMessageResponse = { message: string };
```

## Admin Workers

### Create Worker

เนเธเนเธซเธเนเธฒเธชเธฃเนเธฒเธเธเธเธเธฒเธ เธฃเธญเธเธฃเธฑเธเธ—เธฑเนเธ JSON เนเธฅเธฐ `multipart/form-data`

`POST /api/admin/users`

เนเธเธเนเธเธฐเธเธณเน€เธกเธทเนเธญเธกเธตเธฃเธนเธ:

```ts
type CreateWorkerFormData = {
  image?: File;
  full_name: string;
  phone: string;
  nationality: string;
  nationality_code?: string;
  nationality_name?: string;
  shirt_type: string;
  shirt_number: string;
  work_date: string;
  shift_start_time: string;
  shift_end_time: string;
  password?: string;
  status?: "active" | "inactive";
};
```

เธ–เนเธฒเนเธกเนเธชเนเธ `password` backend เนเธเนเธเนเธฒ default เธ•เธฒเธก phone/username เธ•เธฒเธก logic backend

Response:

```ts
type ActionMessageResponse = { message: string };
```

### List Workers

เนเธเนเธซเธเนเธฒ table เธฃเธฒเธขเธเธทเนเธญเธเธเธเธฒเธ

`GET /api/admin/users?page=1&limit=20&search=&status=`

```ts
type UserListResponse = {
  data: Array<{
    id: number;
    username: string;
    role: string;
    status: string;
    full_name: string;
    profile: WorkerProfile | null;
    current_work_schedule: WorkSchedule | null;
    created_at: string;
    updated_at: string;
  }>;
  pagination: Pagination;
};
```

### Get Worker Detail

เนเธเนเธซเธเนเธฒ detail/edit worker

`GET /api/admin/users/{id}`

Response: `UserDetailResponse`

### Update Worker

เนเธเนเนเธเนเธเนเธญเธกเธนเธฅ worker เน€เธเธเธฒเธฐ field เธ—เธตเนเน€เธเธฅเธตเนเธขเธ

`PATCH /api/admin/users/{id}`

```ts
type UpdateWorkerRequest = {
  full_name?: string;
  status?: "active" | "inactive";
  profile?: Partial<{
    worker_code: string;
    image_url: string;
    nationality: string;
    nationality_code: string;
    nationality_name: string;
    work_start_date: string;
    phone: string;
    shirt_type: string;
    shirt_number: string;
  }>;
  work_schedule?: {
    work_date: string;
    shift_start_time: string;
    shift_end_time: string;
  };
};
```

Response: `UserDetailResponse`

เธซเธกเธฒเธขเน€เธซเธ•เธธ: เธ–เนเธฒเธชเนเธ `work_schedule` เธเธฐ update schedule เธเธฑเธเธเธธเธเธฑเธ เนเธกเนเน€เธเนเธ history เน€เธเนเธฒ

### Reset Worker Password

`PATCH /api/admin/users/{id}/password`

```ts
type ResetPasswordRequest = { new_password: string };
```

Response: `{ message: string }`

### Worker Work Schedule

`GET /api/admin/users/{id}/work-schedules?page=1&limit=20`

Response:

```ts
type WorkScheduleListResponse = {
  data: WorkSchedule[];
  pagination: Pagination;
};
```

### Worker Status Dashboard

เนเธเนเธซเธเนเธฒเธ•เธดเธ”เธ•เธฒเธก worker เธ—เธฑเนเธเธซเธกเธ”

`GET /api/admin/users/worker-status`

```ts
type AdminWorkerStatusListResponse = {
  summary: {
    total: number;
    ready: number;
    waiting: number;
    break: number;
    busy: number;
    offline: number;
    alive: number;
    stale: number;
  };
  data: Array<{
    worker: Account;
    queue: WorkerQueueEntry | null;
    current_assignment: VehicleJobAssignment | null;
    presence: WorkerPresence;
  }>;
};
```

เธ”เธนเธฃเธฒเธขเธเธ:

`GET /api/admin/users/worker-status/{id}`

### Force Worker Status

เนเธเนเน€เธกเธทเนเธญ worker เธ•เธดเธ”เธ•เนเธญ admin เนเธซเนเนเธเนเธชเธ–เธฒเธเธฐเนเธ—เธ

`POST /api/admin/users/{id}/worker-status/force`

```ts
type ForceWorkerStatusRequest = {
  status: "ready" | "waiting" | "offline" | "break";
  reason?: string;
};
```

เธชเธ–เธฒเธเธฐ:
- `ready`: เน€เธเนเธฒเธเธดเธงเธเธฃเนเธญเธกเธฃเธฑเธเธเธฒเธ
- `waiting`: เธฃเธญเน€เธเนเธฒเธเธดเธง เธขเธฑเธเนเธกเนเนเธซเนเธฃเธฐเธเธเธเนเธฒเธขเธเธฒเธ
- `break`: เธเธฑเธ เนเธเน quota break เนเธฅเธฐเธเธฅเธฑเธเน€เธเนเธฒเธเธดเธงเธ—เนเธฒเธขเธชเธธเธ”เน€เธกเธทเนเธญเธเธฃเธเน€เธงเธฅเธฒ
- `offline`: เธญเธญเธเธเธฒเธเธเธฒเธ/เนเธกเนเธฃเธฑเธเธเธฒเธ

## Admin Jobs

### List Vehicle Jobs

เนเธเนเธซเธเนเธฒ job list/search/history

`GET /api/admin/vehicle-jobs?date=2026-07-07&page=1&limit=20&search=&status=`

เธ–เนเธฒเนเธกเนเธชเนเธ `page` backend เธเธฐเธเธทเธเธ—เธฑเนเธเธซเธกเธ”เธ•เธฒเธก filter เนเธฅเธฐเน€เธฃเธตเธขเธเธฅเนเธฒเธชเธธเธ”

```ts
type AdminVehicleJobListResponse = {
  data: VehicleJob[];
  pagination: Pagination | null;
};
```

### Get Vehicle Job Detail

เนเธเนเธซเธเนเธฒ detail เธเธฒเธเธฃเธ– เน€เธเธทเนเธญเน€เธซเนเธเธ•เธฅเธฒเธ” เนเธเธ เธชเธดเธเธเนเธฒ เนเธฅเธฐ worker assignments เธ—เธตเนเน€เธเธตเนเธขเธงเธเนเธญเธเนเธ UI

`GET /api/admin/vehicle-jobs/{id}`

Response: `VehicleJobDetailResponse`

### Cancel Vehicle Job

เธขเธเน€เธฅเธดเธเธ—เธฑเนเธเธฃเธ– เนเธกเนเน€เธญเธฒ worker เธเธฅเธฑเธเน€เธเนเธฒเธเธดเธง

`POST /api/admin/vehicle-jobs/{id}/cancel`

```ts
type CancelRequest = { reason?: string };
```

### Cancel Vehicle Job And Requeue

เธขเธเน€เธฅเธดเธเธ—เธฑเนเธเธฃเธ– เนเธฅเธฐเน€เธญเธฒ worker เธ—เธตเนเนเธ”เธเธขเธเน€เธฅเธดเธเธเธฅเธฑเธเธ—เนเธฒเธขเธเธดเธง

`POST /api/admin/vehicle-jobs/{id}/cancel-and-requeue`

Response เธกเธต `requeued_worker_account_ids: number[]`

### Assign Workers Manually

Admin เน€เธฅเธทเธญเธเธเธเธเธฒเธเนเธซเนเธฃเธ–เน€เธญเธ

`POST /api/admin/vehicle-jobs/{id}/assign-workers`

```ts
type AssignWorkersRequest = {
  worker_account_ids: number[];
};
```

Response:

```ts
type AssignWorkersResponse = {
  message: string;
  assignments: VehicleJobAssignment[];
};
```

### Extend Scan Deadline

เธ•เนเธญเน€เธงเธฅเธฒเนเธซเน worker scan QR เนเธ”เนเธ—เธฑเนเธเธฃเธ–เธซเธฃเธทเธญเธฃเธฒเธขเธเธธเธเธเธฅ

`POST /api/admin/vehicle-jobs/{id}/scan-deadline/extend`

```ts
type ExtendScanDeadlineRequest = {
  minutes: number;
  worker_account_ids?: number[];
  reason?: string;
};
```

เธ–เนเธฒเนเธกเนเธชเนเธ `worker_account_ids` เธเธทเธญ extend เนเธซเนเธ—เธธเธเธเธเนเธ vehicle job เธ—เธตเนเน€เธเธตเนเธขเธงเธเนเธญเธ

### Cancel One Assignment

เธขเธเน€เธฅเธดเธเธเธฒเธเธฃเธฒเธขเธเธธเธเธเธฅ เนเธกเน auto เน€เธ•เธดเธกเธเธเธเธฒเธเธเธดเธง

`POST /api/admin/assignments/{id}/cancel`

Body: `{ reason?: string }`

### Cancel Market Job

เธขเธเน€เธฅเธดเธเธฃเธฐเธ”เธฑเธเธ•เธฅเธฒเธ”เนเธฅเธฐเนเธเธเนเธ•เนเธ•เธฅเธฒเธ”เธเธฑเนเธ

`POST /api/admin/market-jobs/{id}/cancel`

### Cancel Stall Job

เธขเธเน€เธฅเธดเธเธฃเธฐเธ”เธฑเธเนเธเธ/เธ•เธฑเนเธง

`POST /api/admin/stall-jobs/{id}/cancel`

### Reopen Stall Job

เนเธเนเน€เธกเธทเนเธญ vendor confirm เธเธดเธ” เธ•เนเธญเธเน€เธเธดเธ”เนเธเธเนเธซเน worker เธชเนเธเธขเธญเธ”เนเธซเธกเน

`POST /api/admin/stall-jobs/{id}/reopen`

`id` เธเธทเธญ `GateTicket.id` เธฃเธฐเธ”เธฑเธเนเธเธ

## Admin Settings

### Runtime Settings

`GET /api/admin/settings`

```ts
type RuntimeSettings = {
  driver_session_ttl_hours: number;
  worker_accept_deadline_seconds: number;
  worker_scan_deadline_minutes: number;
  worker_break_duration_minutes: number;
  worker_break_limit: number;
  worker_break_count_ttl_hours: number;
  worker_presence_stale_seconds: number;
};
```

เนเธเนเธเนเธฒ:

`PATCH /api/admin/settings`

เธชเนเธ partial เนเธ”เนเธญเธขเนเธฒเธเธเนเธญเธข 1 field:

```ts
type UpdateRuntimeSettingsRequest = Partial<RuntimeSettings>;
```

### Permission Levels

`GET /api/admin/roles`

```ts
type AdminRoleListResponse = {
  data: Array<{
    key: AdminPermissionLevel;
    name: string;
    order: number;
  }>;
};
```

`order` เธเนเธญเธขเธเธงเนเธฒ = เธขเธจเธชเธนเธเธเธงเนเธฒ

### Get Admin Permissions

`GET /api/admin/users/{id}/permissions`

```ts
type AdminUserPermissionsResponse = {
  account_id: number;
  role: string;
  permission_level: AdminPermissionLevel | null;
  permissions: AdminPermission[];
};
```

### Update Admin Permissions

`PATCH /api/admin/users/{id}/permissions`

```ts
type UpdateAdminUserPermissionsRequest = {
  permission_level: AdminPermissionLevel;
  permissions: AdminPermission[];
};
```

เน€เธเธทเนเธญเธเนเธ:
- เธเธนเนเนเธเนเธ•เนเธญเธเธกเธต `permissions:update`
- เธเธนเนเนเธเนเธ•เนเธญเธเธกเธตเธขเธจเธชเธนเธเธเธงเนเธฒ target
- เธเธนเนเนเธเนเธ•เนเธญเธเธกเธตเธขเธจเธชเธนเธเธเธงเนเธฒ `permission_level` เนเธซเธกเน
- เนเธเนเธ•เธฑเธงเน€เธญเธเนเธกเนเนเธ”เน
- เธซเธฅเธฑเธเนเธเน backend revoke session เธเธญเธ target เนเธซเน login เนเธซเธกเนเน€เธเธทเนเธญเธฃเธฑเธ permission เธฅเนเธฒเธชเธธเธ”

## Gate Mock For Admin/Test

เนเธเนเธเธณเธฅเธญเธเธเนเธญเธกเธนเธฅเธเธฒเธ Gate เน€เธเธทเนเธญเธชเธฃเนเธฒเธเธเธฒเธเธฃเธ–

`POST /api/gate/vehicle-jobs`

```ts
type GateVehicleJobRequest = {
  gate_transaction_ref: string;
  vehicle_job_ref: string;
  license_plate: string;
  vehicle_type?: string;
  workers_required: number;
  markets: Array<{
    market_job_ref: string;
    market_name: string;
    tickets: Array<{
      stall_job_ref: string;
      ticket_no?: string;
      stall_no?: string;
      vendor_name?: string;
      vendor_line_id?: string;
      products: Array<{
        product_type?: string;
        name: string;
        quantity: number;
        unit: string;
      }>;
    }>;
  }>;
};
```

Response: `VehicleJobDetailResponse` เธเธฃเนเธญเธก `qr.driver_qr_token` เนเธฅเธฐ `qr.worker_qr_token`

## Admin Realtime SSE

เนเธเนเธฃเธฑเธ realtime status/event เธชเธณเธซเธฃเธฑเธเธซเธเนเธฒ admin

`GET /api/admin/events`

เน€เธเนเธ `text/event-stream` เนเธกเนเนเธเน JSON list

```ts
type AdminRealtimeEvent = {
  type: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  occurred_at: string;
};
```

เธ•เธฑเธงเธญเธขเนเธฒเธ frontend:

```ts
const events = new EventSource(`${baseUrl}/api/admin/events`, {
  withCredentials: false,
});

events.addEventListener("TICKET_COMPLETION_RESULT", (event) => {
  const data = JSON.parse((event as MessageEvent).data) as AdminRealtimeEvent;
});
```

เธ–เนเธฒ client เนเธเน `EventSource` เธชเนเธ header Authorization เนเธกเนเธชเธฐเธ”เธงเธ เนเธซเนเธ•เธเธฅเธเธงเธดเธเธตเธชเนเธ token เธเธฑเธ frontend framework เธ—เธตเนเนเธเน เน€เธเนเธ fetch-event-source เธซเธฃเธทเธญ SSE polyfill เธ—เธตเน set headers เนเธ”เน
