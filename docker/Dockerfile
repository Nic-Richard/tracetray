# Production image: the server, the feature extractor, the Python clustering step and Chromium
# for page pictures, with the React dashboard built in. docker/server.Dockerfile is for local dev.
FROM node:20-bookworm-slim AS web

WORKDIR /repo
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace=web --workspace=@tracetray/shared --no-audit --no-fund
COPY web web
COPY packages/shared packages/shared
COPY server/public server/public
RUN npm run build:web

FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv chromium \
       fonts-liberation fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY ml/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund
COPY analysis/package.json analysis/package-lock.json analysis/
RUN cd analysis && npm ci --omit=dev --no-audit --no-fund
COPY server/server.js server/
COPY server/src server/src
COPY server/scripts server/scripts
COPY server/public server/public
COPY --from=web /repo/server/public/app server/public/app
COPY analysis analysis
COPY ml ml
COPY client client
RUN mkdir -p data/features data/output shots && chown -R node:node data shots

ENV NODE_ENV=production \
    PORT=5000 \
    PAGESHOT_BROWSER=/usr/bin/chromium \
    PAGESHOT_DIR=/app/shots \
    TRACETRAY_PYTHON=/opt/venv/bin/python

USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server/server.js"]
