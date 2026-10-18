# Play declarations - review draft

Prepared October 18, 2026 from the native app, Clerk SDK and server code. Nic must
confirm the production SDK/provider and retention settings before submitting.
This is a submission worksheet, not a claim that Play has approved the app.

## Access and purchases

- Sign-in required. Supply production review credentials through Play Console;
  see [RELEASE.md](../RELEASE.md). Do not submit the localhost Clerk test credentials.
- Existing-customer dashboard. No in-app purchase SDK, checkout, upgrade or billing
  portal link is exposed. Plan-restricted features explain availability.
- Hosted authentication and legal pages still need a final navigation check to
  ensure no purchase flow becomes available inside the app.
- No ads, advertising ID, push notifications, location, contacts, camera or media
  library feature is implemented. APK permissions must agree before upload.
- Suggested category: Business. Intended for website owners, not a children's app.
  Complete the actual target-audience and content-rating questionnaires in Console;
  do not invent an age rating before their result.

The consumption-only direction follows [Google's payments guidance](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en).

## Data inventory

These are candidate Data safety categories, not preselected Console answers.
Data displayed from customers' tracked websites is distinct from data collected
from the Android user. Do not blindly copy every web-tracker field into the app form.
Include collection by hosted sign-in, native SDKs and backend requests.

| App flow / candidate category | What happens | Purpose / choice |
| --- | --- | --- |
| Sign-in / email, user IDs | Email, Clerk account/session identifiers and authentication requests reach Clerk and TraceTray. Tokens/preferences remain in Android SecureStore; account records persist on the server. | App functionality, account management and security. Required for signed-in use. |
| Connected sign-in / name, profile photo | Google/Clerk can supply profile information according to production provider settings. Confirm exactly what Clerk retains, including optional fields. | Account management; depends on chosen sign-in method. |
| Authentication / device or other IDs | Clerk manages device/session identifiers, browser/native user-agent and security requests. Confirm current SDK telemetry and retention. Password/code input is sent to Clerk over TLS, not stored by TraceTray's application code. | Authentication and fraud prevention. Required for the selected method. |
| Ask / other user-generated content | Questions, limited conversation context and selected-site analytics are processed by TraceTray and Anthropic. The server persists account-level question counts, not a conversation archive. Check provider retention separately. | App functionality; optional, only when submitted. |
| Reports / other user-generated content | Submitted description/category, website/page context, account/email and user-agent are saved in the report database. Relevant report text/context is sent to the private Discord alert relay. | Support; optional, only when submitted. |
| Requests and failures / diagnostics, app interactions | Backend logs can include request metadata, identifiers, errors and feature usage. Errors may be relayed to Discord. No mobile advertising or general analytics SDK is intentionally added. Confirm what production logs and Clerk actually retain. | Service operation, security and troubleshooting. |
| Existing subscription / purchase history | The app fetches plan/usage state from the existing account. No payment card entry or new transaction happens in the native app. Determine whether the actual transmitted purchase/subscription fields fall within the form's purchase-history category. | App functionality; account-dependent. |

For each applicable category, answer collected/shared, purpose, optional/required
and ephemeral processing from the actual production behavior. Service-provider
processing may qualify for a sharing exception only when Google's conditions are
met; sending data to a provider does not automatically justify either answer.
Do not mark Ask or diagnostics ephemeral solely because this app has no chat archive.
Review free-text content handling too: users can include personal data in questions
and reports even though the app does not request it.

Use [Google's Data safety definitions](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
and the installed providers' actual data practices. Reassess if an SDK or app flow changes.

## Security and deletion

- Production API and authentication use HTTPS. The app rejects HTTP API origins in
  standalone builds; sensitive credentials use SecureStore. This is encryption in
  transit, not a claim of end-to-end encryption.
- In-app path: Account > Delete account > type DELETE > confirm. Web resource:
  `https://tracetray.com/delete-account`. It must be deployed and checked before submission.
- The prepared job cancels active billing/checkouts and removes account/site data,
  files and matching bot alerts before deleting the Clerk identity. Failures retry.
- The current privacy/terms promise a 30-day deletion receipt and expiring backups;
  payment records and operational logs have separate retention. Confirm actual
  backup/provider/log settings and live erasure before making corresponding answers.
- No independent security audit/certification is claimed.

[Privacy policy](https://tracetray.com/privacy) ·
[Google deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)

## Remaining evidence

- Google profile fields and provider data handling. Production Google hosted sign-in
  returns to the dashboard on Nic's Pixel; the Android callback is allowlisted.
- Final signed APK/AAB permissions and SDK inventory.
- Live disposable-account deletion, alert erasure and backup/log retention.
- Nic's final Data safety, target-audience and content-rating answers in Play Console.
