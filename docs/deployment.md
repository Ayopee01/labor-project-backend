# Deployment

Production deployment is now GitHub Actions CI followed by Railway deployment.
The repository no longer needs a production SSH host, VPS Docker Compose
orchestrator, Cloudflare Tunnel, or GHCR image promotion flow.

## Production Flow

1. A pull request or push to `develop` or `main` runs the `CI` workflow.
2. CI installs dependencies, generates Prisma Client, typechecks, builds, runs
   unit and route tests, applies test migrations, and runs DB-backed integration
   tests against PostgreSQL and Redis service containers.
3. Railway should be connected to the GitHub repository and configured to deploy
   from the production branch after CI is green.
4. Railway builds the `Dockerfile` production image.
5. Railway runs `npm run db:deploy` as the pre-deploy migration command.
6. Railway starts `node dist/index.js` from the Dockerfile command.
7. Railway uses `/ready` as the deployment healthcheck.

## Railway Configuration

The repository includes `railway.json`:

- `build.builder`: `DOCKERFILE`
- `build.dockerfilePath`: `Dockerfile`
- `deploy.preDeployCommand`: `npm run db:deploy`
- `deploy.healthcheckPath`: `/ready`
- `deploy.healthcheckTimeout`: `300`
- `deploy.restartPolicyType`: `ALWAYS`

Do not add real secrets to `railway.json`, the Dockerfile, or this repository.

## Railway Variables

Set these on the Railway Backend API service:

- `NODE_ENV=production`
- `TRUST_PROXY=true`
- `CORS_ORIGIN=<frontend-origin>`
- `DATABASE_URL=${{Postgres.DATABASE_URL}}` or the equivalent Railway reference
- `REDIS_URL=${{Redis.REDIS_URL}}` or the equivalent Railway reference
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_LOGIN_CHALLENGE_SECRET`
- `REFRESH_TOKEN_HASH_SECRET`
- Redis key and BullMQ queue names
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `UPLOAD_DIR=<mounted-volume-path>` if Railway Volume is used

Railway injects `PORT`; do not hard-code a production port. The app listens on
`process.env.PORT` and binds to `0.0.0.0` by default.

## Database and Redis

Prisma uses `DATABASE_URL`. Production schema changes must use:

```sh
npm run db:deploy
```

Do not use `prisma migrate reset`, `prisma db push --force-reset`, or destructive
database commands in production.

Redis uses `REDIS_URL` for Worker presence/status, BullMQ queues, LINE messages,
assignment timeouts, and worker break return jobs.

## Health and Readiness

- `/health` is lightweight liveness and does not check PostgreSQL or Redis.
- `/ready` checks PostgreSQL and Redis and returns `503` when either dependency
  is unavailable.
- Railway deployment healthcheck should use `/ready`.

## Local Development

Keep `docker-compose.yml` for local development. Its Cloudflare Tunnel profiles
are for LINE webhook development only. Production on Railway should use the
Railway public domain or a custom domain, not a Cloudflare Tunnel service in
this repository.
