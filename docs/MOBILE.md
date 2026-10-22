# TraceTray Android

## Initial inspection (Oct 16, 2026)

The Oct 14 dashboard foundation deliberately prepared for an Expo app. There was no
mobile workspace, native screen implementation, Android project or release configuration
yet. Main was at e184843 and was clean when inspected.

## Current checkpoint

The `mobile` workspace now runs on Expo 58, React Native 0.88 and React 19.3.1. It has
native email/password sign-in, device-trust email verification, authenticator-code
support, secure sessions, remembered website selection, searchable pages and basic
page overviews with visits, engagement, goals and inactive-visit rates. Hosted sign-in
remains available for other methods. The existing server handles all account/site
ownership checks; no server changes were needed.

A local x86_64 debug APK built and ran in the offscreen Android 15 emulator. Real
development Clerk login and verification, session persistence, both QA websites,
page search, individual/grouped page summaries, Android back, light/dark themes and
sign-out passed. The emulator's Chrome 124 crashes on the hosted Clerk page, so Google
sign-in and browser recovery remain unverified. No real-phone or production-auth test.
See `mobile/README.md` for local builds and the remaining tooling audit findings.

Reuse `packages/shared` for API types, `createApi` and formatting. Its API client already
accepts a base URL and sends Clerk bearer tokens. Keep the existing server and website
ownership checks. Ordinary screens use native views. Complex charts reuse bundled web components; the
shared data layer does not need replacing.

Use Expo and React Native in a `mobile` workspace, with Expo Router and Clerk's Expo SDK.
Choose compatible stable package versions together when scaffolding. Preserve the
dashboard's typography, colours, visitor group names and goal-first presentation.

## Direction checked against the other apps

Inspected Miscellary's mobile README, build-out plan, package/config files, root and tab
layouts, session/API code, theme helpers, shared surface and Windows APK script. Also
checked Portlore's Capacitor configuration, Android guidance and build notes.

Miscellary uses Expo SDK 54, React Native 0.81.5, React 19.1 and Expo Router 6. It combines
native navigation and ordinary screens with locally bundled web components for complex
visual surfaces. Portlore packages its existing HTML/JavaScript client with Capacitor 8
and adds native location and reminders. Both approaches already have local build paths.

Follow Miscellary's Expo/React Native structure for TraceTray:

- Reuse the patterns for stack/tab navigation, safe areas, fonts, themed native controls,
  environment-specific API origins and explicit loading/error states. Keep TraceTray's
  npm workspaces and styling; adopting pnpm/Turbo is unnecessary for this app.
- Keep authentication with Clerk's Expo SDK and its SecureStore token cache. Miscellary's
  custom refresh-token rotation and Google sign-in implementation belong to its own API
  and should not be copied into TraceTray.
- Use shared TypeScript for contracts and product rules. Assess Chart.js charts and
  attention overlays for bundled web reuse before committing to separate renderers.
  Miscellary demonstrates that selected web surfaces can sit inside native navigation;
  they need a small, restricted bridge and Android testing. Use native views for ordinary
  lists, controls and cards. Never add one WebView per list item.
- Adapt the local APK workflow: generated Android project, suitable JDK/CMake, Metro
  workspace resolution, and signing credentials outside Git. TraceTray's path has no
  spaces, so Miscellary's Hermes relocation workaround may be unnecessary. Start with
  local debug signing; do not import Miscellary's key or query its EAS project/version.
- Reserve EAS for approved release builds. Use separate TraceTray identifiers, signing
  credentials and release configuration. No camera, photo, billing or notification
  packages unless an actual TraceTray feature needs them.

TraceTray web now uses React/React DOM 19.3.1, React 19 types and react-chartjs-2 5.3.1.
A clean install resolves one React runtime, and desktop/phone headless checks passed
with real development Clerk sign-in and dashboard charts. Verify React and Metro
resolution again when adding Expo: each Expo SDK requires a particular React version,
so sharing major version 19 does not by itself establish compatibility. Do not blindly
copy Miscellary's SDK versions or its pnpm-specific Metro overrides. Run web validation
alongside the first mobile bundle to catch effects on the deployed dashboard.

## Build order

1. Establish the runnable app: configuration, secure Clerk session storage, sign-in,
   sign-out, API provider, website switcher and page list. Verify real development-instance
   authentication against Docker before building the rest. Android emulator requests go
   to the host through `10.0.2.2`; physical phones need a reachable development server.
