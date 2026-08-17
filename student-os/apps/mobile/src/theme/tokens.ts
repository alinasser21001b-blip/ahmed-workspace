/**
 * Design tokens.
 *
 * Every visual value in the product comes from here. A screen that hardcodes a
 * colour or a spacing number is a bug, because it will drift the moment the
 * palette changes and it cannot follow the dark theme.
 *
 * This file is the single runtime source of truth. `docs/design-handoff/
 * tokens.json` is the design-side record for tooling and review: it does not
 * ship, it is never imported at runtime, and it does not compete with this
 * file. Where the two disagree, this file is corrected by hand.
 *
 * Visual direction: academic editorial. A paper ground, ink text, and exactly
 * one dominant action per context. Colour carries one meaning each and is
 * never the only carrier of a state — see `docs/design-handoff/07-COLOUR.md`
 * and its greyscale test.
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

  /*
   * The warm neutral ramp. The editorial hierarchy needs a paper ground; the
   * original neutrals are cool and read as software chrome rather than as a
   * page. Added alongside the cool ramp rather than replacing it, so the dark
   * theme and any screen not yet migrated keep working.
   */
  paper0: '#FFFFFF', // raised surface: fields, bubbles, practice reading body
  paper50: '#FCFBF9', // app ground
  paper100: '#F5F4F0', // selected row fill
  paper200: '#E3E1DC', // hairline border
  paper300: '#DCD8CF', // control border
  paper400: '#C6C1B3', // chevron, disabled glyph
  paper500: '#A9A497', // decorative only — 2.4:1, never a standalone fact
  paper600: '#6E6A60', // metadata
  paper700: '#3C3A34', // secondary body

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
  /** Selected row / answer-option fill. Carries selection together with a 2 px ink border and heavier weight. */
  surfaceSelected: string;
  border: string;
  borderStrong: string;
  text: string;
  /** Secondary body text. Still AA at 10.4:1 on paper. */
  textSecondary: string;
  textMuted: string;
  /** Decorative only — 2.4:1. Never carries a fact that is not stated elsewhere at AA. */
  textFaint: string;
  textInverse: string;
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  onPrimary: string;
  /**
   * Reserved for provenance and citation semantics only — a source line, a
   * citation, "Cites N sources", a handle verified against the server.
   *
   * Never success. Never a correct answer. Never a CTA, an active tab, a
   * selected state, or a sent message. A learning action (Practise, Start,
   * Continue) is the dominant action and uses `text` on `surface`.
   *
   * This is the constraint most likely to be silently undone by a later change
   * that reaches for "the teal one" because it looks available. It is not
   * available. See `docs/design-handoff/07-COLOUR.md`.
   */
  provenance: string;
  provenanceSoft: string;
  /** How things are organised: relationship labels, roles, unread, links. Never progress, success or error. */
  structure: string;
  /** Transient system condition: offline, reconnecting, evidence updated. NOT an error. */
  attention: string;
  /** A claim or an answer does not hold. Distinct from `danger`. */
  challenged: string;
  challengedSoft: string;
  warning: string;
  /** Destructive user action only — deletion, block. Never an incorrect answer. */
  danger: string;
  dangerSoft: string;
  overlay: string;
}

export const lightColors: ThemeColors = {
  background: palette.paper50,
  surface: palette.paper0,
  surfaceRaised: palette.paper0,
  surfaceSelected: palette.paper100,
  border: palette.paper200,
  borderStrong: palette.paper300,
  text: palette.neutral900,
  textSecondary: palette.paper700,
  textMuted: palette.paper600,
  textFaint: palette.paper500,
  textInverse: palette.paper0,
  primary: palette.indigo600,
  primaryStrong: palette.indigo700,
  primarySoft: palette.indigo50,
  onPrimary: palette.paper0,
  // teal600, not teal500: 4.6:1 on paper against 3.4:1. The 500 does not reach AA.
  provenance: palette.teal600,
  provenanceSoft: '#F1F6F4',
  structure: palette.indigo700,
  attention: '#B4531F',
  challenged: '#9B3A40',
  challengedSoft: '#FBF1F1',
  warning: palette.amber500,
  danger: palette.rose500,
  dangerSoft: '#FCE9EA',
  overlay: 'rgba(20, 24, 31, 0.45)',
};

