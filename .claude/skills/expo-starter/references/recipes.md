# Recipes

Every recipe assumes the alias `@app` → `src`.

## Add a screen

1. `src/screens/profile.tsx` — start from `templates/screen.tsx`:

```tsx
import React from 'react';
import {ScrollView} from 'react-native';
import {Text, View} from 'react-native-ui-lib';
import {observer} from 'mobx-react';
import {NavioScreen} from 'rn-navio';

import {services, useServices} from '@app/services';
import {useAppearance} from '@app/utils/hooks';

export type Params = {userId?: string};

export const Profile: NavioScreen = observer(() => {
  useAppearance();
  const {t, navio} = useServices();
  const params = navio.useParams<Params>();

  return (
    <View flex bg-bgColor>
      <ScrollView contentInsetAdjustmentBehavior="always">
        <View padding-s4>
          <Text textColor>{params?.userId}</Text>
        </View>
      </ScrollView>
    </View>
  );
});

Profile.options = () => ({title: services.t.do('profile.title')});
```

2. Register it in `src/navio.tsx`:

```ts
import {Profile} from '@app/screens/profile';

screens: {
  Main,
  Profile,           // ← added
  ...
}
```

3. Make it reachable — add to a stack (`MainStack: ['Main', 'Example', 'Profile']`) or a tab.
4. Navigate: `navio.push('Profile', {userId: '1'})`.

Screen-specific options that need route params:

```tsx
Profile.options = props => ({
  title: (props?.route?.params as Params)?.userId ?? 'Profile',
});
```

## Add a tab

```ts
tabs: {
  AppTabs: {
    layout: {
      // ...existing tabs
      ProfileTab: {
        stack: 'ProfileStack',                       // or: stack: ['Profile']
        options: () => ({
          title: services.t.do('profile.title'),
          tabBarIcon: getTabBarIcon('ProfileTab'),
        }),
      },
    },
  },
},
```

Then add the icon case in `designSystem.tsx`:

```ts
if (tabName === 'ProfileTab') return focused ? 'person' : 'person-outline';
```

Icon names come from `src/components/icon.tsx` (`IconName`) — check what is available there before
inventing one.

## Add a modal

```ts
stacks: {
  ProfileStack: {screens: ['Profile'], containerOptions: {headerShown: true, title: 'Profile'}},
},
modals: {
  ProfileModal: {stack: 'ProfileStack'},
},
```

Show it with `navio.show('ProfileModal')`, dismiss with `navio.goBack()`.

## Add a drawer entry

```ts
drawers: {
  AppDrawer: {
    layout: {
      Profile: {stack: 'ProfileStack'},
    },
  },
},
```

Open/close with `navio.drawers.toggle()`.

## Add a store

1. `src/stores/profile.ts` — start from `templates/store.ts`:

```ts
import {makeAutoObservable} from 'mobx';
import {hydrateStore, makePersistable} from 'mobx-persist-store';

export class ProfileStore implements IStore {
  name = '';
  avatarUrl?: string;

  get initials() {
    return this.name.slice(0, 1).toUpperCase();
  }

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {name: ProfileStore.name, properties: ['name', 'avatarUrl']});
  }

  set<T extends StoreKeysOf<ProfileStore>>(what: T, value: ProfileStore[T]) {
    (this as ProfileStore)[what] = value;
  }
  setMany<T extends StoreKeysOf<ProfileStore>>(obj: Record<T, ProfileStore[T]>) {
    for (const [k, v] of Object.entries(obj)) this.set(k as T, v as ProfileStore[T]);
  }

  hydrate = async (): PVoid => {
    await hydrateStore(this);
  };
}
```

2. Register it — this step is what enables persistence:

```ts
// src/stores/index.tsx
import {ProfileStore} from './profile';

class Stores {
  ui = new UIStore();
  profile = new ProfileStore();   // ← added
}
```

3. Use it: `const {profile} = useStores();` inside an `observer()` component;
   write with `profile.set('name', 'Ahmed')` or `profile.setMany({name: 'Ahmed', avatarUrl: url})`.

Non-persisted store: drop `makePersistable` and `hydrate` (the `IStore.hydrate` field is optional).

## Add an API call

```ts
// src/services/api/profile.ts
export class ProfileApi {
  get = async (id: string): Promise<ProfileDTO> => {
    const res = await fetch(`${BASE_URL}/profiles/${id}`);
    return res.json();
  };
}
```

```ts
// src/services/api/index.ts
export class ApiService implements IService {
  counter: CounterApi;
  profile: ProfileApi;          // ← added

  constructor() {
    this.counter = new CounterApi();
    this.profile = new ProfileApi();
  }
  init = async (): PVoid => { /* ... */ };
}
```

Call it from a screen: `const {api} = useServices(); const p = await api.profile.get(id);`
Put response types in `src/utils/types/api.ts`.

## Add a standalone service

Create `src/services/analytics.ts` implementing `IService` (see `templates/service.ts`), then add
`analytics = new AnalyticsService();` to `class Services` in `src/services/index.tsx`. `init()` is
awaited on launch, in field-declaration order.

## Add a translation

```ts
// src/services/translate/translations.ts
export const en = {
  profile: {title: 'Profile', empty: 'Nothing here yet'},
};
export const ar = {
  profile: {title: 'الملف الشخصي', empty: 'لا يوجد شيء بعد'},
};
```

Add the key to **every** exported locale object — `enableFallback` is on, so a missing key silently
falls back instead of erroring. Use with `t.do('profile.title')`. A new locale also needs an entry in
the `Language` enum / `languageToUI` map in `src/utils/types/enums.ts` for the settings picker.

For RTL languages, also call `I18nManager.forceRTL(true)` and reload the app — the starter does not
handle RTL out of the box.

## Add a theme color

```ts
// src/utils/types/index.d.ts
type ThemeColors = {
  textColor: string;
  bgColor: string;
  bg2Color: string;
  cardColor: string;      // ← added
};
```

```ts
// src/utils/designSystem.tsx
const themes: Record<Appearance, ThemeColors> = {
  system: {} as any,
  light: {..., cardColor: colors._white2},
  dark:  {..., cardColor: colors._black2},
};
```

Use it as a modifier: `<View bg-cardColor>` / `<Text cardColor>`.

## Add a typography style

```ts
Typography.loadTypographies({
  section: {fontSize: 26, fontWeight: '600'},
  caption: {fontSize: 13, fontWeight: '400'},   // ← usable as <Text caption>
});
```

## Change the app root (auth flow)

Either drive it from state in `App.tsx`:

```tsx
<NavioApp root={stores.auth.isLoggedIn ? 'tabs.AppTabs' : 'stacks.AuthFlow'} />
```

or switch imperatively after login: `navio.setRoot('tabs', 'AppTabs')`.

## Work to do on launch

Put it in `src/services/onLaunch.ts` inside `init()` — it runs before the splash screen hides, so
keep it short or the app feels slow. Anything that can wait belongs in the first screen instead.

## Verify changes

```bash
npx tsc --noEmit      # type-check; catches missing navio registrations
yarn format:write     # prettier over ./src
npx expo start        # or start:ios / start:android / start:web
```
