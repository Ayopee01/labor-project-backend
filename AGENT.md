# AGENT.md

## Project Scope

This project is Backend only. Do not build frontend UI.

Build Phase 1 of a Backend Authentication API for a web application. The backend must expose APIs that the frontend can consume.

Use the existing project structure, ORM, database setup, and coding style. Do not introduce a new ORM if the project already has one.

Tech stack target:

- Node.js
- Express.js
- TypeScript
- JWT Authentication
- bcrypt for password hashing

---

## Core Rules

There are 2 main account types:

- `admin`
- `user` / worker

Both account types use the same authentication system.

Use centralized authentication. Do not duplicate authentication logic between admin and user.

Use `accounts.role` for role-based access control in Phase 1.

Do not implement `permission_level`-based API restrictions in Phase 1.

The system must support only 1 active device/session per account.

---

## Database Tables

Use only these 4 main tables for Phase 1:

1. `accounts`
2. `user_profiles`
3. `user_work_schedules`
4. `user_sessions`

Do not create these tables in Phase 1:

- `admin_profiles`
- `login_challenges`
- `roles`
- `permissions`
- `role_permissions`

Use a temporary JWT for `login_challenge_token` instead of a `login_challenges` table.

---

## accounts

Stores shared login/auth data for both admin and user.

Fields:

- `id`
- `username`
- `password_hash`
- `role`
- `status`
- `full_name`
- `position`
- `permission_level`
- `created_by`
- `created_at`
- `updated_at`

Rules:

- `username` must be unique.
- `password_hash` must never be returned in API responses.
- `role` supports `admin` and `user`.
- `status` supports `active` and `inactive`.
- `full_name` is used by both admin and user.
- `position` is only for `role = admin`; for user, set `position = null`.
- `permission_level` is only for `role = admin`; it supports `admin` and `staff`.
- If `role = user`, `permission_level = null`.
- Phase 1 authorization must use `accounts.role` only.

Example admin account:

```json
{
  "username": "admin01",
  "role": "admin",
  "status": "active",
  "full_name": "Admin",
  "position": "Manager",
  "permission_level": "admin"
}
```

Example staff account:

```json
{
  "username": "staff01",
  "role": "admin",
  "status": "active",
  "full_name": "Staff",
  "position": "Officer",
  "permission_level": "staff"
}
```

Example user account:

```json
{
  "username": "user01",
  "role": "user",
  "status": "active",
  "full_name": "Worker Name",
  "position": null,
  "permission_level": null
}
```

---

## user_profiles

Stores worker-specific profile data only.

Do not store `full_name` here because it is stored in `accounts`.

Fields:

- `id`
- `account_id`
- `worker_code`
- `nationality_code`
- `nationality_name`
- `work_start_date`
- `phone`
- `created_at`
- `updated_at`

Rules:

- `account_id` references `accounts.id`.
- `account_id` should be unique.
- `worker_code` must be unique.
- This table is only for accounts with `role = user`.
- Do not store schedule fields here.
- Do not store `shift_name`, `shift_start_time`, or `shift_end_time` here.

---

## user_work_schedules

Stores worker schedule data that admin can update over time.

Fields:

- `id`
- `account_id`
- `work_date`
- `shift_start_time`
- `shift_end_time`
- `is_current`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

Rules:

- `account_id` references `accounts.id` of the worker.
- `created_by` and `updated_by` reference `accounts.id` of the admin/staff.
- Frontend sends only `work_date`, `shift_start_time`, and `shift_end_time`.
- Frontend must not send `shift_name`.
- Backend must calculate `shift_name` from start and end time.
- Do not store `shift_name` in the database for Phase 1.
- Every schedule-related API response must include calculated `shift_name`.
- One user should have only one current schedule.
- When creating a new current schedule, set previous current records to `is_current = false` and the new record to `is_current = true`.

Shift name calculation:

- `06:00` to `18:00` = `กะเช้า`
- `18:00` to `06:00` = `กะกลางคืน`
- Any other time range = `กะกำหนดเอง`

Backend must support overnight shifts such as `18:00` to `06:00`.

---

## user_sessions

Stores sessions, refresh token hash, and device info.

Fields:

- `id`
- `account_id`
- `refresh_token_hash`
- `device_id`
- `device_name`
- `ip_address`
- `user_agent`
- `is_active`
- `last_active_at`
- `expires_at`
- `revoked_at`
- `created_at`
- `updated_at`

Rules:

- `account_id` references `accounts.id`.
- Store only hashed refresh tokens.
- Never store raw refresh tokens.
- Use this table to enforce one active device/session per account.
- Use this table to validate refresh token sessions.
- Logout must revoke the current session.
- Force login must revoke the old session.
- Reset password must revoke the user’s active session.
- Setting a user to inactive must revoke the user’s active session.
- Protected APIs must verify that the session is still active.

