import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getLocales } from 'expo-localization';
import { useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { applyDirection, I18nProvider, type Locale } from '../src/i18n/index';
import { PreviewBanner } from '../src/preview/PreviewBanner';
import { RealtimeProvider } from '../src/state/realtime';
import { SessionProvider } from '../src/state/session';
import { ThemeProvider } from '../src/theme/ThemeProvider';

/**
 * Root layout: providers, writing direction, and the top-level navigator.
 *
 * Direction is decided once, here, before anything renders. Flipping it later
 * leaves half the tree mirrored, so the device locale is read at startup and
 * applied before the first paint.
 */
export default function RootLayout(): React.JSX.Element {
  const initialLocale = useMemo<Locale>(() => {
    const deviceLanguage = getLocales()[0]?.languageCode;
    const locale: Locale = deviceLanguage === 'en' ? 'en' : 'ar';
    applyDirection(locale);
    return locale;
  }, []);

  return (
    <SafeAreaProvider>
      <I18nProvider initialLocale={initialLocale}>
        <ThemeProvider>
          <SessionProvider>
            <RealtimeProvider>
            <StatusBar style="auto" />
            <PreviewBanner />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tabs)" />
              {/* Modal-style routes that sit above the tab shell. */}
              <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
              <Stack.Screen name="post/[id]" />
              <Stack.Screen name="group/new" options={{ presentation: 'modal' }} />
              <Stack.Screen name="group/[id]" />
              <Stack.Screen name="search" />
              <Stack.Screen name="topic/[id]" />
              <Stack.Screen name="classrooms/index" />
              <Stack.Screen name="classrooms/[id]" />
              <Stack.Screen name="classrooms/new" options={{ presentation: 'modal' }} />
              <Stack.Screen name="lecture/[id]" />
              <Stack.Screen name="chat/[id]" />
              <Stack.Screen name="profile/[handle]" />
              {/*
               * Practice is a focus mode, not a tab screen: full-screen
               * presentation so the tab bar is unmounted rather than hidden,
               * and the only navigation inside it is the close control and the
               * post-feedback "Open topic" action.
               *
               * This route was previously unregistered, so Practice rendered
               * without the presentation the design requires.
               */}
              <Stack.Screen
                name="practice/[topicId]"
                options={{ presentation: 'fullScreenModal' }}
              />
            </Stack>
            </RealtimeProvider>
          </SessionProvider>
        </ThemeProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
