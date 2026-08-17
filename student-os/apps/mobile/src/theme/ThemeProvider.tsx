import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import { isRTLLocale, useI18n } from '../i18n/index';
import { lightColors, radius, shadow, spacing, typography, typographyFor, type ThemeColors } from './tokens';

/**
 * Theme access.
 *
 * `isRTL` lives on the theme rather than being read ad hoc, because direction
 * affects layout decisions (row reversal, icon mirroring, text alignment) in
 * dozens of components and must have exactly one source of truth (§61, §62).
 */

export interface Theme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  shadow: typeof shadow;
  isDark: boolean;
  isRTL: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { locale } = useI18n();

  /*
   * Light, always — not "light unless the OS says dark".
   *
   * The frozen identity is the paper/ink system; the dark theme is explicitly
   * DEFERRED and unreviewed (`FRAME-MAP.md` marks the one dark frame as an
   * unapproved exploration, and no dark palette was ever accepted). Following
   * `useColorScheme()` here meant every student and reviewer whose device is
   * in dark mode was shown a theme nobody approved, as the default — which is
   * exactly how the owner first saw the product.
   *
   * `darkColors` stays in tokens.ts for the future review that ships it, but
   * nothing selects it until that review happens. When it does, this is the
   * one line that changes.
   */
  const isDark = false;

  /*
   * Direction comes from the LOCALE, not from `I18nManager.isRTL`.
   *
   * On react-native-web the document direction is applied through CSS while
   * `I18nManager.isRTL` stays false, so anything that branched on it — mirrored
   * icons, which side replies indent on — silently pointed the wrong way in
   * Arabic while the rest of the layout was correctly mirrored. The locale is
   * the same fact and is true on every platform; `I18nManager` is kept as the
   * fallback for a native build whose locale was applied before mount.
   */
  const isRTL = isRTLLocale(locale) || I18nManager.isRTL;

  /*
   * The type roles resolve per script: Newsreader carries the Latin display
   * voice and has no Arabic coverage, so the Arabic table swaps every serif
   * role to IBM Plex Sans Arabic 600 with the taller leading the script
   * needs (`06-TYPOGRAPHY.md`). Locale is the resolution key — the same one
   * that decides direction.
   */
  const theme = useMemo<Theme>(
    () => ({
      colors: lightColors,
      spacing,
      radius,
      typography: typographyFor(isRTLLocale(locale)),
      shadow,
      isDark,
      isRTL,
    }),
    [isDark, isRTL, locale],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}
