# Production Runbook

## Railway Release Checklist

- GitHub `CI` is green for the commit to deploy.
- Railway Backend API service is connected to the intended GitHub branch.
- Railway PostgreSQL and Redis services exist in the same project/environment.
- Backend API has `DATABASE_URL` and `REDIS_URL` referencing those Railway
  services.
- `NODE_ENV=production`, `TRUST_PROXY=true`, and explicit `CORS_ORIGIN` are set.
- JWT, refresh hash, LINE, and Firebase secrets are set only in Railway.
- Railway healthcheck path is `/ready`.
- Railway pre-deploy command is `npm run db:deploy`.
- Upload persistence is decided before accepting production file uploads.

## Rollback

Use Railway deployment history to redeploy a previous successful deployment.
Prisma migrations are not automatically rolled back. If a failed release included
a non-backward-compatible migration, repair or restore the database deliberately
before routing traffic to older application code.

## Backup and Restore

Minimum production backup policy:

- Enable PostgreSQL backups or snapshots for the Railway PostgreSQL service.
- Store important exports outside the application container.
- Encrypt backups at rest.
- Retain enough restore points to cover operational and compliance needs.
- Run a restore drill before declaring production ready.

Restore outline:

```sh
npm run db:deploy
```

Validate `/ready`, representative admin flows, worker assignment flow, vendor
confirmation flow, and financial reports after restore.

## Monitoring

The app emits structured JSON logs and returns request IDs in `x-request-id`.
Configure Railway logs/metrics or an external provider and alerts for:

- `/ready` failures
- HTTP 5xx rate
- container restarts
- Prisma migration failures
- BullMQ failed jobs
- Redis memory and persistence errors
- PostgreSQL connection saturation
- upload volume capacity if file uploads remain on disk

`MONITORING_PROVIDER_REQUIRED` until a concrete provider and alert routing are
configured.

## Persistent Uploads

The app stores worker images under `UPLOAD_DIR` and serves them from `/uploads`.
Railway container disk is ephemeral, so production must choose one:

- Mount a Railway Volume and set `UPLOAD_DIR` to that mount path.
- Move uploads to object storage and store durable object URLs in the database.

Do not treat the default local `uploads` directory as durable production storage.

## Security Validation Status

- Production dependency review: `PRODUCTION_DEPENDENCY_AUDIT_REQUIRED`.
  Run `npm audit --omit=dev` before release and record high or critical
  production dependency findings.
- Docker validation: build the production target, verify `prisma.config.js`,
  `prisma/schema.prisma`, `prisma/migrations`, `dist`, and package files are in
  the image, verify `.env` is absent, verify runtime user is not root, and verify
  `/app/uploads` or the configured `UPLOAD_DIR` is writable.