/**
 * DEFERRED_PRODUCT_DECISION.
 *
 * The editorial direction was designed and measured on paper only. The values
 * below for the paper ramp and the three new semantic roles are provisional
 * inversions, not reviewed design. No dark screen has been reviewed.
 *
 * Per `docs/design-handoff/07-COLOUR.md`: ship with dark reviewed, or ship
 * `userInterfaceStyle: light`. Do not ship an unreviewed dark theme. The app
 * is currently set to light for exactly this reason.
 */
export const darkColors: ThemeColors = {
  background: palette.neutral900,
  surface: palette.neutral800,
  surfaceRaised: palette.neutral700,
  surfaceSelected: palette.neutral700,
  border: palette.neutral700,
  borderStrong: palette.neutral600,
  text: palette.neutral50,
  textSecondary: palette.neutral200,
  textMuted: palette.neutral400,
  textFaint: palette.neutral500,
  textInverse: palette.neutral900,
  primary: palette.indigo400,
  primaryStrong: palette.indigo200,
  primarySoft: 'rgba(108, 127, 214, 0.16)',
  onPrimary: palette.neutral900,
  provenance: palette.teal400,
  provenanceSoft: 'rgba(47, 191, 168, 0.16)',
  structure: palette.indigo400,
  attention: '#E08A52',
  challenged: '#E5878C',
  challengedSoft: 'rgba(229, 135, 140, 0.16)',
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
  pill: 999,
} as const;

/**
 * Type scale. Line heights are generous because a large share of the content is
 * Arabic, which carries more vertical detail than Latin text and becomes hard
 * to read at tight leading.
 *
 * There is deliberately no 11 px role. The retired `micro` (11/16/600) is not
 * merely unused — it must not be reintroduced. Interface facts are 13/20
 * `metadata`; anything smaller fails the contrast and Dynamic Type rules in
 * `docs/design-handoff/06-TYPOGRAPHY.md` and `23-ACCESSIBILITY.md`.
 */
/**
 * Font faces — the four frozen families, static weights only
 * (`06-TYPOGRAPHY.md`, `tokens.json → fontsToBundle`). The names are the
 * registration names `expo-font` is given in `app/_layout.tsx`; each name IS
 * a weight, so no role sets `fontWeight` alongside a family — asking the
 * renderer to synthesize a bolder stroke over a real 500 file is how faux
 * bold sneaks in.
 */
export const fonts = {
  serif400: 'Newsreader_400Regular',
  serif500: 'Newsreader_500Medium',
  sans400: 'IBMPlexSans_400Regular',
  sans500: 'IBMPlexSans_500Medium',
  sans600: 'IBMPlexSans_600SemiBold',
  arabic400: 'IBMPlexSansArabic_400Regular',
  arabic500: 'IBMPlexSansArabic_500Medium',
  arabic600: 'IBMPlexSansArabic_600SemiBold',
  mono500: 'IBMPlexMono_500Medium',
} as const;

/**
 * The role table from `06-TYPOGRAPHY.md`, expressed per script.
 *
 * Latin and Arabic do not share a display face: Newsreader has no Arabic
 * coverage, so the display *role* is constant and the *voice* changes by
 * script — Newsreader 500 against IBM Plex Sans Arabic 600, whose numbers
 * differ so the optical weight matches. Arabic line heights run taller
 * throughout because the script carries more vertical detail; an Arabic
 * screen is legitimately taller than the same English screen.
 *
 * Resolved once in the ThemeProvider from the locale, so every call site
 * keeps reading `theme.typography.body` and stays script-unaware.
 */
