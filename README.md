# TraceTray

TraceTray is a web analytics tool for tracking how people move through a website.

It records cursor movement, touch movement, clicks, scrolling, pauses, page visits, and session timing. The dashboard groups those interactions into browsing patterns and page-level reports.

## Features

- cursor, touch, click, scroll, pause, and page tracking
- desktop and mobile session analysis
- page tabs for every tracked URL on a website
- client-side route tracking for React, Vue, Angular, Next.js, and other SPA routers
- visitor journeys and recent sessions
- attention and interaction summaries
- multiple website keys per account
- website rename, removal, and key rotation
- root-domain locking for tracker keys
- Clerk authentication with Google sign-in
- light and dark dashboard themes
- Privacy Policy and Terms of Service pages

## Website keys

Each website uses its own TraceTray key.

A key binds to the first root domain that sends valid tracking data. It can then be used across all pages and subdomains on that website.

These share one key:

```text
example.com
www.example.com
shop.example.com
example.com/about
```

A different root domain needs another key.

Do not reuse one key across unrelated websites.

Accounts can keep up to five websites during the beta. Outside beta mode, Starter supports one website and Pro supports up to five.

Removing a website deletes its sessions, analyses, reports, generated feature data, and site key. Removing the last website resets it to `My website` and generates a new key.

## Tracker setup

Add the tracker to each page you want to track:

```html
<script>
  window.TRACETRAY_KEY = "YOUR_SITE_KEY";
</script>
<script src="https://tracetray.com/tracker.js" defer></script>
```

Use the same key on every page and subdomain of one website.

Client-side route changes are detected automatically. History API navigation, browser back and forward actions, and route-style hashes such as `#/settings` start separate page sessions without reloading the tracker.

## Refresh limits

### Refresh this page

- first 3 refreshes each UTC day run immediately
- later refreshes are limited to once every 30 minutes

### Refresh all pages

- limited to once per hour

These limits are enforced by the server.

## Project structure

```text
tracetray/
├── analysis/
│   ├── extractFeatures.js
│   └── featureModules/
├── client/
│   └── tracker.js
├── data/
│   ├── features/
│   └── output/
├── deploy/
│   └── nginx.conf
├── ml/
│   └── analyze.py
├── scripts/
│   └── deploy.sh
└── server/
    ├── public/
    ├── package.json
    └── server.js
```

## Requirements

- Node.js
- npm
- Python 3
- MongoDB
- PM2 for production deployment
- Nginx for production deployment
- Clerk account
- Anthropic API key for generated summaries

## Local setup

Install server dependencies:

```bash
cd server
npm install
```

Create the project environment file:

```bash
cp ../.env.example ../.env
```

Set the required values in `.env`.

Start MongoDB, then run:

```bash
npm start
```

The server uses port `5000` unless `PORT` is set.

## Environment variables

See `.env.example` for the full list.

Main variables:

```text
PORT
MONGODB_URI
CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
ANTHROPIC_API_KEY
TRACETRAY_MODE
```

`TRACETRAY_MODE=beta` keeps beta access enabled and allows up to five websites per account.

## Authentication

TraceTray uses Clerk for authentication.

The sign-in page mounts Clerk's prebuilt sign-in component. Available providers are controlled in the active Clerk instance. Production provider connections must be configured in the Clerk production dashboard.

## Data handling

TraceTray does not record keystrokes, passwords, form values, payment details, or full session video.

Tracked data may include:

- cursor and touch coordinates
- clicks and taps
- scrolling
- pauses
- page and referrer URLs
- session timing
- device category
- short labels from clicked elements

Website owners are responsible for providing any notice or consent required for their visitors.

See:

```text
https://tracetray.com/privacy.html
https://tracetray.com/terms.html
```

## Deployment

The deployment script uploads the project, installs server dependencies, updates Nginx, and restarts the PM2 process.

From the project root:

```bash
bash scripts/deploy.sh
```

The production server expects TraceTray at:

```text
/var/www/tracetray
```

## Validation

Before deployment:

```bash
bash -n scripts/deploy.sh
node --check server/server.js
node --check client/tracker.js
node --check analysis/extractFeatures.js
python3 -m py_compile ml/analyze.py
```

## Status

TraceTray is in beta.

Current work includes tracking, dashboard reporting, multiple website management, domain-locked keys, Clerk authentication, legal pages, and production deployment.
