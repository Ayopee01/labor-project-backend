# Deployment

Deployments use immutable Docker images from GitHub Container Registry. The
server must not run `git pull`, `npm ci`, or local builds for each deploy.

## Automatic Flow

`main` merge runs this gate:

1. CI runs on the pushed commit.
2. `Release` starts only after the `CI` workflow completes successfully.
3. `Release` checks out `github.event.workflow_run.head_sha`, the exact tested
   SHA.
4. Docker image is built once and pushed as
   `ghcr.io/<lowercase-owner>/<lowercase-repository>:sha-<40-char-sha>`.
5. Staging deploys that exact image.
6. Staging readiness must pass.
7. Production waits for GitHub Environment approval.
8. Production deploys the same exact image.

Production never rebuilds the image.

The deployment workflow passes `release_sha` to the reusable SSH workflow. The
SSH workflow checks out that exact SHA before uploading `docker-compose.prod.yml`,
so the image SHA and deployment assets SHA stay identical.

## Manual Deploy

Manual deployment uses `workflow_dispatch` on `Release` and requires:

- `target_environment`: `staging` or `production`
- `image_sha`: existing 40-character Git SHA

Manual deploy validates the SHA format, verifies the GHCR image exists, and
deploys only the selected environment. It checks out the same SHA as the image
tag and does not rebuild source.

## GitHub Environments

Create these GitHub Environments:

- `staging`
- `production`

Set production approval in GitHub:

Settings -> Environments -> production -> Required reviewers

Codex does not choose reviewers.

## Environment Secrets

Set these secrets on each GitHub Environment:

- `DEPLOY_HOST`
- `DEPLOY_PORT`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`
- `DEPLOY_PATH`
- `GHCR_USERNAME`
- `GHCR_PULL_TOKEN`

The reusable deploy workflow sets `environment: ${{ inputs.environment_name }}`,
so each deployment job reads the selected environment's secrets directly. Do not
create separate names such as `STAGING_DEPLOY_HOST` or `PRODUCTION_DEPLOY_HOST`.

`DEPLOY_KNOWN_HOSTS` must contain the SSH host key entry for the target server.
GHCR login uses `--password-stdin`.

## Server Configuration

The server must have `.env.production` in `DEPLOY_PATH`. Do not commit it.

Required application values include:

- `NODE_ENV=production`
- `PORT=8080`
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `JWT_LOGIN_CHALLENGE_SECRET`
- `REFRESH_TOKEN_HASH_SECRET`
- Redis key and BullMQ queue names
- `CORS_ORIGIN` with an explicit non-wildcard origin
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `CLOUDFLARE_TUNNEL_TOKEN`, when the named tunnel profile is enabled

Firebase/FCM values are read by the application from the server
`.env.production`; do not copy real Firebase private keys into GitHub workflow
secrets unless another workflow explicitly needs them. `FIREBASE_PRIVATE_KEY`
may use escaped newlines (`\n`).

Production compose does not override `REDIS_URL`; the server env file is the
source of truth. Deployment commands use:

```sh
APP_IMAGE='ghcr.io/<lowercase-owner>/<lowercase-repository>:sha-<40-char-sha>' \
  docker compose --env-file .env.production -f docker-compose.prod.yml up -d api redis
```

`--env-file .env.production` is required so Compose interpolation values such as
`APP_BIND_ADDRESS`, `APP_PORT`, and any enabled Cloudflare tunnel token are read
deterministically from the same file used by the container environment.

## Network / Cloudflare

By default production compose binds the API to `127.0.0.1:${APP_PORT:-8080}`.
Set `APP_BIND_ADDRESS=0.0.0.0` only when the API should be exposed directly by
the host firewall or load balancer.

Cloudflare production must use a named tunnel, not a quick tunnel.

`docker-compose.prod.yml` contains a `cloudflared` service behind the `tunnel`
profile, but the deploy workflow does not start that profile by default.
`CLOUDFLARE_TOPOLOGY_CONFIGURATION_REQUIRED` until the operator confirms one
topology:

- compose-managed named tunnel: deploy with the `tunnel` profile and set
  `CLOUDFLARE_TUNNEL_TOKEN` in `.env.production`.
- externally managed named tunnel: do not start `cloudflared` from Compose.

## Migrations

Production uses only:

```sh
npm run db:deploy
```

Do not use `prisma migrate reset`, `prisma db push --force-reset`, or destructive
volume commands in production. Prefer expand/contract migrations for risky
schema changes.

If migrations pass but readiness fails, the deployment fails and does not
auto-rollback. Use the rollback workflow manually after checking schema
compatibility.

## Health

- `/health` is liveness and does not check dependencies.
- `/ready` checks PostgreSQL and Redis and returns `503` when either dependency
  is unavailable.
- Readiness responses do not expose raw DB/Redis error messages.

Docker healthcheck uses `/health`. Deployment verification uses `/ready`.