---

## Auth APIs

Implement:

- `POST /api/auth/login`
- `POST /api/auth/login/confirm-force`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Do not implement:

- `GET /api/auth/session`

Use `GET /api/auth/me` to check whether the access token and session are valid.

---

## Login

Endpoint:

```http
POST /api/auth/login
```

Request:

```json
{
  "username": "user01",
  "password": "123456",
  "device_id": "browser-device-id",
  "device_name": "Chrome on Windows"
}
```

Behavior:

- Verify username and password from `accounts`.
- Password must be hashed with bcrypt.
- Reject inactive accounts.
- If valid and no active session exists, create a new `user_sessions` record.
- Return `access_token`, `refresh_token`, `expires_in`, and account data.
- If `role = user`, also return profile and current work schedule if available.
- If no current work schedule exists, return `current_work_schedule = null`.

One-device rule:

- If an active session exists with the same `device_id`, allow login or safely replace the old session.
- If an active session exists with a different `device_id`, do not login immediately.
- Return HTTP `409` with code `ACTIVE_SESSION_EXISTS`.
- Return current active device info.
- Return a temporary `login_challenge_token`.

---

## Login Challenge Token

Do not create a `login_challenges` table.

Use `login_challenge_token` as a temporary JWT with short expiration, such as 3-5 minutes.

Payload:

- `account_id`
- `role`
- `old_session_id`
- `new_device_id`
- `token_type = "login_challenge"`

Rules:

- Backend must verify this token.
- Frontend may store it temporarily in `sessionStorage`.
- The token is only for confirm force login.
- Never trust frontend data without verifying the token.

---

## Confirm Force Login

Endpoint:

```http
POST /api/auth/login/confirm-force
```

Request:

```json
{
  "login_challenge_token": "temporary-jwt-token",
  "device_id": "browser-device-id",
  "device_name": "Chrome on Windows"
}
```

Behavior:

- Verify `login_challenge_token`.
- Check token is not expired.
- Check `token_type = login_challenge`.
- Check request `device_id` matches `new_device_id` in the token.
- Check `old_session_id` is still active.
- Check account is still active.
- Revoke the old active session.
- Create a new active session for the new device.
- Return `access_token`, `refresh_token`, `expires_in`, and account data.
- If `role = user`, also return profile and `current_work_schedule`.

---

## Token Rules

Use 2 token types:

- `access_token`
- `refresh_token`

Rules:

- `access_token` should be short-lived, for example 15 minutes.
- `refresh_token` should be longer-lived, for example 7 or 30 days.
- Do not store raw refresh tokens.
- Store only hashed refresh tokens.
- Validate refresh token against active session.
- Rotate refresh token on every refresh.
- On successful refresh, generate a new access token and refresh token.
- Update `refresh_token_hash` in `user_sessions`.

Access token payload:

- `account_id`
- `role`
- `session_id`
- `token_type = "access"`

Refresh token payload:

- `account_id`
- `session_id`
- `token_type = "refresh"`

Do not include `permission_level` in JWT payload for Phase 1.

---

## Refresh Token

Endpoint:

```http
POST /api/auth/refresh
```

Request:

```json
{
  "refresh_token": "..."
}
```

Behavior:

- Verify refresh token.
- Check `token_type = refresh`.
- Check session is active.
- Check account is active.
- Check refresh token has not expired.
- Rotate refresh token.
- Update `refresh_token_hash` in `user_sessions`.
- Return new `access_token` and new `refresh_token`.

---

## Logout

Endpoint:

```http
POST /api/auth/logout
```

Behavior:

- Use current token/session to logout.
- Revoke current active session.
- Make current refresh token unusable.
- Return success response.

---

## Current User

Endpoint:

```http
GET /api/auth/me
```

Behavior:

- Require `Authorization: Bearer <access_token>`.
- Verify access token.
- Check `token_type = access`.
- Check account exists and is active.
- Check session is still active.
- If token is invalid, expired, account inactive, or session revoked, return `401`.
- If valid, return account data.
- If `role = user`, return profile and `current_work_schedule`.
- `current_work_schedule` must include calculated `shift_name`.

Frontend behavior:

- Frontend should call this API on app load or page refresh.
- Frontend does not need a separate session-check API.
- Frontend should call protected APIs directly and handle `401` globally.

---

## Admin User APIs

Implement:

- `POST /api/admin/users`
- `GET /api/admin/users`
- `GET /api/admin/users/:id`
- `PATCH /api/admin/users/:id`
- `PATCH /api/admin/users/:id/password`
- `PATCH /api/admin/users/:id/status`
- `PATCH /api/admin/users/:id/work-schedule`
- `GET /api/admin/users/:id/work-schedule`
- `GET /api/admin/users/:id/work-schedules`

Permission for Phase 1:

