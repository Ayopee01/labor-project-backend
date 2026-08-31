# Backend API Structure

Backend Express API for labor/user management.

The project supports two development modes:

- Local development on a developer machine
- Shared development/test deployment on Render

The shared Render environment provides a single public Backend Base URL for:

- Frontend integration
- Postman testing
- LINE OA webhook testing
- WebSocket testing
- Integration testing

Prisma owns the PostgreSQL schema, migrations, seed, and database client.

## API Documentation

Full API reference (Swagger UI) for the shared Render dev deployment:

https://labor-project-backend-dev.onrender.com/api-docs/

## Stack

- Node.js
- Express.js
- PostgreSQL
- Redis / Redis-compatible Key Value
- BullMQ
- Prisma ORM
- TypeScript compiled to CommonJS
- Docker
- GitHub Actions CI
- Render for shared development/test deployment

## Local Development Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in the token secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_LOGIN_CHALLENGE_SECRET`, `VENDOR_ACTION_TOKEN_SECRET`, `REFRESH_TOKEN_HASH_SECRET`) with any local values.

### 3. Start PostgreSQL and Redis

Redis is required for the app to start (BullMQ/ioredis). PostgreSQL can either run in Docker or be an existing local install.

**Option A — Postgres + Redis in Docker (no local Postgres install needed):**

```bash
docker compose --profile local-db up -d postgres redis
```

> The compose `postgres` service binds to host port `5434` by default, while `.env.example`'s `DATABASE_URL` points at port `5433`. Either add `POSTGRES_HOST_PORT=5433` to your `.env`, or change `DATABASE_URL`'s port to `5434` to match.

**Option B — Use an existing local PostgreSQL install:**

```bash
npm run docker:redis
```

Point `DATABASE_URL` in `.env` at your local PostgreSQL instance.

### 4. Generate the Prisma client and apply migrations

```bash
npm run db:generate
npm run db:migrate
```

### 5. Seed initial data

```bash
npm run db:seed
```

This creates the initial admin account and master data required to log in.

### 6. Start the dev server

```bash
npm run dev
```

The API listens on `http://localhost:8080` (from `PORT` in `.env`), with Swagger UI at `http://localhost:8080/api-docs`.

### Alternative: run the API itself in Docker too

`npm run docker:up` (`docker compose up --build`) builds and runs the `api` and `redis` services. By default it expects PostgreSQL to be reachable from inside the container via `DOCKER_DATABASE_URL` (defaults to `host.docker.internal:5433`, i.e. a PostgreSQL instance running on your host machine). To also run PostgreSQL in Docker, use `docker compose --profile local-db up --build` instead and set `DOCKER_DATABASE_URL` to `postgresql://postgres:password@postgres:5432/labor_project`.

The `api` container runs `npm run db:generate` automatically on startup, but migrations and seeding still need to be run manually, e.g.:

```bash
docker compose exec api npm run db:migrate
docker compose exec api npm run db:seed
```

## Running Tests

```bash
npm test
```

Runs unit tests and route tests (`test:unit` + `test:routes`). `npm run test:integration` additionally requires a real, isolated test database — `DATABASE_URL` must include `test` in its name (enforced in `test/setup/test-env.ts`).

## Logging & Error Tracking

Every request is logged once it completes, as a single structured JSON line to stdout (via [pino](https://getpino.io)) — never to a local file, since Render's filesystem is ephemeral. Fields logged per request:

- `requestId` — from the inbound `X-Request-Id` header, or a generated UUID if not sent. Always echoed back in the `X-Request-Id` response header, and included in every error response body so a user can report an issue and the team can find the matching log line fast.
- `method`, `path`, `statusCode`, `durationMs`
- `clientType` — `worker_app` / `admin_webapp` / `driver_webapp` / `gate` / `line_oa` / `unknown`, detected from the URL path prefix first, then (for the shared `/api/auth` routes only) from the authenticated account's role, then from an `X-Client-Type` header, then `unknown` — see `src/utils/client-type.ts`
- `clientVersion` — from an optional `X-Client-Version` header
- `userId` — the authenticated account id, when present
- `ip`

Log level follows the response status code: `>=500` → `error`, `>=400` → `warn`, otherwise → `info`.

**Sensitive data**: passwords, tokens, secrets, and `Authorization` headers are redacted (`[REDACTED]`) before anything is logged, via `src/utils/logger.ts`'s `redact()` — this applies to every `logger.*` call in the codebase, including the 5xx error log's request body, so this never needs to be handled per-endpoint.

**5xx errors** additionally log full context (`requestId`, `path`, `userId`, `clientType`, the redacted request body, stack trace) and are reported to [Sentry](https://sentry.io) with the same `requestId`/`clientType`/`userId` attached as tags/user context (`src/middlewares/error.middleware.ts`). Sentry is a no-op until `SENTRY_DSN` is set.

**Viewing logs on Render**: open the service in the Render dashboard → **Logs** tab. Every line is a JSON object; filter/search by any field above (e.g. `requestId` from an error response, or `clientType`).

**Configuring Sentry / an external log service**: set the environment variables documented in `.env.example` (`SENTRY_DSN`, `LOG_LEVEL`, and `LOG_SERVICE_URL`/`LOG_SERVICE_TOKEN` — the latter two are reserved for forwarding stdout to a log service like Better Stack or Grafana Loki once one is actually subscribed to; nothing is wired to a specific vendor yet).

In local development (`NODE_ENV=development`), logs are pretty-printed via `pino-pretty` instead of raw JSON.