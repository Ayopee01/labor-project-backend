#!/usr/bin/env bash
# Dumps the PostgreSQL database (DATABASE_URL), compresses it, and uploads it to a
# DigitalOcean Spaces bucket (S3-compatible), then prunes backups older than
# BACKUP_RETENTION_DAYS from that bucket. All config comes from environment variables (see
# .env.example's "Backups (DigitalOcean Spaces)" section) — no credentials are hardcoded here.
#
# Intended to run directly on the droplet host, on a schedule via cron (see README for the
# crontab line) — not inside a container, so it works the same whether Postgres runs in Docker
# (local-db profile, reachable at the host-published port) or as an external managed database.
# Requires `pg_dump` (postgresql-client) and `s3cmd` installed on the host — see README.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL must be set (see .env)}"
: "${SPACES_BUCKET:?SPACES_BUCKET must be set in .env}"
: "${SPACES_ENDPOINT:?SPACES_ENDPOINT must be set in .env}"
: "${SPACES_REGION:?SPACES_REGION must be set in .env}"
: "${SPACES_ACCESS_KEY:?SPACES_ACCESS_KEY must be set in .env}"
: "${SPACES_SECRET_KEY:?SPACES_SECRET_KEY must be set in .env}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

for var in SPACES_BUCKET SPACES_ENDPOINT SPACES_ACCESS_KEY SPACES_SECRET_KEY; do
  value="${!var}"
  case "$value" in
    CHANGE_ME*)
      echo "Error: $var in .env is still a placeholder. Fill in real DigitalOcean Spaces values first." >&2
      exit 1
      ;;
  esac
done

command -v pg_dump >/dev/null 2>&1 || { echo "Error: pg_dump not found. Install postgresql-client on this host." >&2; exit 1; }
command -v s3cmd >/dev/null 2>&1 || { echo "Error: s3cmd not found. Install it (e.g. apt install s3cmd) on this host." >&2; exit 1; }

SPACES_HOST="${SPACES_ENDPOINT#https://}"
SPACES_HOST="${SPACES_HOST#http://}"
S3CMD_OPTS=(
  --host="${SPACES_HOST}"
  --host-bucket="%(bucket)s.${SPACES_HOST}"
  --access_key="${SPACES_ACCESS_KEY}"
  --secret_key="${SPACES_SECRET_KEY}"
  --region="${SPACES_REGION}"
)

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_NAME="labor-project-postgres-${TIMESTAMP}.sql.gz"
BACKUP_FILE="$(mktemp -d)/${BACKUP_NAME}"
trap 'rm -f "$BACKUP_FILE"' EXIT

echo "==> Dumping database..."
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

echo "==> Uploading to DigitalOcean Spaces (${SPACES_BUCKET}/postgres-backups/${BACKUP_NAME})..."
s3cmd put "$BACKUP_FILE" "s3://${SPACES_BUCKET}/postgres-backups/${BACKUP_NAME}" "${S3CMD_OPTS[@]}"

echo "==> Pruning backups older than ${BACKUP_RETENTION_DAYS} days..."
CUTOFF_EPOCH="$(date -u -d "-${BACKUP_RETENTION_DAYS} days" +%s)"
s3cmd ls "s3://${SPACES_BUCKET}/postgres-backups/" "${S3CMD_OPTS[@]}" | while read -r obj_date obj_time _ obj_path; do
  [ -n "$obj_path" ] || continue
  obj_epoch="$(date -u -d "${obj_date} ${obj_time}" +%s 2>/dev/null || echo 0)"
  if [ "$obj_epoch" -gt 0 ] && [ "$obj_epoch" -lt "$CUTOFF_EPOCH" ]; then
    echo "   deleting ${obj_path}"
    s3cmd del "$obj_path" "${S3CMD_OPTS[@]}"
  fi
done

echo "Backup complete: postgres-backups/${BACKUP_NAME}"
