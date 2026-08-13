/**
 * Design tokens (§64).
 *
 * Every visual value in the product comes from here. A screen that hardcodes a
 * colour or a spacing number is a bug, because it will drift the moment the
 * palette changes and it cannot follow the dark theme.
 *
 * Visual direction: academic, not corporate-LMS and not a social-media clone.
 * The primary is a deep indigo — serious enough to sit under dense text, warm
 * enough not to read as enterprise software. Accent teal marks learning
 * actions specifically, so "continue studying" never looks like "like this
 * post".
 */

export const palette = {
  indigo50: '#EEF1FB',
  indigo100: '#D8DFF6',
  indigo200: '#B4C0EC',
  indigo400: '#6C7FD6',
  indigo500: '#4A5FC1',
  indigo600: '#3A4CA8',
  indigo700: '#2C3A82',
  indigo900: '#1A2350',

  teal400: '#2FBFA8',
  teal500: '#1FA791',
  teal600: '#178774',

  amber400: '#F0B429',
  amber500: '#D99A16',

  rose400: '#E5646B',
  rose500: '#CC4A52',

  neutral0: '#FFFFFF',
  neutral50: '#F7F8FA',
  neutral100: '#EEF0F4',
  neutral200: '#DEE2E9',
  neutral300: '#C3C9D4',
  neutral400: '#98A1B1',
  neutral500: '#6B7484',
  neutral600: '#4C5462',
  neutral700: '#353C48',
  neutral800: '#222831',
  neutral900: '#14181F',
} as const;

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textInverse: string;
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  onPrimary: string;
  /** Reserved for learning actions only — study, quiz, continue. */
  learning: string;
  learningSoft: string;
  warning: string;
  danger: string;
  dangerSoft: string;
  overlay: string;
}

export const lightColors: ThemeColors = {
  background: palette.neutral50,
  surface: palette.neutral0,
  surfaceRaised: palette.neutral0,
  border: palette.neutral200,
  borderStrong: palette.neutral300,
  text: palette.neutral900,
  textMuted: palette.neutral500,
  textInverse: palette.neutral0,
  primary: palette.indigo600,
  primaryStrong: palette.indigo700,
  primarySoft: palette.indigo50,
  onPrimary: palette.neutral0,
  learning: palette.teal500,
  learningSoft: '#E4F6F2',
  warning: palette.amber500,
  danger: palette.rose500,
  dangerSoft: '#FCE9EA',
  overlay: 'rgba(20, 24, 31, 0.45)',
};

export const darkColors: ThemeColors = {
  background: palette.neutral900,
  surface: palette.neutral800,
  surfaceRaised: palette.neutral700,
  border: palette.neutral700,
  borderStrong: palette.neutral600,
  text: palette.neutral50,
  textMuted: palette.neutral400,
  textInverse: palette.neutral900,
  primary: palette.indigo400,
  primaryStrong: palette.indigo200,
  primarySoft: 'rgba(108, 127, 214, 0.16)',
  onPrimary: palette.neutral900,
  learning: palette.teal400,
  learningSoft: 'rgba(47, 191, 168, 0.16)',
  warning: palette.amber400,
  danger: palette.rose400,
  dangerSoft: 'rgba(229, 100, 107, 0.16)',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

/** 4pt base scale. Every margin and padding in the app is one of these. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/**
 * Type scale. Line heights are generous because a large share of the content is
 * Arabic, which carries more vertical detail than Latin text and becomes hard
 * to read at tight leading.
 */
export const typography = {
  display: { fontSize: 30, lineHeight: 40, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 32, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 28, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 26, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 26, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 20, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
} as const;

export type TypographyVariant = keyof typeof typography;

export const shadow = {
  card: {
    shadowColor: '#0B1020',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sheet: {
    shadowColor: '#0B1020',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
} as const;

/**
 * Minimum interactive target. Below this, taps fail often enough to feel
 * broken, and it is an accessibility requirement rather than a preference.
 */
export const MIN_TOUCH_TARGET = 44;
