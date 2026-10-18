# Android release handoff

## Ready locally

The app feature set is complete for the first release. `app.json` keeps
`com.tracetray.app`, adds the existing TraceTray mark, adaptive/themed icons and a
light/dark native splash. `eas.json` prepares a production AAB with the production
API, Node 22 and increasing version codes. The EAS post-install hook builds the
shared web surfaces before Gradle bundles the app. No EAS project, signing key,
cloud build, store upload or submission is created by these files.

Listing copy and artwork live in [store/listing.md](store/listing.md). Declarations
are in [store/declarations.md](store/declarations.md). Both need the final production
checks below before submission.

## What Nic needs to do

1. Finish Play developer verification and any closed-testing requirement shown in
   your Console. Create TraceTray as an app and confirm `com.tracetray.app` before
   the first upload; the published package cannot later be renamed.
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
3. Choose the Expo account/organization for TraceTray. After approval, link a new
   TraceTray project from `mobile/`, retain its project ID and create separate
   TraceTray upload credentials. Do not reuse Miscellary's project or signing key.
   Back up the upload key securely and enable Play App Signing. Register any
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

Approval is still needed to push/deploy the prepared server changes. Deploy the
alerts relay and its authenticated nginx `/erase` route first, verify channel-history
permissions, then deploy TraceTray. Do not compare `.env` hashes; Nic intentionally
maintains different local environment values.

Verify `https://tracetray.com/delete-account` returns the deletion page (it was 404
on October 18). With an explicitly disposable production account, verify deletion
closes API access, cancels subscriptions/checkouts, removes site data/files, clears
matching bot alerts and deletes the Clerk identity. Failure must remain retryable.
Do not use Nic's account, a real customer account or the permanent review account.
Check that the backup/log retention described in the privacy policy matches actual
server/provider configuration. Stripe transaction retention is separate.

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
- Sign in with email/password and any required verification. Force close and reopen.
- Sign out, use More sign-in options, complete Google sign-in and return to the app.
  Cancel once and check that sign-in can be retried. Test hosted password recovery.
- Open a populated website, a page, Trends and Attention; scroll, change periods and Back.
- Check Journeys, goals and account screens. Rotate once and try the keyboard in a form.
- Turn off network briefly: verify a readable failure, then reconnect and retry.
- Use a disposable account for deletion only after the deployment/live-cleanup check is approved.

## Approved cloud release

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
