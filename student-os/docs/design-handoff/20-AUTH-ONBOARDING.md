# Auth, onboarding, session

## Sign in

**Route** `app/(auth)/sign-in.tsx`
**Purpose** The shortest real path into the product.
**Primary user question** "Let me in."
**Dominant action** Sign in.
**Secondary actions** Create one (link to sign-up).

**Source repo files** `app/(auth)/sign-in.tsx`, `packages/contracts/src/auth/auth.contract.ts`, `src/state/session.tsx`.
**Required data** email, password.
**Unsupported data** SSO, magic link, biometric unlock, remember-me toggle, phone auth, password strength meter on sign-in.

**Hierarchy** title "Sign in" → "Your university email. Student OS is closed to your college." → email → password → Sign in → create-account link → a closing note on error handling.

### Error mapping — three distinct messages

`messageKeyFor` maps server codes to keys. Never show the server's English text raw.

| Condition | Message |
| --- | --- |
| bad credentials | "That email and password do not match" |
| account suspended (`accountStatus`) | "This account is suspended. Contact your college administrator." |
| offline / unreachable | "You are offline. Sign in needs a connection." |
| rate limited | "Too many attempts. Try again in a few minutes." |

Collapsing these into one generic failure is the defect this table exists to prevent.

**Behaviour** · email and password fields are `forceLTR` with leading alignment in both languages — the label above is Arabic, the field is not · keyboard: `emailAddress` then `password` content types, submit on the password field's return key · the error attaches to the field that caused it (credentials → password) · Sign in shows a spinner at held width; the form is inert while in flight · no auto-advance, no auto-submit · accessibility: errors are polite live regions; the password field never has its content announced.

**Status** SUPPORTED_NOW.

## Sign up

**Route** `app/(auth)/sign-up.tsx`. Fields: email, password (`passwordSchema` rules stated **under the field before submission**, not as an error after), locale (defaults `'ar'` per the contract — do not ask, and do not default to English). On success the account exists but `onboardingCompleted` is false, so the router sends it straight to onboarding. **Status** SUPPORTED_NOW.

## Forgot password

**Route** `app/(auth)/forgot-password.tsx`
**Purpose** Get a reset on its way without confirming to a stranger whether an account exists.
**Primary user question** "I cannot get in."
**Dominant action** Send reset link.
**Secondary actions** Back to sign in.

**Source repo files** `app/(auth)/forgot-password.tsx`, `app/(auth)/sign-in.tsx` (the entry link), `packages/contracts/src/auth/auth.contract.ts`, `apps/api/src/modules/auth/{auth.routes,auth.service,tokens}.ts`, `apps/api/src/platform/mailer.ts`, migration 0016.
**Required data** email.
**Unsupported data** security questions, SMS or phone recovery, "remember this device", an in-app resend timer the API does not expose, any indication of whether the address is registered.

**Entry** The `auth.forgotPassword.link` control ("Forgot password?") sits under the password field on sign-in, as a text link at body size — never a button, and never competing with Sign in for the dominant action.

**Hierarchy** title `auth.forgotPassword.title` ("Reset your password") → subtitle `auth.forgotPassword.subtitle` → email field → Send reset link → `auth.backToSignIn`.

**The sent state replaces the form, on the same route.** Not a pushed screen and not a dialog: title `auth.forgotPassword.sent.title`, body `auth.forgotPassword.sent.body`, then `auth.backToSignIn`. The submit control is removed once sent, so the same request cannot be fired repeatedly against a rate limiter the UI cannot see.

**Standardised copy — capability-neutral.** The mail may carry a link, a code, or both, and this specification does not assert which. Both screens say **"reset link or code"**, so the copy is true in every case and needs no revision when the mail template changes.

| Key | String |
| --- | --- |
| `auth.forgotPassword.sent.title` | "Check your email for a reset link or code." |
| `auth.forgotPassword.subtitle` | Keep as shipped, with "link" replaced: "Enter your email and we'll send you a reset link or code." |

Arabic follows the same neutrality — one phrase covering both, never a translation that names only one.

**This state is identical whether or not the address exists**, and that is the point — the copy already says "If an account exists for that email address". Never branch it, never show "no account found", never vary the timing to hint at existence.

| Condition | Message |
| --- | --- |
| any submission with a syntactically valid email | the sent state — never a success/failure distinction |
| malformed email | inline on the field, before submission |
| offline / unreachable | "You are offline. Sign in needs a connection." — reuse the sign-in string; do not write a second one |
| rate limited | "Too many attempts. Try again in a few minutes." — reuse the sign-in string |

**Behaviour** · the email field is `forceLTR` with leading alignment in both languages, as on sign-in · `emailAddress` content type, submit on the return key · the control shows a spinner at held width and the form is inert in flight · no auto-navigation away from the sent state · accessibility: on transition to the sent state, focus moves to its title and the body is announced once as a polite live region.

**Status** SUPPORTED_NOW.

## Reset password

**Route** `app/(auth)/reset-password.tsx`
**Purpose** Exchange a reset token and a new password for a usable account.
**Primary user question** "Let me set a new one."
**Dominant action** Set new password.
**Secondary actions** Back to sign in.