2. Build the main dashboard: visits, engagement, goal rates and trends, visitor groups,
   traits and suggestions. Include page groups and their individual page lists. Handle
   loading, empty accounts, expired sessions, connection failures and plan limits.
3. Add Attention with authenticated page pictures and overlays, Trends, Journeys and
   recent Sessions. Port the current analysis display rules, including visitors behaving
   alike and missing measurements. Check authenticated image loading on Android rather
   than assuming the web blob/object-URL approach transfers.
4. Add Ask and contextual questions, website and goal management, usage, bug reports,
   account controls and legal links. Ask verification must use fixtures unless Nic
   approves a paid call with an estimate.
5. Complete Android polish: safe areas, keyboard handling, back navigation, accessible
   controls, light/dark themes and refresh. Build a local APK and check on an emulator,
   then Nic's phone. Finish Play listing, screenshots, data safety and release signing.

## Release questions to resolve early

- Account lifecycle: the full deletion flow is implemented locally, including in-app
  and web entry points. Verify it with a disposable production account and subscription
  before release; register `/delete-account` as the Play deletion URL after deployment.
  Provider-held support alerts now have an erasure path implemented locally. Deploy
  the updated relay/nginx first, verify bot history permissions, then deploy TraceTray.
  Confirm provider cleanup and operational-log retention before declaring compliance.
- Subscription access: start as a dashboard for existing customers. Verify current Play
  policy before including checkout, upgrade links or billing-portal links. The web's
  Stripe flow must not be copied into Android without that review.
- Clerk production setup: verify mobile callbacks, Google sign-in and production token
  validation. Development sign-in passing does not establish production readiness.
- Android identity and signing: confirm the application ID before the first Play upload;
  preserve and back up the chosen upload key. No keys or passwords in Git.
- Google Play account and closed testing remain Nic's tasks. Development can proceed
  while those are being arranged. Publication dates depend on each app's approval.

## Validation and release boundaries

Keep web type-check/build passing when adding the workspace. Test API ownership,
authentication failures and account lifecycle changes where server behaviour changes.
Use deterministic fixtures for native UI checks; never run paid Ask requests implicitly.
Local Android test builds come first. Obtain approval before paid services, commits,
pushes or deployment. Report emulator and real-device checks separately.

References checked during planning:

- https://docs.expo.dev/guides/local-app-overview/
- https://docs.expo.dev/build-reference/build-with-monorepos/
- https://clerk.com/docs/expo/getting-started/quickstart
- https://docs.expo.dev/guides/monorepos/

## Next checkpoint

The foundation and native visitor-group checkpoints are complete locally. Group cards,
goal comparisons, trait bars, suggestions and analysis display rules now share logic
with web. Native tests also found and fixed an API-client identity change that reset
navigation when Clerk re-rendered. Visits/goals/behaviour trends and searchable page-group members are also complete
locally. Trends use the actual web chart components in one locally bundled WebView,
with native data fetching and no authentication or network bridge. Weekly goal bars
now reveal values when tapped, on web and Android. Android 15 checks cover actual demo
charts, group search/sorting, light/dark changes, scrolling and back navigation. Headless
fixtures cover empty/missing measurements, hostile goal names and network isolation.

Attention, Journeys and recent visits are also complete locally. Attention reuses web
pictures/overlays with authenticated native image loading; desktop and phone pictures,
goal/reach lines, independent picture scrolling, themes and refresh/back passed on
Android 15. Native journey rankings and recent-visit cards also passed; an unowned-site
deep link shows an error before requesting its data. Shared fixtures cover picture
fallback, cropping, phone-only/empty states, escaped text and network isolation.

Native Ask is complete locally, using shared answer formatting/history rules and a
fixture API that blocks paid routes. Android 15 checks cover prefilled questions,
formatted answers/lookups, follow-ups, duplicate taps, retry/limit states, conversation
reset, unowned websites and leaving pending requests. Keyboard avoidance and scrolling
were corrected during these checks. No live model call or physical-phone test.

Account usage, legal links/sign-out and native problem reports are complete locally.
The emulator shows actual usage; report validation, category selection, cleaned
page context, keyboard handling, failure/retry, duplicate taps and success are checked
through fixtures. No support alerts are sent. Unit tests cover production allowance
math (including zero/unlimited) and report size/privacy rules; production account
states and opening legal links in a real browser remain unverified.

Website management is complete locally: add/rename/remove, plan limits and installation
code selection/sharing. Account and the website picker both open management; empty
websites link directly to installation. Changes update selection without unmounting
navigation. Android 15 fixture checks cover add failure/retry, rename, removal
cancellation/confirmation, last-site replacement, persisted selection, installation
ownership and the Android share sheet. Website mutations never reach Docker during QA.
Live website mutations and physical-phone copying/sharing remain unverified.

