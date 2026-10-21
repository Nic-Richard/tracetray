# GitHub API deployment

Run `Deploy API` on `main` after CI succeeds for that commit. The `Production`
environment requires Nic's approval and restricts deployment to `main`.

The workflow builds the dashboard and ships only application source/static assets
through a dedicated SSH key. Install `scripts/deploy-api-remote.sh` on the server as
`/usr/local/sbin/tracetray-github-deploy`, root-owned with mode 755. Authorize the
key with `restrict,command="/usr/local/sbin/tracetray-github-deploy"`; store its private
key as `TRACETRAY_DEPLOY_KEY` and the verified host-key entry as
`TRACETRAY_DEPLOY_KNOWN_HOSTS` in the `Production` environment.

The forced command validates archive paths and size, stages production dependencies,
runs the library smoke checks, saves one previous source copy and a bug-report backup,
then checks connected database/API health. Failure restores the previous code and
dependencies. It records the deployed SHA in `/var/www/tracetray/.api-release`.

The deployment preserves `.env`, MongoDB, screenshots, analysis data, logs, Python
dependencies and nginx configuration. It never invokes analysis or paid providers.
Do not use the older `scripts/deploy.sh` to roll out the API: it overwrites environment
files and runtime directories.
