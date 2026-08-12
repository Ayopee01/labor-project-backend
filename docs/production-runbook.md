# Production Runbook

## Rollback

Use the `Rollback` workflow with:

- `target_environment`: `staging` or `production`
- `image_sha`: a previously published 40-character commit SHA

Rollback deploys `ghcr.io/<lowercase-owner>/<lowercase-repository>:sha-<image_sha>`
without running migrations, checks out deployment assets from the same SHA, then
runs the same readiness check as normal deployment. If the failed release
included a non-backward-compatible migration, restore or repair the database
deliberately before switching traffic.

Rollback production still uses the `production` GitHub Environment, so existing
protection rules apply. Prisma migrations are not automatically reversed.

## Backup and Restore

Minimum production backup policy:

- Schedule PostgreSQL logical backups with `pg_dump`.
- Store backups outside the application server.
- Encrypt backups at rest.
- Retain enough restore points to cover operational and compliance needs.
- Run a restore drill before declaring production ready.

Restore outline:

```sh
createdb labor_project_restore
pg_restore --dbname labor_project_restore backup.dump
npm run db:deploy
```

Validate `/ready`, representative admin flows, worker assignment flow, vendor
confirmation flow, and financial reports after restore.

## Monitoring

The app emits structured JSON logs and returns request IDs in `x-request-id`.
Configure a log platform and alerts for:

- `/ready` failures
- HTTP 5xx rate
- container restarts
- Prisma migration failures
- BullMQ failed jobs
- Redis memory and persistence errors
- PostgreSQL connection saturation
- disk capacity for uploads and backups

`MONITORING_PROVIDER_REQUIRED` until a concrete provider and alert routing are
configured.

## Database Performance

Before adding new indexes, capture evidence with `EXPLAIN (ANALYZE, BUFFERS)`
against production-like data. This round does not include an evidence-backed
index migration, so `INDEX_MIGRATION_DEFERRED`.

Priority queries to measure:

- Worker performance audit date windows and pagination.
- Active vehicle job dispatch lookup.
- Gate ticket completion lookup.
- Worker current assignment lookup.

## Image Cleanup

Do not prune all images automatically. Keep at least the current production
image and several previous SHA tags. If cleanup is needed, prune dangling images
only after confirming rollback images remain pullable from GHCR.

## Manual Readiness Checklist

- GitHub `staging` and `production` environments exist.
- Production environment has required reviewers.
- Environment secrets are configured.
- GHCR package grants pull access to the deployment principal.
- Production server has Docker Compose v2.
- Server `.env.production` exists and contains production application secrets.
- Deploy commands use `docker compose --env-file .env.production`.
- `APP_IMAGE` is a lowercase GHCR `sha-<40-character-sha>` image reference.
- `CORS_ORIGIN` is set to an explicit non-wildcard production origin.
- `REDIS_URL` is present in `.env.production`.
- `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` are set for production.
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`
  are set in `.env.production` for Worker Push.
- Production database backup schedule and restore drill are complete.
- `CLOUDFLARE_TOPOLOGY_CONFIGURATION_REQUIRED` is resolved before enabling public traffic.
- Monitoring and alert routing are configured.

## Security Validation Status

- Production dependency review: `PRODUCTION_DEPENDENCY_AUDIT_REQUIRED`.
  Run `npm audit --omit=dev` before release and record any high or critical
  production dependency finding. The audit was not completed in this round
  because the registry audit request was blocked.
- Docker validation: build the production target, verify `prisma.config.js`,
  `prisma/schema.prisma`, `prisma/migrations`, `dist`, and package files are in
  the image, verify `.env` is absent, verify runtime user is not root, and verify
  `/app/uploads` is writable.
