#!/usr/bin/env bash
# Dumps the TraceTray database and uploads it to S3. Runs nightly from cron on the server:
# BACKUP_BUCKET=<bucket> /var/www/tracetray/server/scripts/backup-db.sh
# The bucket's lifecycle rule removes old dumps, so this script only ever adds one.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUCKET="${BACKUP_BUCKET:?BACKUP_BUCKET is required}"

MONGODB_URI="$(grep -E '^MONGODB_URI=' "$ROOT_DIR/.env" | head -1 | cut -d= -f2- | sed -E 's/^["'\'']|["'\'']$//g')"
if [[ -z "$MONGODB_URI" ]]; then
  echo "MONGODB_URI is missing from $ROOT_DIR/.env" >&2
  exit 1
fi

archive="$(mktemp --suffix=.archive.gz)"
trap 'rm -f "$archive"' EXIT

mongodump --uri="$MONGODB_URI" --archive="$archive" --gzip --quiet
aws s3 cp "$archive" "s3://$BUCKET/tracetray/$(date -u +%Y-%m-%dT%H%MZ).archive.gz" --only-show-errors
echo "Backed up $(du -h "$archive" | cut -f1) to s3://$BUCKET/tracetray/"
