import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme, I18nManager } from 'react-native';
import { isRTLLocale, useI18n } from '../i18n/index';
import { darkColors, lightColors, radius, shadow, spacing, typography, type ThemeColors } from './tokens';

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
  const scheme = useColorScheme();
  const { locale } = useI18n();
  const isDark = scheme === 'dark';

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

  const theme = useMemo<Theme>(
    () => ({
      colors: isDark ? darkColors : lightColors,
      spacing,
      radius,
      typography,
      shadow,
      isDark,
      isRTL,
    }),
    [isDark, isRTL],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}
