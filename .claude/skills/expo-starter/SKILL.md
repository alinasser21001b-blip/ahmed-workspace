---
name: expo-starter
description: Scaffold and develop React Native apps with the kanzitelli/expo-starter template (Expo SDK 50, rn-navio navigation, MobX + mobx-persist-store, react-native-ui-lib design system, i18n-js, Reanimated 3, FlashList). Use when starting a new Expo/React Native app, or when working inside a project that has `src/navio.tsx`, `src/stores/index.tsx`, and `src/services/index.tsx` — e.g. adding a screen, tab, stack, modal, drawer, store, API service, translation, or dark-mode color.
---

# Expo Starter

Production-ready Expo (React Native) starter by [kanzitelli](https://github.com/kanzitelli/expo-starter).
Everything is wired around three registries: **navio** (navigation), **stores** (state), **services** (side effects).

## Detecting the template

A project uses this template when `src/navio.tsx` exists alongside `src/stores/index.tsx` and
`src/services/index.tsx`. Confirm before applying these patterns — they are specific to this starter.

## Creating a new app

```bash
npx degit kanzitelli/expo-starter app
cd app && yarn
yarn start          # or: yarn start:ios / start:android / start:web
```

`npx cli-rn new app` does the same plus interactive setup. Never scaffold with `create-expo-app`
when the user asked for this starter — the folder conventions below are what the starter provides.

Scripts worth knowing: `yarn ios` / `yarn android` (native run), `yarn prebuild` (generate native dirs),
`yarn format:write` (prettier over `./src`), `yarn pub:app:prod` (EAS Update).

## Project map

```
App.tsx                     hydrateStores → configureDesignSystem → initServices → <NavioApp/>
src/navio.tsx               THE navigation file: screens, stacks, tabs, drawers, modals, root
src/screens/                one file per screen, exported as a named const
src/components/             shared UI; `_component-sample.tsx` is the template
src/services/               t (translate), api, onLaunch, + navio getter — class-per-service
src/stores/                 ui, counter, auth — MobX classes, persisted via mobx-persist-store
src/utils/designSystem.tsx  colors, themes, typography, navigation themes, default screen options
src/utils/hooks.ts          useAppearance() — keeps a component in sync with theme/language
src/utils/types/index.d.ts  global types: IStore, IService, PVoid, ThemeColors, StoreKeysOf
```

Import alias `@app/*` → `src/*`. It is declared **twice** — `babel.config.js` (module-resolver) and
`tsconfig.json` (paths). Changing one without the other breaks the build.

## Non-negotiable conventions

- **Screens are typed `NavioScreen`** and wrapped in `observer()` from `mobx-react`.
- **Static options** go on the component: `Example.options = props => ({title: '...'})`.
- **Navigation is never imported from react-navigation** in screens — use `navio` from `useServices()`:
  `navio.push('Example')`, `navio.show('ExampleModal')`, `navio.pushStack('ProductPageStack')`,
  `navio.useN()` for the navigation object, `navio.useParams<Params>()` for params.
- **State mutation goes through `set` / `setMany`**, not direct assignment from screens:
  `ui.set('appearance', 'dark')`.
- **Every store implements `IStore`**, every service implements `IService`. Registering the class in
  `src/stores/index.tsx` / `src/services/index.tsx` is what makes hydrate/init run — a store not
  listed there is never hydrated.
- **Colors come from the design system**, never hardcoded: `<View bg-bgColor>`, `<Text textColor>`.
  Add new colors in `designSystem.tsx` under both `light` and `dark` themes, plus the `ThemeColors`
  type in `src/utils/types/index.d.ts`.
- **User-facing strings go through i18n**: `services.t.do('example.title')` (or `t.do(...)` from
  `useServices()`), with the key added to every locale in `src/services/translate/translations.ts`.
- Async return type is `PVoid` (= `Promise<void>`), used across stores and services.

## Common tasks

Full step-by-step code for each is in `references/recipes.md`; copy-paste starting points are in
`templates/`. The short version:

| Task | Touch these files |
| --- | --- |
| Add a screen | `src/screens/<name>.tsx` → register in `screens` in `src/navio.tsx` → add to a stack |
| Add a tab | `tabs.AppTabs.layout` in `src/navio.tsx` + icon case in `getTabIconName()` |
| Add a modal | `stacks` entry, then `modals: {MyModal: {stack: 'MyStack'}}` |
| Add a store | `src/stores/<name>.ts` → field on `class Stores` in `src/stores/index.tsx` |
| Add an API call | `src/services/api/<name>.ts` → field on `ApiService` in `src/services/api/index.ts` |
| Add a translation | `src/services/translate/translations.ts` (all locales) |
| Add a theme color | `themes.light` + `themes.dark` in `designSystem.tsx` + `ThemeColors` type |
| Change startup work | `src/services/onLaunch.ts` (runs before UI shows) |
| Switch auth/app root | `root={...}` prop on `<NavioApp/>` in `App.tsx`, or `navio.setRoot()` |

## Gotchas

- Adding a screen to `screens` but not to any stack/tab makes it unreachable — and TypeScript will
  not complain. Always do both.
- Stack names, screen names, and tab keys are string-literal typed off the `Navio.build` object;
  after editing `navio.tsx` the autocompletion for `navio.push('...')` updates automatically. A
  "not assignable" error there almost always means a missing registration, not a bad cast.
- `useAppearance()` must be called in any screen or component that should re-render on theme or
  language change. Screens that skip it appear stuck in the old theme.
- Persistence defaults to AsyncStorage in `src/stores/_hydration.ts`; the MMKV config is present but
  commented out. MMKV does not work in Expo Go — it needs a dev client / prebuild.
- `react-native-reanimated/plugin` must stay **last** in `babel.config.js` plugins.
- Dependency versions in `package.json` are pinned to the Expo SDK. Change them with
  `npx expo install <pkg>`, not `yarn add`, so the SDK-compatible version is picked.
- On iOS, screens use `headerLargeTitle` + transparent blurred headers by default
  (`screenDefaultOptions`); content needs `contentInsetAdjustmentBehavior="always"` on the
  ScrollView or it hides under the header.

## References

- `references/architecture.md` — how navio/stores/services/design system fit together, launch order.
- `references/recipes.md` — copy-ready walkthroughs for every row of the table above.
- `templates/` — `screen.tsx`, `component.tsx`, `store.ts`, `service.ts` starting files.
