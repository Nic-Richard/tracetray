# GitHub API deployment

Run `Deploy API` on `main` after CI succeeds for that commit. The `Production`
environment requires Nic's approval and restricts deployment to `main`.

The workflow builds the dashboard and ships application source/static assets,
including `analysis/` and `ml/`, through a dedicated SSH key.
Install `scripts/deploy-api-remote.sh` on the server as
`/usr/local/sbin/tracetray-github-deploy`, root-owned with mode 755. Authorize the
key with `restrict,command="/usr/local/sbin/tracetray-github-deploy"`; store its private
key as `TRACETRAY_DEPLOY_KEY` and the verified host-key entry as
`TRACETRAY_DEPLOY_KNOWN_HOSTS` in the `Production` environment.

Update the installed forced command before the first deployment using the expanded
archive. The previous receiver rejects `analysis/` and `ml/`; committing its replacement
does not install it on the server. This one-time installation needs separate approval.
Back up the installed receiver before replacing it. Keep the same restricted key and
`Production` approval gate.

The forced command validates archive paths and size, stages production dependencies
for both `server/` and `analysis/`, and checks JavaScript syntax and the library smoke
tests. It compiles and imports the staged Python modules using `TRACETRAY_PYTHON`
from the server environment or `.env`, falling back to `python3`. Missing or incompatible
Python packages stop deployment before live files change; package upgrades remain a
separate operation.

Before changing code, it saves one previous source copy, including extraction and
model code, and a bug-report backup. Failure restores all application code and both
Node dependency directories, then reloads the previous app. Successful deployment
checks connected database/API health and records the deployed SHA in
`/var/www/tracetray/.api-release`.

The deployment preserves `.env`, MongoDB, screenshots, analysis data, logs, Python
dependencies and nginx configuration. It never invokes analysis or paid providers.
Do not use the older `scripts/deploy.sh` to roll out the API: it overwrites environment
files and runtime directories.

Run `python3 scripts/test-deploy-api.py` on Linux with Bash, Node, Python 3.12+,
rsync and flock available. CI runs these isolated success/failure tests against
temporary fixture directories. They do not contact production or run analysis.
