# Local development image: Node for the server, Python for the clustering step.
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY ml/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY analysis/package.json analysis/package-lock.json analysis/
RUN cd analysis && npm ci
