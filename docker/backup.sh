#!/usr/bin/env bash
set -euo pipefail

# Nightly pg_dump of the production database (NFR-08, technical design §17).
#
#   Usage:  docker/backup.sh [backup-dir]        default: <repo>/backups
#   Cron:   30 2 * * * /opt/vyuha/docker/backup.sh /var/backups/vyuha
#
# Writes vyuha-<UTC timestamp>.dump in pg_restore's custom format (compressed,
# restorable table-by-table), verifies the archive is listable, and prunes
# dumps older than VYUHA_BACKUP_RETENTION_DAYS (default 14). A dump this
# script has written but docker/restore.sh has never rehearsed is a hope, not
# a backup -- the runbook schedules the rehearsal too.
#
# The dump runs inside the postgres container with the container's own
# credentials, so this script needs no database password and works while the
# database port stays unpublished. Copy the resulting file off the box
# (rclone/rsync in the same cron) -- a backup on the disk it protects dies
# with that disk.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${VYUHA_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="${VYUHA_COMPOSE_FILE:-$ROOT/docker/docker-compose.prod.yml}"
BACKUP_DIR="${1:-$ROOT/backups}"
RETENTION_DAYS="${VYUHA_BACKUP_RETENTION_DAYS:-14}"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%d-%H%M%SZ)"
out="$BACKUP_DIR/vyuha-$stamp.dump"

# .partial until proven complete: a dump interrupted mid-write must never be
# the file the retention sweep decides to keep as "the latest backup".
compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "$out.partial"

# An archive pg_restore cannot even list would fail exactly when it matters.
# Bare stdin, not /dev/stdin: on the alpine image the latter cannot be
# reopened when it is a pipe and pg_restore reports a bogus "magic string"
# error against a perfectly good archive.
compose exec -T postgres pg_restore --list < "$out.partial" > /dev/null

mv "$out.partial" "$out"

find "$BACKUP_DIR" -name 'vyuha-*.dump' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'vyuha-*.dump.partial' -mtime +1 -delete

echo "backup written: $out ($(du -h "$out" | cut -f1))"
