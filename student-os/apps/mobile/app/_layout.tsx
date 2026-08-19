/*
 * Imported per face, not from the package index.
 *
 * Each `@expo-google-fonts/*` index re-exports every weight and italic as a
 * `require()` of its .ttf, and Metro cannot tree-shake an asset require — so
 * importing three weights from the index shipped all sixty-eight faces,
 * including italics this design never sets. The per-face entry points pull
 * exactly what is named. Same nine faces render; the unused ones stop
 * travelling.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { IBMPlexSansArabic_400Regular } from '@expo-google-fonts/ibm-plex-sans-arabic/400Regular';
import { IBMPlexSansArabic_500Medium } from '@expo-google-fonts/ibm-plex-sans-arabic/500Medium';
import { IBMPlexSansArabic_600SemiBold } from '@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold';
import { Newsreader_400Regular } from '@expo-google-fonts/newsreader/400Regular';
import { Newsreader_500Medium } from '@expo-google-fonts/newsreader/500Medium';
import { useFonts } from 'expo-font';
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
import { installWebCanvas } from '../src/theme/web-canvas';

/**
 * Root layout: providers, writing direction, fonts, and the top-level
 * navigator.
 *
 * Direction is decided once, here, before anything renders. Flipping it later
 * leaves half the tree mirrored, so the device locale is read at startup and
 * applied before the first paint.
 */
// At module scope, before any render: the canvas rule must exist before the
// first paint, and first paint is already held until the fonts resolve.
installWebCanvas();

export default function RootLayout(): React.JSX.Element | null {
  /*
   * The frozen faces — four families, nine static instances, no variable
   * axes (`06-TYPOGRAPHY.md` §Loading, `tokens.json → fontsToBundle`).
   * Rendering is held until they resolve: a script-swap flash is worse than
   * a moment of blank, because the Arabic fallback is a system face at a
   * visibly different weight and the swap would happen mid-read.
   */
  const [fontsLoaded] = useFonts({
    /*
     * THE ICON FACE, and it belongs in this gate exactly as much as the text
     * faces do.
     *
     * It was missing, and the consequence was not subtle: `@expo/vector-icons`
     * registers its font lazily on its own schedule, so the tree painted as
     * soon as the nine text faces resolved and every glyph in the product —
     * the whole tab bar, the header controls, the send button, the reaction
     * row — fell back to the missing-glyph box. Observed on a real phone over
     * LTE as a screen of hollow squares, and reproduced here: the Ionicons
     * .ttf ships in the bundle but was never requested at all (zero network
     * requests for it, no entry in `document.fonts`).
     *
     * The comment below explains why text is held until its faces resolve. An
     * icon is a glyph in a font, so the identical argument applies to it, and
     * the fix is to say so rather than to hope the race is won.
     */
    ...Ionicons.font,
    Newsreader_400Regular,
    Newsreader_500Medium,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexMono_500Medium,
  });

  const initialLocale = useMemo<Locale>(() => {
    const deviceLanguage = getLocales()[0]?.languageCode;
    const locale: Locale = deviceLanguage === 'en' ? 'en' : 'ar';
    applyDirection(locale);
    return locale;
  }, []);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <I18nProvider initialLocale={initialLocale}>
        <ThemeProvider>
          <SessionProvider>
            <RealtimeProvider>
            {/* Dark glyphs on the paper ground — the theme no longer follows the
                OS scheme, so the status bar must not either. */}
            <StatusBar style="dark" />
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
              <Stack.Screen name="saved" />
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
              {/*
               * The preview feedback form. Registered unconditionally because
               * the route table is static, and harmless in production: the
               * screen renders a sentence rather than a form when the build is
               * not a preview, and nothing links to it there.
               */}
              <Stack.Screen name="preview-feedback" options={{ presentation: 'modal' }} />
            </Stack>
            </RealtimeProvider>
          </SessionProvider>
        </ThemeProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
