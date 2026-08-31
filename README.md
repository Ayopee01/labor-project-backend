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

`docker-compose.yml` also has an `api-prod` service (gated behind the `production` profile) for self-managed production deployments — it builds the `production` Docker target instead of `dev`, runs the compiled `dist/` build with no source bind-mount, and sets `NODE_ENV=production` correctly. It is not used for local development; see the log stack section below for how it's typically started together with logging.

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

**Configuring Sentry**: set `SENTRY_DSN` in `.env` (see `.env.example`) — a no-op until set.

In local development (`NODE_ENV=development`), logs are pretty-printed via `pino-pretty` instead of raw JSON.

## Self-Hosted Log Stack (Grafana + Loki + Promtail)

For a self-managed deployment (e.g. a DigitalOcean droplet) without an external log service, `docker-compose.yml` includes a self-hosted log stack gated behind the `logging` profile, so it never affects local development (plain `docker compose up` is unchanged). Promtail reads the `api`/`api-prod` container's stdout JSON logs directly through the Docker logging driver (no app-side changes, no extra log file mounts) and ships them to Loki; Grafana comes with Loki pre-provisioned as a data source.

**Starting it** (alongside the production API — see `docker-compose.yml`'s `api-prod` service, gated behind the `production` profile for the same reason):

```bash
GRAFANA_ADMIN_USER=admin GRAFANA_ADMIN_PASSWORD=<a-real-password> \
  docker compose --profile production --profile logging up -d redis api-prod loki promtail grafana
```

> **List the service names explicitly, as above — do not run a bare `docker compose --profile production --profile logging up -d` with no service names.** Both `api` (the local-dev service, unprofiled and therefore always eligible to start) and `api-prod` bind the same host port `8080`, so an unnamed `up` would try to start both and fail on a port conflict. Naming services explicitly (as above) starts only what's listed and skips `api` entirely — verified by actually running this on this exact `docker-compose.yml`.

(or set `GRAFANA_ADMIN_USER`/`GRAFANA_ADMIN_PASSWORD` in the droplet's `.env` instead of inline — see `.env.example`.) If left unset, Grafana falls back to its own insecure `admin`/`admin` default — always set a real password before exposing the port below.

Also add `postgres` to that service list if this droplet also runs PostgreSQL in Docker (i.e. you're additionally using the `local-db` profile from the Local Development Setup section above) — it isn't included by default here since many production setups instead point `DATABASE_URL` at an external managed Postgres.

**Viewing logs**: open `http://<droplet-ip>:3000`, log in with the admin credentials above, then **Explore** → **Loki** → query e.g. `{service="api-prod"}` (or `{service="api"}` if you're pointed at a local-dev container instead).

**Restrict Grafana's port to your team only (required before exposing it on a public host)** — the admin password is the only auth layer in front of port 3000, so also firewall it at the OS level with UFW on the droplet itself. This is a **manual command you run yourself directly on the droplet, once** — it is not part of `docker-compose.yml` and nothing in this repo runs it automatically:

```bash
# 1. Replace YOUR_TEAM_IP with your actual team IP(s)/CIDR first — this is a placeholder.
# 2. Run these ONE AT A TIME and check you're not locked out after each step, in this exact
#    order. Getting the order wrong (e.g. enabling UFW or denying a port before explicitly
#    allowing SSH) can lock you out of the droplet entirely, with no way back in except the
#    provider's web console.
sudo ufw allow 22/tcp                                          # SSH — do this first, always
sudo ufw allow from YOUR_TEAM_IP to any port 3000 proto tcp     # Grafana, team IP only
sudo ufw deny 3000/tcp                                          # Grafana, deny everyone else
sudo ufw enable                                                 # only enable after the rules above
sudo ufw status verbose                                         # confirm SSH (22) is allowed before disconnecting
```

**Retention**: Loki is configured for 14 days (`monitoring/loki-config.yaml`'s `retention_period`) — set conservatively because the droplet's disk size wasn't known at setup time. Once real disk usage is confirmed comfortable (check with `docker exec labor-loki du -sh /loki` after the stack has been running a while), this can be raised to 30 days by editing that one value and restarting the `loki` container — no data migration needed. Consider also enabling DigitalOcean's built-in Droplet disk-usage monitoring/alerts as a safety net independent of Loki's own retention.

**Backup**: this is a self-managed VM — there is no automatic backup of the `loki_data` volume the way a managed logging service would provide. Back it up periodically (e.g. `docker run --rm -v labor-project-backend_loki_data:/loki -v $(pwd):/backup alpine tar czf /backup/loki-backup-$(date +%F).tar.gz /loki`) if historical logs need to survive a lost/corrupted droplet, or treat log history as disposable if it doesn't.