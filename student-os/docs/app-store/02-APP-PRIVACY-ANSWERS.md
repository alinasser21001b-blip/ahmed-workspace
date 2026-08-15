# App Privacy Questionnaire — Prepared Answers

Based strictly on `01-PRIVACY-DATA-MAP.md`. This is preparation for the App Store Connect "App Privacy" questionnaire, not a filled-in submission — the account owner enters these in App Store Connect directly.

## Tracking

**Student OS does not track users**, under Apple's own definition ("linking user or device data collected from your app with data from other companies' apps, websites, or offline properties for targeted advertising or measurement, or sharing data with a data broker"). Evidence: zero third-party SDKs, no advertising identifier reference, no data shared with any external company. **Answer to "Does this app track users?" → No.** Do not request App Tracking Transparency permission — there is nothing to track, and requesting it anyway would be exactly the "ATT merely because Apple has the framework" the brief warns against.

## Data Linked to You

Every row in `01-PRIVACY-DATA-MAP.md`'s table marked "Yes" under **Linked to identity** belongs here:

- **Contact Info** — email
- **User Content** — posts, comments, messages, photos, questions, practice answers
- **Identifiers** — user ID, handle
- **Usage Data** — practice/learning events, analytics events (linked via nullable `user_id` while the account exists)
- **Diagnostics** — none currently collected beyond `sessions.ip`/`user_agent` (see below — this is borderline and should be disclosed either way)

For each: **Purpose** — App Functionality. None of this data is used for Third-Party Advertising, Developer's Advertising, or Analytics-for-advertising purposes — Apple's category for that is separate from ordinary product analytics used to operate the app, and Student OS's `analytics_events` table is read by nothing that serves an ad (there is no ad system in the product at all).

## Data Not Linked to You

`analytics_events` rows **after** an account is deleted (their `user_id` is set to `NULL` on deletion, per `01-PRIVACY-DATA-MAP.md`) — but while the account exists, this data IS linked, so it should be declared under "Data Linked to You" and not double-counted here. There is currently no data collected that is anonymous **at the point of collection**.

## Data Used to Track You

None. See "Tracking" above.

## IP address / User-Agent — flagged for a decision, not resolved here

`sessions.ip` and `sessions.user_agent` are collected at login with no documented retention bound. This is common practice for session security (detecting anomalous logins) but should be declared under **Diagnostics** or **Identifiers** in the questionnaire, and the retention policy should be stated explicitly in the privacy policy rather than left implicit. **This is a decision for the account owner** — either (a) declare it and add a retention statement, or (b) add an explicit TTL/purge job for old session rows and declare a bounded retention. Neither is implemented in this pass; recorded as a follow-up in `07-FINAL-READINESS.md`.

## What NOT to declare

- Location — not collected (no dependency, no API call)
- Contacts — not collected
- Health & Fitness — not applicable
- Financial Info — not collected (no payments in the product)
- Browsing History — not applicable (native app, not a browser)
- Search History — the in-app search query itself is transient (sent as a query parameter, not persisted server-side as a distinct "search history" table — verify this against `apps/api/src/modules/search/` before finalizing if search logging is added later)
