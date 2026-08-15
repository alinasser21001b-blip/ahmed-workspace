# Support Requirements — what the account owner must provide

The app's Settings screen and `GET /v1/support/links` are code-complete and render whichever of these are set; none is currently set in any environment. `pnpm appstore:check` fails the release gate until all four are provided (see the check's placeholder-detection — it also refuses obvious placeholder domains like `example.com`).

| Required value | Environment variable | Used for |
|---|---|---|
| Support URL (a real page, not a mailto link) | `SUPPORT_URL` | Guideline 1.5 — "Make sure your app and its Support URL include an easy way to contact you"; also the App Store Connect "Support URL" metadata field |
| Privacy Policy URL | `PRIVACY_POLICY_URL` | Guideline 5.1.1(i) — required both in App Store Connect metadata and reachable from inside the app |
| Terms of Use URL (if the product has terms) | `TERMS_URL` | Not independently required by Apple unless in-app purchases exist (they do not, currently) but good practice alongside the privacy policy |
| Support email | `SUPPORT_EMAIL` | Shown in-app as a direct contact channel; also usable in App Store Connect's contact info |

## Where these are read

`apps/api/src/platform/config.ts` — optional at the API's env-validation layer (so a missing value never crashes the server for the whole cohort) but required at the release gate (`scripts/appstore-check.mjs`), which is where an iOS build should actually be blocked.

## What the account owner needs to do

1. Stand up a real, reachable privacy-policy page. `PRIVACY_POLICY_DRAFT.md` in this directory is a factual starting draft — legal review is still required before publishing it as the binding policy.
2. Stand up a support contact page or point `SUPPORT_URL` at an existing help-desk/contact page.
3. Set `SUPPORT_EMAIL` to a real, monitored inbox.
4. Set the four environment variables in the API's production deploy config (Netlify environment variables) so `GET /v1/support/links` serves them.
5. Set the same values (or reference the same URLs) when filling in App Store Connect's own "Support URL" and "Privacy Policy URL" metadata fields — those are separate from the in-app values and Apple checks both.
