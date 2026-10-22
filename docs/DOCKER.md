# Docker

`docker-compose.yml` is the local development stack. `docker-compose.production.yml` is the
production-style stack for a later move off the VPS (AWS ECS, Lightsail or another host);
production still runs on the VPS with PM2 today.

- `app` (`docker/Dockerfile`): the server, feature extractor, Python clustering and Chromium
  for page pictures, with the dashboard built in. Runs as the non-root `node` user. Page
  pictures and analysis files live on the `shots` and `analysis` volumes.
- `mongo`: MongoDB 7 with auth on. `docker/mongo-init.js` creates the `tracetray` login with
  readWrite on `sessionDB` the first time the volume is created; the app never uses the
  admin login.

```sh
cp .env.production.example .env.production   # fill in passwords, Clerk and Stripe keys
docker compose -f docker-compose.production.yml --env-file .env.production up --build -d
```

The app listens on port 5000 (`APP_PORT` changes it); TLS ends in front of it. Use a
separate project name (`-p tracetray-prod`) when the dev stack is also running.

Moving production: `mongodump` the VPS `sessionDB` with its login, `mongorestore` it into
the container with the `tracetray` login, copy `/var/www/tracetray/shots` into the `shots`
volume, then point DNS or the load balancer at `app`.
