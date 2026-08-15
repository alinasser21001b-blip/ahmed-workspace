# App Review Notes

## Demo account

`EXTERNAL_OWNER_ACTION_REQUIRED`: a reviewer needs credentials for an account that has already completed onboarding, so they land straight in a populated app. Do not commit a real password to this file or to App Store Connect notes in plaintext if avoidable — use `apps/api/scripts/seed-demo.ts` (already in the repository, run once against the production database or a dedicated review-account seed) to create a fixed reviewer account, then paste **only that account's email and password** into App Store Connect's private "Sign-In Information" fields at submission time, which Apple does not publish. `seed-demo.ts` creates `@amjad`, `@zainab`, `@omar` with password `correct-horse-battery` — **do not ship this exact password to a public build's demo account**; generate a fresh one for the review account specifically.

## Reviewer journey

A deterministic path a reviewer can follow to exercise every capability named in this readiness pass:

1. **Sign in** with the provided demo account.
2. **Feed** — the home tab shows a ranked feed of cohort content.
3. **Search** — the search tab finds classmates, posts, and groups.
4. **Classroom/group** — `/classrooms` lists the demo classroom; tap in to see lectures and discussion.
5. **Messaging** — the chat tab shows existing conversations from the seed data; send a message to confirm delivery.
6. **Topic / knowledge** — tap any topic badge on a post to reach its topic page, showing collected explanations and provenance.
7. **Practice** — from a topic page with practice available, tap "Check your understanding" and answer a few questions; the Learn tab and the topic page both reflect the resulting signal.
8. **Posting / UGC** — use the compose tab to create a post; attach a photo via the image picker to exercise the photo-library permission.
9. **Report user/content** — open any post or profile that is not your own, tap the overflow menu (⋯), choose "Report", pick a reason, submit. Confirms the report reaches the server (`POST /v1/reports`).
10. **Block** — from another student's profile, open the overflow menu and choose "Block". Confirm the person disappears from your DM composer. Then go to **Settings → Blocked accounts** and unblock them from there.
11. **Privacy** — **Settings → Privacy policy** opens the published policy in the system browser.
12. **Delete account** — **Settings → Delete account**, enter the account's password, type `DELETE`, submit. **Reviewers should be told this is destructive** — recommend using a dedicated, disposable review account for this step rather than the primary demo account, so the rest of the journey remains testable on a future review pass.

## Password reset — present, delivery not yet live

The sign-in screen has a "Forgot password?" link, and the full reset flow (request → server-issued single-use token → set a new password → signed back in) works end to end. **No email is actually sent yet** — no email provider is configured in this build's environment (documented as `EXTERNAL_INFRASTRUCTURE_REQUIRED` in `00-READINESS-AUDIT.md`), so a reviewer who taps it will see the confirmation screen but will not receive a message. This is expected in this build, not a bug to report; it does not block review of any other flow, and the demo account's provided password is sufficient for every other step in this journey.

## Non-obvious feature explanation (for Guideline 2.3.1(a) — "described with specificity")

- **The moderation gate is not visible UI.** It runs silently on every post/comment/message; a reviewer will only see it if they deliberately submit content matching a blocked pattern (e.g. an explicit threat), which returns a clear in-app error rather than posting.
- **"Practice" only appears on topics that have published questions.** Not every topic in the seed data has a practice set attached; the reviewer journey above names one that does.
- **Realtime messaging degrades to polling/refresh on the deployed host** — WebSocket delivery is not guaranteed in the current Netlify Functions deployment. This is a known, documented limitation (`netlify/api/handler.mts`), not a bug the reviewer needs to report.

## What NOT to expect

No AI tutor, no chatbot, no recommendation engine, no adaptive curriculum — none of these exist in the shipped app, and none are referenced in the description or metadata. If the reviewer sees any UI suggesting otherwise, that is a metadata-accuracy bug to be fixed before resubmission, not an undisclosed feature.
