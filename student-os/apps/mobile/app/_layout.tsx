import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getLocales } from 'expo-localization';
import { useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { applyDirection, I18nProvider, type Locale } from '../src/i18n/index';
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
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tabs)" />
            </Stack>
          </SessionProvider>
        </ThemeProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