export const typographyFor = (arabic: boolean) =>
  ({
    /** Screen title role — 30, serif voice. */
    display: arabic
      ? { fontFamily: fonts.arabic600, fontSize: 30, lineHeight: 44 }
      : { fontFamily: fonts.serif500, fontSize: 30, lineHeight: 36, letterSpacing: -0.45 },
    /** Display role — 32, mastheads. */
    displaySerif: arabic
      ? { fontFamily: fonts.arabic600, fontSize: 30, lineHeight: 46 }
      : { fontFamily: fonts.serif500, fontSize: 32, lineHeight: 38, letterSpacing: -0.48 },
    /** Explicitly-Arabic display, for screens that branch by content script. */
    displayArabic: { fontFamily: fonts.arabic600, fontSize: 30, lineHeight: 46 },
    /** Sub-screen title — modal headers, dialog titles. Display voice. */
    title: arabic
      ? { fontFamily: fonts.arabic600, fontSize: 22, lineHeight: 32 }
      : { fontFamily: fonts.serif500, fontSize: 22, lineHeight: 30, letterSpacing: -0.33 },
    /**
     * Knowledge body (`EditorialHeading level="knowledge"`): the editorial
     * voice for the content students actually read — feed, search, profile
     * posts, topic previews. Newsreader 400 / Plex Arabic 600 per `06`.
     */
    heading: arabic
      ? { fontFamily: fonts.arabic600, fontSize: 20, lineHeight: 33 }
      : { fontFamily: fonts.serif400, fontSize: 20, lineHeight: 29 },
    body: arabic
      ? { fontFamily: fonts.arabic400, fontSize: 15.5, lineHeight: 29 }
      : { fontFamily: fonts.sans400, fontSize: 15.5, lineHeight: 25 },
    bodyStrong: arabic
      ? { fontFamily: fonts.arabic600, fontSize: 15.5, lineHeight: 29 }
      : { fontFamily: fonts.sans600, fontSize: 15.5, lineHeight: 25 },
    /** Button/link role — 15.5, weight 600. */
    label: arabic
      ? { fontFamily: fonts.arabic600, fontSize: 15.5, lineHeight: 26 }
      : { fontFamily: fonts.sans600, fontSize: 15.5, lineHeight: 22 },
    /** Interface facts: timestamps, counts, roles, source lines. 13/20. */
    metadata: arabic
      ? { fontFamily: fonts.arabic500, fontSize: 13, lineHeight: 22 }
      : { fontFamily: fonts.sans500, fontSize: 13, lineHeight: 20 },
    /** Mono, tabular. Numeric and reference roles only. */
    numeric: {
      fontFamily: fonts.mono500,
      fontSize: 15,
      lineHeight: 22,
      fontVariant: ['tabular-nums'],
    },
    caption: arabic
      ? { fontFamily: fonts.arabic400, fontSize: 13, lineHeight: 22 }
      : { fontFamily: fonts.sans400, fontSize: 13, lineHeight: 20 },
  }) as const;

/** Latin table, kept for the type and for rare pre-provider call sites. */
export const typography = typographyFor(false);

export type TypographyVariant = keyof typeof typography;

/**
 * Elevation is not used for content. A hairline border does that work; a
 * shadow under a content row reads as a card in a feed, which is the social
 * -media grammar this direction is explicitly not.
 *
 * `sheet` is for modals only.
 */
export const shadow = {
  sheet: {
    shadowColor: '#0B1020',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
} as const;

/**
 * Motion. Three durations, and no more.
 *
 * No decorative motion: no celebratory animation on a correct answer, no
 * evidence-counter tween. The delta is a state change, and animating it
 * dramatises a number the product is deliberately understating.
 *
 * Honour `prefers-reduced-motion` / `isReduceMotionEnabled` by dropping to 0.
 */
export const motion = {
  instant: 120, // control press feedback
  enter: 220, // modal and full-screen presentation
  settle: 180, // feedback panel reveal after submission
} as const;

/**
 * Minimum interactive target. Below this, taps fail often enough to feel
 * broken, and it is an accessibility requirement rather than a preference.
 */
export const MIN_TOUCH_TARGET = 44;
