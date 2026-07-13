# Postman WebSocket Setup

Postman import from `postman_collection.json` treats `ws://` entries as HTTP GET requests, so create the Worker WebSocket request manually in Postman and save it from the WebSocket tab.

## Create Request

1. Login Worker from the REST collection:

```json
{
  "username": "MN000012",
  "password": "0812345678",
  "device_id": "{{deviceId}}",
  "device_name": "{{deviceName}}"
}
```

2. Copy the returned `access_token`.

3. In Postman, click `New` > `WebSocket`.

4. Use this URL:

```text
ws://localhost:8080/ws/workers?token=<access_token>
```

5. Click `Connect`.

6. Save the request into a new collection named `Labor Project Backend - WebSocket`.

## Expected First Message

```json
{
  "type": "WORKER_CONNECTED",
  "payload": {
    "account_id": 1
  },
  "occurred_at": "2026-07-13T00:00:00.000Z"
}
```

After this message appears, call `POST /api/workers/me/online` from the REST collection.

## Expected Assignment Message

When a job is dispatched to the worker, Postman receives:

```json
{
  "type": "WORKER_ASSIGNED",
  "payload": {
    "vehicle_job_ref": "VEH-20260706-0003",
    "gate_transaction_ref": "GATE-REQ-003",
    "worker_qr_token": "worker_qr_xxx",
    "assignment": {
      "created_at": "2026-07-13T10:04:49.609Z",
      "accept_deadline_at": "2026-07-13T10:05:49.608Z"
    }
  },
  "occurred_at": "2026-07-13T10:04:49.615Z"
}
```

Use `vehicle_job_ref` to accept the job. Use `worker_qr_token` only for worker QR check-in.

If `POST /api/workers/me/online` returns `409 WORKER_SOCKET_NOT_CONNECTED`, the WebSocket tab is not connected or was disconnected.
