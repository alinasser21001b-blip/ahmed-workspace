# Architecture

## Launch order (`App.tsx`)

```
SplashScreen.preventAutoHideAsync()
  → hydrateStores()          // read persisted MobX state from AsyncStorage
  → configureDesignSystem()  // load colors/typography into react-native-ui-lib
  → initServices()           // run init() on every registered service
  → setReady(true) → SplashScreen.hideAsync()
  → <GestureHandlerRootView><AppProvider><NavioApp/></AppProvider></GestureHandlerRootView>
```

The order matters: the design system reads `stores.ui.appearance`, so stores must hydrate first, and
services (translate) read `stores.ui.language`. Heavy startup work (remote config, warm-up API calls)
belongs in `src/services/onLaunch.ts`, not in `App.tsx`.

`AppProvider` (`src/utils/providers.tsx`) nests `StoresProvider` inside `ServicesProvider`, which is
what makes `useStores()` / `useServices()` work in screens.

## navio (`src/navio.tsx`)

One `Navio.build({...})` call defines the whole navigation graph:

- `screens` — a flat registry mapping a name to a component, or to `{component, options}`.
- `stacks` — either a plain array of screen names (`MainStack: ['Main', 'Example']`) or an object
  `{screens: [...], navigatorProps, containerOptions}`.
- `tabs` — `{AppTabs: {layout: {MainTab: {stack: 'MainStack', options: () => ({...})}}}}`. A tab's
  content can be a `stack`, a `drawer`, or an inline array of screen names.
- `drawers` — same layout shape as tabs.
- `modals` — `{ExampleModal: {stack: 'ExampleStack'}}`; shown with `navio.show('ExampleModal')`.
- `root` — the initial layout, e.g. `'tabs.AppTabs'` or `'stacks.AuthFlow'`.
- `hooks` — hooks run inside the navigation root; `useAppearance` lives here so the whole tree
  reacts to theme changes.
- `defaultOptions` — per-layer default screen options, sourced from `designSystem.tsx`.

Exports: `navio`, `getNavio()`, `NavioApp = navio.App`. `getNavio()` exists to avoid a circular
import between `services` and `navio` — services expose navio through a getter.

Navigation API used in screens (all via `const {navio} = useServices()`):

| Call | Effect |
| --- | --- |
| `navio.push('Example', {productId})` | push a screen onto the current stack |
| `navio.pushStack('ProductPageStack')` | push a whole stack |
| `navio.show('ExampleModal')` | present a modal |
| `navio.goBack()` / `navio.setRoot('tabs', 'AppTabs')` | pop / swap the root layout |
| `navio.useN()` | the underlying navigation object (for `setOptions`) |
| `navio.useParams<Params>()` | typed route params |
| `navio.drawers.toggle()` / `navio.tabs.jumpTo('SettingsTab')` | layer-specific helpers |

Screen names, stack names and tab keys are inferred as string literal types from the build object, so
typos surface as type errors at the call site.

## Stores (`src/stores/`)

`class Stores` instantiates every store as a field; `stores` is a singleton also exported for
non-React code (e.g. `designSystem.tsx` reads `stores.ui` directly). `hydrateStores()` iterates over
the fields and awaits `hydrate()` on each — a store missing from `class Stores` is never persisted or
hydrated.

Each store:

```ts
export class XStore implements IStore {
  value = 0;
  get derived() { return this.value * 2; }        // MobX computed

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {name: XStore.name, properties: ['value']});
  }

  set<T extends StoreKeysOf<XStore>>(what: T, value: XStore[T]) { (this as XStore)[what] = value; }
  setMany<T extends StoreKeysOf<XStore>>(obj: Record<T, XStore[T]>) { /* loops set() */ }

  hydrate = async (): PVoid => { await hydrateStore(this); };
}
```

`properties` lists what gets persisted — omit transient fields. `StoreKeysOf<S>` strips
`set | setMany | hydrate` so `set()` can only target real state keys.

Read state in screens with `const {ui} = useStores()` and wrap the component in `observer()`.

## Services (`src/services/`)

Same registry pattern: `class Services` fields, `initServices()` awaits `init()` on each. Every
service guards with a private `inited` flag so re-init is a no-op.

- `t` — `TranslateService`: `t.do('key.path')`, `t.setup()` re-reads `stores.ui.language`.
- `api` — `ApiService` composing per-domain classes (`auth`, `counter`) from `src/services/api/`.
- `onLaunch` — app-lifecycle work.
- `navio` — a getter returning `getNavio()`.

## Design system (`src/utils/designSystem.tsx`)

- `colors` — brand/base palette (`primary`, `secondary`, `accent`, `_black`, `_white`, …).
- `themes` — `light` / `dark` maps of semantic names (`textColor`, `bgColor`, `bg2Color`) typed by
  `ThemeColors`. `system` follows the OS.
- `configureDesignSystem()` — loads colors/schemes/typographies into `react-native-ui-lib`. When
  appearance is `system` it uses `Colors.loadSchemes`; otherwise it flattens the chosen theme.
- `getNavigationTheme()`, `getStatusBarStyle()`, `getStatusBarBGColor()`, `getHeaderBlurEffect()` —
  bridge the palette into React Navigation and the status bar.
- `screenDefaultOptions` / `tabScreenDefaultOptions` / `drawerScreenDefaultOptions` — defaults fed
  back into `Navio.build`.
- `getTabBarIcon(tabName)` + `getTabIconName()` — map a tab key to an `Icon` name.

Semantic names become RN UI lib modifiers in JSX: `<View flex bg-bgColor>`, `<Text textColor>`,
`<Text section>` (from the `section` typography). Adding a color to `themes` makes `bg-<name>` and
`<name>` modifiers available automatically.

## Global types (`src/utils/types/index.d.ts`)

`IStore`, `IService`, `StoreKeysOf<S>`, `PVoid`, `AnyObj`, `PureFunc`, `ThemeColors`. These are
ambient — no import needed. Enums (`Appearance`, `Language`) live in `src/utils/types/enums.ts`.
