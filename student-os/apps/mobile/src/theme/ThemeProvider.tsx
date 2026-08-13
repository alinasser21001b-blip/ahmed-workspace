import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme, I18nManager } from 'react-native';
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
  const isDark = scheme === 'dark';

  const theme = useMemo<Theme>(
    () => ({
      colors: isDark ? darkColors : lightColors,
      spacing,
      radius,
      typography,
      shadow,
      isDark,
      isRTL: I18nManager.isRTL,
    }),
    [isDark],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}