- Only accounts with `role = admin` can access these APIs.
- Do not implement `permission_level`-based API restrictions yet.
- Do not create permission middleware for `permission_level` yet.
- Use `roleMiddleware(["admin"])` for admin routes.

---

## Create User

Endpoint:

```http
POST /api/admin/users
```

Request:

```json
{
  "username": "user01",
  "password": "123456",
  "full_name": "Worker Name",
  "profile": {
    "worker_code": "MNO00142",
    "nationality_code": "TH",
    "nationality_name": "ไทย",
    "work_start_date": "2024-07-15",
    "phone": "081-234-5678"
  },
  "work_schedule": {
    "work_date": "2026-07-01",
    "shift_start_time": "06:00",
    "shift_end_time": "18:00"
  }
}
```

Rules:

- `work_schedule` is optional.
- If `work_schedule` is not provided, create only account and profile.
- Frontend must not send `position` or `permission_level` for user creation.
- Backend must set `position = null` and `permission_level = null` for user accounts.

Behavior:

- Only `role = admin` can create user accounts.
- Create `accounts` record with `role = user` and `status = active`.
- Hash password before saving.
- Create related `user_profiles` record.
- If `work_schedule` exists, create `user_work_schedules` record.
- Calculate `shift_name` from start and end time.
- Return calculated `shift_name` if schedule exists.
- Set `created_by` to current admin account id.
- Prevent duplicate username.
- Prevent duplicate `worker_code`.
- Normal user must never create admin accounts.

---

## List Users

Endpoint:

```http
GET /api/admin/users?page=1&limit=20&search=MNO00142&status=active
```

Backend must handle pagination.

Defaults:

- `page = 1`
- `limit = 20`

Maximum:

- `limit <= 100`

Response should include:

- `data`
- `pagination.page`
- `pagination.limit`
- `pagination.total`
- `pagination.total_pages`

Each user item should include:

- `id`
- `username`
- `role`
- `status`
- `full_name`
- profile data
- `current_work_schedule` with calculated `shift_name`
- `created_at`
- `updated_at`

Never return `password_hash`.

---

## Get User Detail

Endpoint:

```http
GET /api/admin/users/:id
```

Response should include:

- account information
- `user_profiles` information
- `current_work_schedule` with calculated `shift_name`
- current active session information if available

Never return:

- `password_hash`
- `refresh_token_hash`
- sensitive data

---

## Update User

Endpoint:

```http
PATCH /api/admin/users/:id
```

Request:

```json
{
  "full_name": "Worker Name",
  "profile": {
    "worker_code": "MNO00142",
    "nationality_code": "TH",
    "nationality_name": "ไทย",
    "work_start_date": "2024-07-15",
    "phone": "081-234-5678"
  }
}
```

Behavior:

- Only `role = admin` can update users.
- Update `full_name` in `accounts`.
- Update worker profile in `user_profiles`.
- If `worker_code` is changed, ensure it is unique.
- Do not allow role update through this API.
- Do not allow `position` or `permission_level` update for user through this API.
- This API must not update work schedule.

---

## Reset User Password

Endpoint:

```http
PATCH /api/admin/users/:id/password
```

Request:

```json
{
  "new_password": "NewPassword@123456"
}
```

Behavior:

- Only `role = admin` can reset user password.
- Hash new password before saving.
- Revoke the user’s active session after password reset.

---

## Update User Status

Endpoint:

```http
PATCH /api/admin/users/:id/status
```

Request:

```json
{
  "status": "inactive"
}
```

Behavior:

- Only `role = admin` can update user status.
- `status` must be `active` or `inactive`.
- If status becomes `inactive`, revoke the user’s active session immediately.

---

## Update User Work Schedule

Endpoint:

```http
PATCH /api/admin/users/:id/work-schedule
```

Request:

```json
{
  "work_date": "2026-07-01",
  "shift_start_time": "06:00",
  "shift_end_time": "18:00"
}
```

Behavior:

- Only `role = admin` can update user schedule.
- Validate target account has `role = user`.
- Frontend sends only `work_date`, `shift_start_time`, and `shift_end_time`.
- Frontend must not send `shift_name`.
- Backend must calculate `shift_name`.
- Ensure only one current schedule per user.
- Set old current schedule to `is_current = false`.
- Set new schedule to `is_current = true`.
- Save `created_by` and `updated_by` as current admin account id.
- Return `shift_name`, `shift_start_time`, and `shift_end_time`.

---

## Get Current User Work Schedule

Endpoint:

```http
GET /api/admin/users/:id/work-schedule
```

If schedule exists, return schedule data with calculated `shift_name`.

If no current schedule exists:

```json
{
  "data": null
}
```

---

## Get User Work Schedule History

Endpoint:

```http
GET /api/admin/users/:id/work-schedules?page=1&limit=20
```

