# Android release handoff

## Ready locally

The mobile UI follows the desktop palette, typography, buttons and panels. It includes
remembered System/Light/Dark appearance, compact page navigation, analysis freshness,
single/bulk refresh, confirmed history clearing, the shared desktop advanced tables,
website switching in Journeys/Ask and direct installation-snippet entry points.
Plan and billing is informational: subscription changes happen on the web, with no
checkout/portal links in the app. See [Google's consumption-only guidance](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en).
Deploy the matching `/api/usage` update before checking subscription status/dates and
plan comparisons in production. It reads stored account fields without calling Stripe.

The app feature set is complete for the first release. `app.json` keeps
`com.tracetray.app`, adds the existing TraceTray mark, adaptive/themed icons and a
light/dark native splash. `eas.json` prepares a production AAB with the production
API, Node 22 and locally tracked version codes. The EAS post-install hook builds the
shared web surfaces before Gradle bundles the app. No EAS project, signing key,
cloud build, store upload or submission is created by these files.

Listing copy and artwork live in [store/listing.md](store/listing.md). Declarations
are in [store/declarations.md](store/declarations.md). Both need the final production
checks below before submission.

## What Nic needs to do

1. Finish any developer verification and closed-testing requirement shown in Console.
   TraceTray already exists as `com.tracetray.app`; code 1 is completed on Internal
   testing. Local signed code 2 includes the accepted icon fix and awaits an approved
   upload. Do not recreate the app or upload code 1 again.
2. Production Google hosted authentication is confirmed on Nic's Pixel. Keep the
   Android namespace/package `com.tracetray.app` in the production Clerk setup.
   This installed Clerk SDK uses `clerk://com.tracetray.app.hosted-callback`; its
   Expo plugin already registers that intent filter. Check the production native
   application/redirect settings against that exact callback. Google sign-in here
   uses hosted authentication, not Miscellary's separate native Google client IDs.
   On October 18, the production redirect allowlist was empty; the exact callback
   above is now added and verified through Clerk's Backend API.
   The app also keeps warm Clerk callbacks out of Router navigation so Clerk can
   redeem the session without the sign-in screen unmounting. Cold callbacks open
   sign-in for safe recovery. This uses [Expo's native-intent hook](https://docs.expo.dev/router/advanced/native-intent/);
   it does not alter the original callback consumed by Clerk or skip state/PKCE checks.
   The updated APK passes warm/cold callback checks on the emulator, and Nic confirms
   Google sign-in returns to the dashboard on the Pixel. Password recovery and the
   other phone checks below remain; no password login is expected for an account
   that only has Google configured.
3. Local AAB builds use a separate TraceTray upload key outside Git at
   `C:\Projects\TraceTray\keys\tracetray-upload.jks`, with passwords protected for
   the current Windows user in `tracetray-keystore.xml` beside it. Back up the key
   and recoverable passwords securely and enable Play App Signing. Register any
   certificate fingerprints requested by Clerk/Google using the correct signing
   certificate; Play-distributed builds use Play's app-signing certificate.
4. Provide a dedicated production review account with populated, non-sensitive demo
   data and access to all submitted features. Reviewers must be able to log in from
   any location without asking you for one-time codes. Clerk's local test account
   and `424242` code do not work in production. Keep credentials out of Git; enter
   them only in Play Console's App access section. Resolve device-trust/MFA with
   Clerk's supported account settings, not an application-wide authentication bypass.
5. Run the short phone check below. Send any issue with the screen and steps.

## Deployment and live deletion

The deletion page, server cleanup and Alerts relay are deployed. The ship list
records the disposable-account deletion check as complete. Do not repeat destructive
production QA or use Nic's account to establish it again. Recheck the public URL at
submission and preserve retryable cleanup. Provider/backup retention evidence remains
separate from application deletion; Stripe retains its own financial records.

Read-only server checks on October 18 confirm PM2 rotation at 10 MB or daily with
seven retained compressed files, and nginx daily rotation with 14 archives. This
does not prove that old exports or provider-held logs are gone, or establish the
backup lifecycle; verify those separately during deployment.

## Local phone build

```powershell
powershell -ExecutionPolicy Bypass -File mobile/scripts/build-apk.ps1 -Standalone
```

Use Node 22 (`-NodeExecutable <path>` if needed). This produces the normal
`mobile/android/app/build/outputs/apk/release/app-release.apk`, with ARM64 and x86_64,
bundled JavaScript and the generated **debug** signing key. It is a local QA APK,
not a Play release. It uses the production API by default and needs no Metro server.
Uninstall a differently signed copy first if Android rejects an update.

Phone check (about ten minutes):

- Install/open; check icon, splash and light/dark mode.
- In Account, select Light/Dark/System; restart and check the saved choice and chart theme.
- Check Plan and billing, its web-only message and the installation snippet.
- Sign in with email/password and any required verification. Force close and reopen.
- Sign out, use More sign-in options, complete Google sign-in and return to the app.
  Cancel once and check that sign-in can be retried. Test hosted password recovery.
- Open a populated website, a page, Trends and Attention; scroll, change periods and Back.
- Check Advanced analysis and horizontal table scrolling. Check website switching in
  Journeys/Ask. Analysis runs spend credit; test refresh and clearing through local fixtures
  unless a live run is explicitly approved. Never clear real data merely for QA.
- Check Journeys, goals and account screens. Rotate once and try the keyboard in a form.
- Turn off network briefly: verify a readable failure, then reconnect and retry.
- Use a disposable account for deletion only after the deployment/live-cleanup check is approved.

## Local release bundle

Local release builds are now preferred, following Miscellary's setup. From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File mobile/scripts/build-apk.ps1 -AppBundle -NodeExecutable <path-to-node-22>
```

This rebuilds shared surfaces and bundled JavaScript, signs with TraceTray's separate
upload key and writes `mobile/android/app/build/outputs/bundle/release/app-release.aab`.
Set `android.versionCode` in `app.json` before each new Play upload. EAS also uses local
version sourcing; no EAS project or credit is needed for a local build.

## Cloud fallback

Cloud fallback requires a separate TraceTray Expo project and explicit build approval.

After the preceding checks and separate build approval, from `mobile/`:

```text
eas init
eas credentials -p android
eas build -p android --profile production
```

Review the archive before upload: secrets, debug signing keys, local environments,
server data and QA artifacts must be excluded by the repository `.easignore`.
The AAB is uploaded to internal testing first, then tested through Play on a phone.
Do not use auto-submit. Confirm App access, content rating, target audience, Data
safety, deletion link, listing assets and developer contact details in Play Console.
Complete any required closed testing before applying for production access.

References: [EAS configuration](https://docs.expo.dev/build/eas-json/),
[monorepos](https://docs.expo.dev/build-reference/build-with-monorepos/),
[Clerk production setup](https://clerk.com/docs/guides/development/deployment/expo),
[review access](https://support.google.com/googleplay/android-developer/answer/15748846?hl=en),
[account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).
