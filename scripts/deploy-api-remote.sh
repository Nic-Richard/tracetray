#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([0-9a-f]{40})$ ]] || exit 64
revision="${BASH_REMATCH[1]}"
root=/var/www/tracetray
backup=/root/deploy-backups/tracetray-github-previous
code_directories=(client server/src server/public server/scripts analysis ml)
preserve=(--exclude=node_modules/ --exclude=venv/ --exclude=.venv/ --exclude=__pycache__/ --exclude='*.py[cod]' --exclude=.env --exclude='.env.*')
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
        allowed = item.name in ('client', 'server', 'server/server.js', 'server/package.json', 'server/package-lock.json', 'server/src', 'server/public', 'server/scripts', 'analysis', 'ml') or item.name.startswith(('client/', 'server/src/', 'server/public/', 'server/scripts/', 'analysis/', 'ml/'))
        runtime = any(part in ('node_modules', 'venv', '.venv', '__pycache__') or part.startswith('.env') for part in path.parts)
        if not allowed or runtime or path.is_absolute() or '..' in path.parts or not (item.isfile() or item.isdir()):
            raise SystemExit('Unexpected deployment archive entry')
    archive.extractall(sys.argv[2], filter='data')
PY
test -f "$stage/server/public/app/index.html"
test -f "$stage/analysis/extractFeatures.js"
test -f "$stage/analysis/package-lock.json"
test -f "$stage/ml/analyze.py"
test -f "$stage/ml/goal_model.py"
test -f "$stage/ml/requirements.txt"
while IFS= read -r -d '' file; do node --check "$file"; done < <(find "$stage/server/src" "$stage/server/scripts" "$stage/client" "$stage/analysis" -name '*.js' -print0)
node --check "$stage/server/server.js"
(umask 022 && cd "$stage/server" && npm ci --omit=dev)
(umask 022 && cd "$stage/analysis" && npm ci --omit=dev)
node "$stage/server/scripts/smoke-lib.js"
node - "$root" "$stage/ml" <<'JS'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const [root, stagedMl] = process.argv.slice(2);
const env = require(root + '/server/node_modules/dotenv').parse(fs.readFileSync(root + '/.env'));
const python = process.env.TRACETRAY_PYTHON || env.TRACETRAY_PYTHON || 'python3';
const check = 'import compileall, sys; assert compileall.compile_dir(sys.argv[1], quiet=1); sys.path.insert(0, sys.argv[1]); import analyze, goal_model';
const result = spawnSync(python, ['-c', check, stagedMl], { cwd: root, timeout: 60000, stdio: 'inherit' });
if (result.status !== 0) { console.error('Python analysis preflight failed; deployment stopped.'); process.exit(1); }
JS

install -d -m 700 "$backup" "$stage/restore"
tar -czf "$backup/source.tar.gz.next" --exclude='*/node_modules' --exclude='*/venv' --exclude='*/.venv' --exclude='*/__pycache__' --exclude='*.py[cod]' --exclude='.env' --exclude='.env.*' \
  -C "$root" "${code_directories[@]}" server/server.js server/package.json server/package-lock.json
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
previous_dependencies=()
installed_dependencies=()
rollback() {
  status=$?
  trap - ERR
  set +e
  if [[ $changed == 1 ]]; then
    echo 'Deployment failed; restoring the previous code. Database and runtime data remain untouched.'
    for directory in "${code_directories[@]}"; do
      rsync -a --delete "${preserve[@]}" --chmod=D755,F644 "$stage/restore/$directory/" "$root/$directory/"
    done
    install -m 644 "$stage/restore/server/server.js" "$root/server/server.js"
    install -m 644 "$stage/restore/server/package.json" "$stage/restore/server/package-lock.json" "$root/server/"
    for package in "${installed_dependencies[@]}"; do rm -rf -- "$root/$package/node_modules"; done
    for package in "${previous_dependencies[@]}"; do mv "$stage/previous-$package-node_modules" "$root/$package/node_modules"; done
    (cd "$root" && pm2 reload ecosystem.config.js --only tracetray --update-env)
  fi
  exit "$status"
}
trap rollback ERR
changed=1
for directory in "${code_directories[@]}"; do
  rsync -a --delete "${preserve[@]}" --chmod=D755,F644 "$stage/$directory/" "$root/$directory/"
done
install -m 644 "$stage/server/server.js" "$root/server/server.js"
install -m 644 "$stage/server/package.json" "$stage/server/package-lock.json" "$root/server/"
for package in server analysis; do
  if [[ -e "$root/$package/node_modules" ]]; then
    mv "$root/$package/node_modules" "$stage/previous-$package-node_modules"
    previous_dependencies+=("$package")
  fi
  installed_dependencies+=("$package")
  mv "$stage/$package/node_modules" "$root/$package/node_modules"
done
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
