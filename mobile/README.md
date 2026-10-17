# TraceTray mobile

Expo 58 / React Native 0.88 with Expo Router, Clerk native email sign-in and secure token
storage. The app uses `@tracetray/shared` and the existing server. Its current screens
cover website selection, page search and page overviews with visits, goal rates,
desktop/mobile visitor groups, trait comparisons, evidence-based suggestions, searchable
page-group members, visits/goal/behaviour trends, Attention pictures/overlays, journeys
and recent visits. Ask supports native questions/follow-ups and page context, with shared
answer formatting.

## Development

Use Node 22.13+ (22 LTS recommended), JDK 21 and the Android SDK. Install dependencies
from the repository root with `npm ci`. Start the existing Docker stack first.

```powershell
npm run dev:mobile
```

Development finds the API at Metro's host on port 5000, falling back to
`http://10.0.2.2:5000` for the Android emulator. To choose another address, set
`EXPO_PUBLIC_API_URL` in `mobile/.env`; see `.env.example`. A phone needs the PC's LAN
address and access to ports 5000 and 8081. Restart Metro after changing the address.
The app reads the matching Clerk publishable key from the server's public config;
never copy a Clerk secret key into the mobile environment.

Clerk's Native API must be enabled on the matching Clerk instance. Native sign-in handles
email/password, device-trust email codes and authenticator codes. More sign-in options
opens Clerk's hosted page for other methods, including Google, and returns through the callback
registered by the Clerk Expo plugin. Register `com.tracetray.app` in Clerk's native
application settings before testing production authentication.

## Ask checks without model charges

Start Docker, then run `npm run fixtures -w mobile` in a separate terminal. This local
API listens on `127.0.0.1:5001`; it forwards selected dashboard reads/account lookup to
Docker and mocks every Ask request. Other writes, including analysis and checkout,
are blocked. The tests verify that paid routes never reach the upstream API.

For the Android emulator, start Metro with `EXPO_PUBLIC_API_URL=http://10.0.2.2:5001`.
Use the normal development Clerk login. Ordinary questions get a deterministic answer;
`Fixture retry` fails once, `Fixture limit` returns a monthly limit, and `Fixture delayed`
waits five seconds. `GET /__fixtures` exposes only the fixture questions/history in memory
so duplicate submissions and follow-ups can be checked. Stop the fixture API and clear
the environment override after QA. The fixture server is never imported into the app.

Starter questions and page-context links prefill text and wait for an explicit submission. Conversation
history stays in memory, resets for a different website, and sends at most the last three
answered questions. Retries exclude failed/pending turns. No live model call has been
used to validate the mobile flow; production responses and physical phones still need QA.

## Shared web views

The Trends screen bundles the same `TrafficPanel`, `GoalTrendChart` and `TrendCharts`
components used by the website, including Chart.js, CSS and Instrument Sans. Native code
fetches owned-site data through Clerk and passes only display data and the theme into one
WebView. The surface has no API bridge, session tokens, remote assets or network access;
its messages only report readiness, height and display failures. Navigation is blocked.

Attention also bundles the existing `AttentionContent` and `PagePicture` components.
Native code fetches authenticated pictures and converts the image blobs to in-memory
data URLs; the WebView never receives the Clerk token. Image types/size are checked,
and picture failures leave the measurements available with a refresh prompt. Long
pictures scroll independently inside the normal page view.

`npm run surfaces -w mobile` regenerates the ignored `mobile/generated/*.json` files.
Development, type checks, exports and APK builds run it automatically. Restart development
or rerun that command after editing shared chart components or styles. Native and DOM
surface types are checked separately. Adding WebView requires a fresh local APK once.
Weekly goal bars support tapping/keyboard selection on web and Android.

## Local APK

```powershell
powershell -ExecutionPolicy Bypass -File mobile/scripts/build-apk.ps1
```

Use `-NodeExecutable <path-to-node.exe>` if the supported Node runtime is outside PATH,
and `-Architectures x86_64` for an emulator-only build. The script generates `android/`,
sets local SDK/CMake paths, and builds a debug APK at
`mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Debug builds use a development
key, need Metro running, and are not Play releases. For a connected Android emulator:

```powershell
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
adb shell am start -n com.tracetray.app/.MainActivity
```

Install Android platform 37.0, build-tools 37.0.0, NDK 27.1.12297006 and CMake 3.31.6.
The current Android CLI names the platform package `platforms/android-37.0`;
`platforms;android-37` is not available. Keep Android source generated; configure native
changes in `app.json` or a config plugin. No production upload key exists yet.

## Checks

```powershell
npm run check:mobile
npm test -w mobile
npm run build:mobile
npm run build:web
```

The Android export verifies bundling; it is not an APK or device test. React 19.3.1 is
retained rather than Expo's baseline 19.3.0; React Native accepts the patched version.
Expo's version check excludes React and the matching DOM runtime/types used to build
the shared views for that reason. Mobile uses Expo's recommended
TypeScript 6, while the web workspace retains its own TypeScript version.

Release builds will use EAS with approval and separate TraceTray signing credentials.
The production API defaults to `https://tracetray.com`; release configuration rejects
HTTP origins. Account deletion, subscription policy, store assets and real-phone QA
remain release work. The full build plan is in [MOBILE.md](../docs/MOBILE.md).

## First emulator check (Oct 16)

Local x86_64 debug APK built and installed on Android 15. Real Clerk development login,
device verification, cold-start session persistence, both QA websites, page search,
single/grouped page overviews, Android back, light/dark themes and sign-out passed.
Hosted sign-in opened correctly, but the emulator's Chrome 124 renderer crashed on the
Clerk page; Google and browser-based recovery still need a current browser or real-phone
check. No production sign-in, real-phone test, paid API call or EAS build has run.

The npm audit currently reports 27 entries stemming from three unresolved transitive
issues: braces in Metro, node-forge in Expo CLI signing tooling, and uuid in xcode.
Compatible automatic fixes do not resolve them; no forced upgrades or overrides were
applied. The website's Docker/deploy installs select only the web/shared workspaces.
