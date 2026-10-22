#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([0-9a-f]{40})$ ]] || exit 64
revision="${BASH_REMATCH[1]}"
root=/var/www/tracetray
backup=/root/deploy-backups/tracetray-github-previous
exec 9>/run/lock/tracetray-github-deploy.lock
flock -n 9 || { echo 'Another TraceTray deployment is running.'; exit 75; }
stage=$(mktemp -d /var/tmp/tracetray-deploy.XXXXXX)
[[ "$stage" == /var/tmp/tracetray-deploy.* && -d "$stage" ]] || exit 70
trap 'rm -rf -- "$stage"' EXIT
head -c 104857601 > "$stage/source.tar.gz"
[[ $(stat -c %s "$stage/source.tar.gz") -le 104857600 ]] || exit 65
python3 - "$stage/source.tar.gz" "$stage" <<'PY'
import pathlib, sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for item in archive.getmembers():
        path = pathlib.PurePosixPath(item.name)
        allowed = item.name in ('client', 'server', 'server/server.js', 'server/package.json', 'server/package-lock.json', 'server/src', 'server/public', 'server/scripts') or item.name.startswith(('client/', 'server/src/', 'server/public/', 'server/scripts/'))
        if not allowed or path.is_absolute() or '..' in path.parts or not (item.isfile() or item.isdir()):
            raise SystemExit('Unexpected deployment archive entry')
    archive.extractall(sys.argv[2], filter='data')
PY
test -f "$stage/server/public/app/index.html"
while IFS= read -r -d '' file; do node --check "$file"; done < <(find "$stage/server/src" "$stage/server/scripts" "$stage/client" -name '*.js' -print0)
node --check "$stage/server/server.js"
(umask 022 && cd "$stage/server" && npm ci --omit=dev)
node "$stage/server/scripts/smoke-lib.js"

install -d -m 700 "$backup" "$stage/restore"
tar -czf "$backup/source.tar.gz.next" -C "$root" client server/server.js server/src server/public server/scripts server/package.json server/package-lock.json
mv "$backup/source.tar.gz.next" "$backup/source.tar.gz"
node - "$root" "$backup/bug_reports.archive.gz" <<'JS'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const [root, destination] = process.argv.slice(2);
const env = require(root + '/server/node_modules/dotenv').parse(fs.readFileSync(root + '/.env'));
const result = spawnSync('/usr/bin/mongodump', ['--uri', env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sessionDB', '--collection', 'bug_reports', '--archive=' + destination, '--gzip'], { encoding: 'utf8' });
if (result.status !== 0) { console.error('Report backup failed; deployment stopped.'); process.exit(1); }
JS
tar -xzf "$backup/source.tar.gz" -C "$stage/restore"
changed=0
dependencies_moved=0
rollback() {
  status=$?
  trap - ERR
  set +e
  if [[ $changed == 1 ]]; then
    echo 'Deployment failed; restoring the previous code. Database and runtime data remain untouched.'
    for directory in client server/src server/public server/scripts; do
      rsync -a --delete --chmod=D755,F644 "$stage/restore/$directory/" "$root/$directory/"
    done
    install -m 644 "$stage/restore/server/server.js" "$root/server/server.js"
    install -m 644 "$stage/restore/server/package.json" "$stage/restore/server/package-lock.json" "$root/server/"
    if [[ $dependencies_moved == 1 ]]; then
      rm -rf -- "$root/server/node_modules"
      mv "$stage/previous-node_modules" "$root/server/node_modules"
    fi
    (cd "$root" && pm2 reload ecosystem.config.js --only tracetray --update-env)
  fi
  exit "$status"
}
trap rollback ERR
changed=1
for directory in client server/src server/public server/scripts; do
  rsync -a --delete --chmod=D755,F644 "$stage/$directory/" "$root/$directory/"
done
install -m 644 "$stage/server/server.js" "$root/server/server.js"
install -m 644 "$stage/server/package.json" "$stage/server/package-lock.json" "$root/server/"
mv "$root/server/node_modules" "$stage/previous-node_modules"
dependencies_moved=1
mv "$stage/server/node_modules" "$root/server/node_modules"
(cd "$root" && pm2 reload ecosystem.config.js --only tracetray --update-env)
for attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:5000/api/health >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent --max-time 5 http://127.0.0.1:5000/api/health
curl --fail --silent --max-time 5 http://127.0.0.1:5000/privacy >/dev/null
printf '%s\n' "$revision" > "$root/.api-release"
trap - ERR
echo "TraceTray deployed: $revision"
