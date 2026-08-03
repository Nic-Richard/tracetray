#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_ENV="$ROOT_DIR/.env.deploy"

if [[ ! -f "$DEPLOY_ENV" ]]; then
  echo "Missing .env.deploy. Copy .env.deploy.example and fill in the SSH target."
  exit 1
fi

set -a
source "$DEPLOY_ENV"
set +a

SERVER="${TRACETRAY_SERVER:?TRACETRAY_SERVER is required}"
REMOTE="${TRACETRAY_REMOTE:-/var/www/tracetray}"
RELEASE="$REMOTE/.release"

for file in "$ROOT_DIR/.env" "$ROOT_DIR/server/package.json" "$ROOT_DIR/analysis/package.json" "$ROOT_DIR/ml/requirements.txt"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file"
    exit 1
  fi
done

node --check "$ROOT_DIR/server/server.js"
node --check "$ROOT_DIR/analysis/extractFeatures.js"

if command -v python >/dev/null 2>&1; then
  PYTHON_CMD=(python)
elif command -v py >/dev/null 2>&1; then
  PYTHON_CMD=(py -3)
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD=(python3)
else
  echo "Python 3 was not found in PATH."
  exit 1
fi

"${PYTHON_CMD[@]}" -m py_compile "$ROOT_DIR/ml/analyze.py"

echo "Preparing TraceTray release for $SERVER:$REMOTE..."
ssh "$SERVER" "rm -rf '$RELEASE' && mkdir -p '$RELEASE' '$REMOTE/logs'"

tar -C "$ROOT_DIR" \
  --exclude='server/node_modules' \
  --exclude='analysis/node_modules' \
  --exclude='.venv' \
  --exclude='venv' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='data/features/*.json' \
  --exclude='data/output/*' \
  -czf - client server analysis ml data ecosystem.config.js \
  | ssh "$SERVER" "tar -xzf - -C '$RELEASE'"

scp "$ROOT_DIR/.env" "$SERVER:$RELEASE/.env"

ssh "$SERVER" "\
  cd '$RELEASE/server' && if [[ -f package-lock.json ]]; then npm ci --omit=dev; else npm install --omit=dev; fi && \
  cd '$RELEASE/analysis' && if [[ -f package-lock.json ]]; then npm ci --omit=dev; else npm install --omit=dev; fi && \
  python3 -m pip install -r '$RELEASE/ml/requirements.txt' --break-system-packages -q && \
  rm -rf '$REMOTE/client' '$REMOTE/server' '$REMOTE/analysis' '$REMOTE/ml' '$REMOTE/data' && \
  mv '$RELEASE/client' '$REMOTE/client' && \
  mv '$RELEASE/server' '$REMOTE/server' && \
  mv '$RELEASE/analysis' '$REMOTE/analysis' && \
  mv '$RELEASE/ml' '$REMOTE/ml' && \
  mv '$RELEASE/data' '$REMOTE/data' && \
  mv '$RELEASE/ecosystem.config.js' '$REMOTE/ecosystem.config.js' && \
  mv '$RELEASE/.env' '$REMOTE/.env' && \
  rm -rf '$RELEASE' && \
  cd '$REMOTE' && pm2 startOrRestart ecosystem.config.js --update-env && pm2 save"

scp "$ROOT_DIR/deploy/nginx.conf" "$SERVER:/tmp/tracetray.nginx.conf"

ssh "$SERVER" "\
  set -euo pipefail; \
  for attempt in {1..15}; do \
    if curl -fsS http://localhost:5000/api/health >/dev/null; then break; fi; \
    if [[ \$attempt -eq 15 ]]; then \
      echo 'TraceTray health check failed.' >&2; \
      exit 1; \
    fi; \
    sleep 1; \
  done; \
  install -m 0644 /tmp/tracetray.nginx.conf /etc/nginx/sites-available/tracetray; \
  rm -f /etc/nginx/sites-enabled/tracetray; \
  ln -s /etc/nginx/sites-available/tracetray /etc/nginx/sites-enabled/tracetray; \
  rm -f /tmp/tracetray.nginx.conf; \
  nginx -t; \
  systemctl reload nginx; \
  if ! nginx -T 2>/dev/null | grep -q 'server_name www.tracetray.com;'; then \
    echo 'The www redirect server block is not loaded by Nginx.' >&2; \
    exit 1; \
  fi; \
  redirect=\$(curl -ksS -o /dev/null -w '%{http_code} %{redirect_url}' \
    --resolve www.tracetray.com:443:127.0.0.1 \
    https://www.tracetray.com/); \
  if [[ \"\$redirect\" != '301 https://tracetray.com/' ]]; then \
    echo \"Unexpected www redirect result: \$redirect\" >&2; \
    exit 1; \
  fi; \
  echo \"Verified www redirect: \$redirect\""

echo "TraceTray deployed successfully."
