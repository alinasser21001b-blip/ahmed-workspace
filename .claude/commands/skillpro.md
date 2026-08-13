---
description: Expo/React Native expert router — picks and loads the right Expo skill(s) for the task
argument-hint: [what you want to build, fix, or ship]
---

# /skillpro

You are handling an Expo / React Native task. Every skill listed below is installed locally in
`.claude/skills/` — official Expo skills plus the `expo-starter` template skill.

**Request:** $ARGUMENTS

## How to run this command

1. **Read the request.** If `$ARGUMENTS` is empty, show the catalog below grouped by section, ask
   what the user wants to do, and stop.
2. **Detect the project** before choosing (this decides routing more often than the wording does):
   - `app/` directory with `_layout.tsx`, or `expo-router` in `package.json` → **Expo Router** app.
   - `src/navio.tsx` + `src/stores/index.tsx` + `src/services/index.tsx` → **expo-starter** app.
   - No Expo project in the cwd → this is a scaffolding or conceptual question.
   - Check the Expo SDK version in `package.json` — several skills are version-sensitive.
3. **Route** using the table below. Load the skill with the `Skill` tool (e.g. `Skill(expo-router)`);
   do not paste its contents manually.
4. **Load more than one when the task spans layers** — e.g. "settings screen with native toggles"
   → `expo-router` + `expo-ui`; "ship it to TestFlight" → `eas-app-stores`. Load them in the order
   you will use them.
5. **If nothing fits**, say so and handle the task directly instead of forcing a skill.
6. **Follow the loaded skill over your own defaults.** These skills carry current, version-specific
   Expo guidance that outranks recollection. Read the `references/` file a skill points you to
   before writing code.

## Catalog

### Starting / structuring a project
| Skill | Use for |
| --- | --- |
| `expo-starter` | The kanzitelli/expo-starter template: rn-navio navigation, MobX stores, services registry, react-native-ui-lib design system, i18n. Adding a screen/tab/store/service in such a project. |
| `expo-project-structure` | Folder layout for a **new** Expo Router app. Never to restructure an existing one. |
| `expo-examples` | Integrating a third-party service (Stripe, Clerk, Supabase, OpenAI, maps, SQLite, Skia…) using expo/examples' canonical `with-*` pattern. |

### UI, navigation, styling
| Skill | Use for |
| --- | --- |
| `expo-router` | File-based routing: routes, groups, dynamic segments, Link, native Stack, modals, form sheets, NativeTabs, headers, search bars. |
| `expo-native-ui` | Native-feeling screens: HIG styling, semantic colors, SF Symbols, media, animations, visual effects, gradients, storage, responsive layout. |
| `expo-ui` | `@expo/ui` — real SwiftUI / Jetpack Compose from React; native controls and drop-in replacements for RN community UI libs. |
| `expo-design-system` | Design tokens, theme files, reusable component conventions, auditing an app for style drift. |
| `expo-tailwind-setup` | Tailwind v4 in Expo via react-native-css / NativeWind v5. |

### Data & platform
| Skill | Use for |
| --- | --- |
| `expo-data-fetching` | Any network request: fetch, React Query, SWR, caching, offline, Expo Router loaders. |
| `expo-module` | Writing native modules/views with the Expo Modules API (Swift, Kotlin, TS), config plugins, autolinking. |
| `expo-migrate-module` | Migrating an existing Swift module from the 1.0 definition DSL to the 2.0 macro API. |
| `expo-dom` | Expo DOM components — running web code in a webview on native. |
| `expo-web-to-native` | End-to-end migration of a web React app (Next.js/Vite/CRA) to native. |
| `expo-brownfield` | Embedding Expo/React Native into an existing native iOS or Android app. |
| `expo-app-clip` | Adding an iOS App Clip target (AASA, appclips, smart app banner). |

### Upgrades & dev builds
| Skill | Use for |
| --- | --- |
| `expo-upgrade` | SDK upgrades and dependency fixes: React 19, New Architecture, React Compiler, expo-av → expo-audio/video, React Navigation → Expo Router, native tabs. |
| `expo-dev-client` | Building and distributing development clients for testing native code on devices. |

### Shipping (EAS — paid service, free tier limited)
| Skill | Use for |
| --- | --- |
| `eas-app-stores` | `eas build` / `eas submit`, App Store, Play Store, TestFlight, eas.json profiles, versioning, store metadata. |
| `eas-hosting` | Deploying the web bundle and Expo Router API routes (`+api.ts`) to EAS Hosting. |
| `eas-workflows` | Authoring `.eas/workflows/*.yml` CI/CD pipelines. |
| `eas-update-insights` | Health of published OTA updates: crash rate, adoption, embedded vs OTA split. |
| `eas-observe` | `expo-observe` performance monitoring: startup/navigation metrics, events, error reporting, `eas observe:*` queries. |
| `eas-simulator` | Running the app on a cloud simulator — Linux/CI/headless hosts, or agent-driven screenshot sessions. |

## Routing rules that matter

- **`expo-starter` and `expo-router` are different paradigms.** expo-starter uses rn-navio on top of
  React Navigation with a central `src/navio.tsx`; Expo Router uses file-based routes under `app/`.
  Never mix their patterns in one project. In an expo-starter project, adding a screen means
  registering it in `navio.tsx` — not creating a file under `app/`. If the user wants to move from
  one to the other, that is a migration: `expo-upgrade` has the React Navigation → Expo Router guide.
- **Anything touching EAS costs money.** Before running `eas build`, `eas submit`, `eas deploy`, or a
  cloud simulator session, tell the user what will be consumed and get confirmation.
- **Ambiguous "run my app"**: on macOS with a local simulator, use `expo run:ios` / `npx expo start`
  directly; reach for `eas-simulator` only on a host with no local simulator, or when a shareable /
  agent-driven session is what was asked for.
- **Deploy means two different things.** Website or API routes → `eas-hosting`. Native app to a
  store → `eas-app-stores`.
- **Styling questions split three ways.** Tokens and component conventions → `expo-design-system`;
  platform look and native feel → `expo-native-ui`; Tailwind classes → `expo-tailwind-setup`.

## Optional: Expo MCP server

The official Expo plugin also ships an MCP server (`https://mcp.expo.dev/mcp`, HTTP transport) with
live docs and project data. It is not installed here. Suggest adding it only if the user asks for
live Expo documentation lookups.
