# ADR-0006 — Expo + Expo Router for one universal client

**Status:** Accepted · Phase 0

## Context

The Constitution specifies React Native / Expo and a mobile-first product
(§45, §53). An admin console (§42) will need the web.

## Decision

One Expo application with Expo Router (file-based routing), targeting iOS,
Android and web via react-native-web.

## Consequences

**Good.** One codebase, one design system, one navigation model. The web target
means **CI can actually render and drive the UI** — the first user journey runs
as a real browser test against the real API, which is otherwise impossible to
automate cheaply for a native app.

**Bad.** Expo SDK versions pin React Native versions fairly tightly; SDK 57
required pinning React Native to 0.86.2 rather than 0.87. Some native modules
lag.

**Note.** Metro resolves extensionless relative imports and does **not** map
`./x.js` to `./x.tsx`. Relative imports in `apps/mobile` are therefore
extensionless, unlike the Node packages, which use explicit `.js` specifiers
for ESM. This asymmetry is deliberate and enforced by both bundlers failing
loudly otherwise.