Native goal management is complete locally: click/page/form creation, page scope,
name/target edits, removal confirmation and main-goal selection/clearing. Descriptions
and target validation live in shared code; web also uses the shared descriptions.
Page/list screens refresh on return; pending past-visit checks poll while the list is
focused. Android 15 fixtures cover all three creation types, search, invalid targets,
failure/retry, duplicate taps, limits, main selection, edits, removal and site guards.
Real goal mutations/backfills and physical-phone checks remain unverified.

Startup links now survive configuration/auth restoration. Root navigation stays mounted
while loading runs beneath it; an Android prebuild plugin retains the newest intent
before JavaScript starts. Home remains behind linked screens for Back navigation.
A fresh x86_64 debug APK passes Android 15 checks for links before JavaScript, the
latest link during an eight-second configuration delay, configuration failure/retry,
cold unowned-site guards, sign-out/sign-in and Back to Home. No '__root' navigation
errors appear. Production authentication, hosted callbacks, real phones and actual
notification-provider delivery remain unverified.

Native email preferences are complete locally. Account opens switches for weekly
summaries and behaviour-shift alerts, using shared web/app wording. Unavailable options
stay disabled; a pending save blocks duplicate changes and refresh. Android 15 fixtures
cover enabling/disabling, failed saves/retry, duplicate taps, reopening saved settings,
limited-plan controls and initial read failure/retry. No real subscription changes or
email sends run during these checks. Physical-phone and production-plan checks remain.

Account deletion now has native and web confirmation screens, plus the public
`/delete-account` resource for the Play listing. A durable server job closes access,
cancels Stripe subscriptions, expires open checkouts and removes website data,
screenshots, account-linked reports and the Clerk identity. Failures retry; a receipt
remains for 30 days. Tracking caches and active collection, screenshots and analyses
drain before cleanup. Late checkout webhooks cannot activate a deleted account.
Native fixture checks cover confirmation, save failure/retry and cold reopening.
Provider cleanup now persists Discord scan progress and blocks final deletion until
matching bot alerts are erased. Requests already in flight drain before cleanup.
Accounts with historical alerts must keep the relay configured during deletion;
unconfigured installations skip it. Tests mock provider responses and verify a local
client/relay round trip, permissions, app isolation, failures and resumable progress.
Provider calls and destructive database cleanup are tested with mocks only. A real
disposable-account deletion with production billing/auth remains a release check.

Before/after comparisons and page change notes now have a native flow. Page overview
opens it; users can mark a UTC date with an optional note, select a change and remove
notes without removing visit history. Shared web/app rules preserve metric formats,
neutral click/scroll changes and engagement verdict thresholds. Native cards show
main-goal verdicts, visitor groups, low-sample warnings and phone-share changes.
Fixture writes stay in memory. Emulator and build validation are recorded in the
local changelog; real change mutations and physical-phone checks remain unverified.

Expected paths now have a native screen from Journeys: choose 2–6 ordered pages,
reorder steps, name/save paths and confirm removal. Periods cover 7/30/90 days;
native cards show journey counts, drop-offs and device splits. Web/app share ratio
calculations. Empty/error/plan/limit fixture coverage and validation are tracked in
the local changelog; real path writes and physical-phone checks remain unverified.

Goal form selection now follows form identity when refreshed lists reorder. Page/form
load failures stay beside their picker with a retry control; empty lists explain how to
start collecting data. Restricted form goals remain disabled.
Group pagination returns to the group heading and recovers when page counts shrink.
Android fixture checks cover 58 members, search, sorting, periods, retry, empty groups
and restricted-plan previews. These checks simulate plan responses; production plans,
physical-phone and production-auth checks remain outstanding.

Release preparation now includes app/adaptive/themed icons, a native light/dark splash,
production EAS configuration, a standalone debug-signed phone APK, listing copy/artwork
and four seeded-demo screenshots. The local EAS archive excludes secrets, native outputs
and server data. See mobile/RELEASE.md for account/setup and submission steps.

Nic confirms production Google sign-in returns to the dashboard on the Pixel after
the Clerk allowlist and native callback routing fixes. Remaining phone checks cover
session reopening, password recovery, dashboard views and network recovery.

Next: approved deployments and live deletion, review credentials, Play declarations,
separate signing and an approved EAS AAB.