Backend must handle pagination.

Defaults:

- `page = 1`
- `limit = 20`

Maximum:

- `limit <= 100`

Return list with calculated `shift_name` for each item and pagination metadata.

---

## Pagination

For APIs returning lists/history, backend must handle pagination.

Affected APIs:

- `GET /api/admin/users`
- `GET /api/admin/users/:id/work-schedules`

Frontend sends:

- `page`
- `limit`

Backend must query only the requested page from the database.

Do not make frontend load all records and paginate locally.

---

## Middlewares

`authMiddleware`:

- Read Authorization Bearer token.
- Verify JWT.
- Check `token_type = access`.
- Attach account/session info to request.
- Reject expired or invalid tokens.

`roleMiddleware`:

- Accept allowed roles, for example `roleMiddleware(["admin"])`.
- Reject if account role is not allowed.

`sessionMiddleware`:

- Check session from token is still active.
- Reject revoked sessions with `401`.
- Update `last_active_at` when authenticated APIs are called.

Do not create permission middleware for `permission_level` in Phase 1.

---

## Error Handling

Use consistent error format:

```json
{
  "statusCode": 401,
  "code": "INVALID_TOKEN",
  "message": "Invalid or expired token."
}
```

Recommended error codes:

- `INVALID_CREDENTIALS`
- `ACCOUNT_INACTIVE`
- `INVALID_TOKEN`
- `TOKEN_EXPIRED`
- `INVALID_REFRESH_TOKEN`
- `ACTIVE_SESSION_EXISTS`
- `INVALID_LOGIN_CHALLENGE`
- `LOGIN_CHALLENGE_EXPIRED`
- `FORBIDDEN`
- `VALIDATION_ERROR`
- `USERNAME_ALREADY_EXISTS`
- `WORKER_CODE_ALREADY_EXISTS`
- `INVALID_SHIFT_TIME`
- `USER_NOT_FOUND`
- `SESSION_REVOKED`

HTTP status guidelines:

- `200` success
- `201` created
- `400` validation error / bad request
- `401` unauthenticated / invalid token
- `403` forbidden role
- `404` user not found
- `409` conflict
- `423` inactive/locked account
- `500` server error

---

## Validation

Validate every request body.

Validation examples:

- `username`: required, string, unique
- `password`: required, string, minimum length
- `full_name`: required, string
- `worker_code`: required, string, unique
- `nationality_code`: required, string
- `nationality_name`: required, string
- `work_start_date`: required, date format `YYYY-MM-DD`
- `phone`: required, string
- `work_date`: required, date format `YYYY-MM-DD`
- `shift_start_time`: required, time format `HH:mm`
- `shift_end_time`: required, time format `HH:mm`
- `status`: required, enum `active/inactive`
- `permission_level`: enum `admin/staff` only when `role = admin`

---

## Production Constraints / Indexes

`accounts`:

- `username UNIQUE`
- `role CHECK admin/user`
- `status CHECK active/inactive`
- `permission_level CHECK admin/staff/null`
- `created_by FK accounts.id nullable`

`user_profiles`:

- `account_id UNIQUE`
- `worker_code UNIQUE`
- `account_id FK accounts.id`

`user_work_schedules`:

- `account_id FK accounts.id`
- `created_by FK accounts.id`
- `updated_by FK accounts.id`
- index `account_id`
- index `work_date`
- index `is_current`
- Ensure one user has only one `is_current = true` record.

`user_sessions`:

- `account_id FK accounts.id`
- index `account_id`
- index `is_active`
- index `refresh_token_hash`
- Ensure one account has only one active session.

---

## Security

- Never store raw passwords.
- Never store raw refresh tokens.
- Use bcrypt for password hashing.
- Use environment variables for JWT secrets and expiration settings.
- Validate all request body inputs.
- Sanitize data where needed.
- Never return `password_hash`.
- Never return `refresh_token_hash`.
- Do not leak sensitive information in error messages.
- Use refresh token rotation.
- Revoke session on logout.
- Revoke old session on confirm force login.
- Revoke session on password reset.
- Revoke session when user becomes inactive.
- Update `last_active_at` on authenticated API calls.
- Use database transactions for critical flows.

---

## Seed Data

Create an initial admin account for development:

```text
username: admin
password: Admin@123456
role: admin
status: active
full_name: System Admin
position: Administrator
permission_level: admin
```

Password must be hashed before saving.

---

## Deliverables

Implement:

- Database schema/migrations
- Models/entities
- Routes
- Controllers
- Services
- Middlewares
- Validators
- JWT utilities
- Password hashing utilities
- Refresh token hashing utilities
- Login challenge temporary JWT utility
- Shift name calculation utility/service
- Seed initial admin
- Example `.env` file
- README/API documentation with request/response examples
- Basic error handling
- Basic tests if the project already has a testing setup