**Source repo files** `app/(auth)/reset-password.tsx`, `packages/contracts/src/auth/auth.contract.ts`, `apps/api/src/modules/auth/tokens.ts`, migration 0016.
**Required data** reset token, new password.
**Unsupported data** a confirm-password second field (the rules are stated, the field is not doubled), password strength meter, "log out other devices" toggle, the old password.

**Hierarchy** title `auth.resetPassword.title` ("Choose a new password") → subtitle `auth.resetPassword.subtitle` → `auth.resetPassword.token` field ("Reset code") → `auth.resetPassword.newPassword` field with `auth.password.hint` ("At least 10 characters") stated **under the field before submission**, exactly as sign-up states `passwordSchema` → Set new password → `auth.backToSignIn`.

**Standardised subtitle.** `auth.resetPassword.subtitle` = **"Open the reset link, or enter the reset code manually."** It names both paths in the order people meet them, and it matches the behaviour below exactly: the deep link fills the field, and typing or pasting stays available for anyone who came back to the app by hand. The field label `auth.resetPassword.token` stays "Reset code" — it labels the field, which only ever holds a code.

**Token field** `forceLTR`, `autoCorrect` off, no auto-capitalisation. Pre-filled and read-only when the route is reached through the deep link (`scheme: studentos`); typed when the person came back to the app by hand. Both paths must work — the copy tells them to paste, so pasting must be possible.

| Condition | Message |
| --- | --- |
| token invalid, expired or already spent | `auth.error.resetTokenInvalid` — "That link is invalid or has expired. Request a new one." Attaches to the token field, with the forgot-password route reachable in the same region |
| password fails `passwordSchema` | inline under the password field, phrased as the rule, not as a rejection |
| offline / rate limited | reuse the sign-in strings |

**On success** the person lands on sign-in and signs in with the new password. Do not auto-authenticate: a reset is the one moment where proving the new credential works is worth one extra step, and the server has revoked the sessions this reset invalidated.

**Behaviour** · the password field is `secureTextEntry` with `newPassword` content type so the keychain offers to save it · Set new password is inert until both fields are non-empty · the form is inert in flight · a failed submission keeps the token and clears the password · accessibility: errors are polite live regions and the password field's content is never announced.

**The "link versus code" inconsistency is resolved**, and resolved without asserting anything about `mailer.ts`: both screens now say "reset link or code", which is accurate whether the mail carries one or both. No behaviour changes — deep-link pre-fill and the typed/pasted path are exactly as specified above.

**Status** SUPPORTED_NOW. Both screens ship; this is their first visual specification, written in the frozen auth grammar with no new direction.

## Onboarding — five steps, because placement is five decisions

**Route** `app/(onboarding)/index.tsx`
**Purpose** Turn an account into a cohort member.
**Dominant action** Continue / Finish.

Steps 1–4 are single-select lists: **university → college → programme → stage**. Each fetches only what the previous choice reaches. They need no design beyond a progress row, a title, and AcademicRows. Step 5 is the only form: display name, handle, interests.

`completeOnboardingRequestSchema` is validated as a unit — a half-filled academic context puts a user in a feed scope that does not exist — so **the request is sent once, at Finish**, not per step.

### Step 5 specifics

- **Handle** — `handleSchema` rules stated under the field ("Lowercase letters, numbers and underscore. 3 to 30 characters."), debounced availability against `handleAvailability`, teal confirmation line on success. `forceLTR`.
- **Display name** — accepts Arabic; no transliteration, no romanisation.
- **Interests** — ChipPicker over the stage's topics, `interestTopicIds` max 20. Copy states what they affect: "Changes what your feed classifies to." Asked **because the field is real**.
- **Finish** is inert until a display name exists and the handle is confirmed available.

**Not asked, because they do not exist:** learning goals, specialty, study hours, diagnostic questionnaire, notification preferences, avatar upload (`avatarUrl` is updatable later via `updateProfileRequest`, but no upload flow is designed here).

**Behaviour** · back is available from steps 2–5 and preserves earlier choices; back from step 1 exits to sign-in · a failed Finish keeps every entered value · offline: Finish inert with a banner; no partial submission · RTL: the progress row fills from the trailing edge · accessibility: the step position is in the title's accessibility label ("Step 5 of 5, your name and handle"), so a screen-reader user is not left counting dots.

**Status** SUPPORTED_NOW.

## Session states

```
signed_out ──▶ signing_in ──▶ authenticated ──▶ (onboarding_required) ──▶ app
     ▲              │                │
     │              └── failure ─────┘
     │                               │
     └── session_expired ◀───────────┘
              ▲
     restoring_session ──▶ authenticated | signed_out
```

| State | UI |
| --- | --- |
| `restoring_session` | `app/index.tsx`: the product wordmark on paper, no spinner for the first 400 ms, then a quiet inline "Signing you in". A splash that flashes is worse than a still frame. |
| `signing_in` | Sign in control busy, form inert |
| `onboarding_required` | `router.replace` to `(onboarding)` |
| `authenticated` | `router.replace` to `(tabs)` |
| `session_expired` | `router.replace` to sign-in **with** "Your session ended. Sign in again." The pre-expiry route is not restored. |
| `signed_out` | sign-in; back must never reveal an authenticated screen |

Token model: short-lived JWT + rotating opaque refresh token in `expo-secure-store`; the server stores only the hash. A refresh failure mid-session is `session_expired`, not a silent retry loop. **Status** SUPPORTED_NOW.
