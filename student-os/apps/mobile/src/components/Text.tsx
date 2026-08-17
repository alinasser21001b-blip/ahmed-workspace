import {
  StyleSheet,
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, type TypographyVariant } from '../theme/tokens';

/**
 * The only text primitive in the app.
 *
 * Using `react-native`'s `Text` directly is forbidden by review: it defaults to
 * a hardcoded colour that does not follow the theme, and it does not align
 * correctly under RTL without being told to.
 */

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  /**
   * Semantic colour role. Each has exactly one meaning — see
   * `docs/design-handoff/07-COLOUR.md`.
   *
   * `provenance` is citation and source only: never success, never a correct
   * answer, never a call to action. Correctness is carried by ink plus a word
   * plus a glyph, so that it survives the greyscale test.
   */
  tone?:
    | 'default'
    | 'secondary'
    | 'muted'
    | 'faint'
    | 'inverse'
    | 'primary'
    | 'provenance'
    | 'structure'
    | 'attention'
    | 'challenged'
    | 'danger';
  align?: 'start' | 'center' | 'end';
  /**
   * Which direction this text is written in.
   *
   * `'locale'` — our own copy, from the translation catalogue. Its direction is
   * known at build time and is the interface's direction.
   *
   * `'auto'` — text a student typed. The direction is a property of the content
   * and cannot be known in advance: a cohort writes Arabic notes, English drug
   * names, and posts that are half of each. The platform resolves it per
   * paragraph from the first strong character, which is the Unicode rule and
   * the only one that gets a mixed corpus right.
   *
   * This matters more than it sounds. Forcing RTL onto an English sentence does
   * not merely align it differently — it moves the full stop to the left-hand
   * end, so «Short English post.» renders as «.Short English post». That was the
   * state of every English post in the Arabic UI, and it is the difference
   * between an interface that was translated and one that was designed.
   */
  bidi?: 'locale' | 'auto';
}

export function Text({
  variant = 'body',
  tone = 'default',
  align = 'start',
  bidi = 'locale',
  style,
  ...rest
}: TextProps): React.JSX.Element {
  const theme = useTheme();

  const color = {
    default: theme.colors.text,
    secondary: theme.colors.textSecondary,
    muted: theme.colors.textMuted,
    faint: theme.colors.textFaint,
    inverse: theme.colors.textInverse,
    primary: theme.colors.primary,
    provenance: theme.colors.provenance,
    structure: theme.colors.structure,
    attention: theme.colors.attention,
    challenged: theme.colors.challenged,
    danger: theme.colors.danger,
  }[tone];

  // `start`/`end` rather than `left`/`right`: the platform resolves them
  // against the writing direction, so Arabic text aligns correctly without a
  // separate RTL branch at every call site.
  const textAlign: TextStyle['textAlign'] =
    align === 'center' ? 'center' : align === 'end' ? 'right' : 'left';

  /*
   * `writingDirection` is omitted entirely for auto text rather than set to
   * 'auto'. On web, react-native-web already renders a root-level Text with
   * `dir="auto"`; supplying `writingDirection` compiles to a CSS `direction`
   * rule, and an explicit CSS direction overrides the `dir` attribute — which
   * is precisely how the automatic resolution was being defeated. On native,
   * absent `writingDirection` already means 'auto'.
   */
  const direction: TextStyle =
    bidi === 'auto' ? {} : { writingDirection: theme.isRTL ? 'rtl' : 'ltr' };

  /*
   * A `fontWeight` override becomes a *face* change, resolved here once.
   *
   * The frozen families are static instances — each registered name IS a
   * weight — so leaving `fontWeight: '600'` in the style asks the renderer to
   * synthesize a bolder stroke over a real 400 or 500 file. That faux bold is
   * exactly the "almost right" rendering the visual audit flagged. Call sites
   * keep saying `fontWeight` (it is the natural way to express emphasis); the
   * primitive swaps the family to the true instance and removes the ask.
   */
  const flat = StyleSheet.flatten([
    theme.typography[variant] as TextStyle,
    { color, textAlign },
    direction,
    style,
  ]);
  if (flat.fontWeight !== undefined) {
    const weight =
      flat.fontWeight === 'bold' || Number(flat.fontWeight) >= 600
        ? 600
        : Number(flat.fontWeight) >= 500
          ? 500
          : 400;
    flat.fontFamily = resolveFace(flat.fontFamily, weight);
    delete flat.fontWeight;
  }

  return <RNText style={flat} {...rest} />;
}

/** The static instance for (family group, weight), per `tokens.ts → fonts`. */
function resolveFace(family: string | undefined, weight: 400 | 500 | 600): string | undefined {
  if (!family) return family;
  if (family.startsWith('IBMPlexSansArabic')) {
    return { 400: fonts.arabic400, 500: fonts.arabic500, 600: fonts.arabic600 }[weight];
  }
  if (family.startsWith('IBMPlexSans')) {
    return { 400: fonts.sans400, 500: fonts.sans500, 600: fonts.sans600 }[weight];
  }
  // Newsreader carries no 600 instance; 500 is its heaviest frozen face.
  if (family.startsWith('Newsreader')) {
    return weight === 400 ? fonts.serif400 : fonts.serif500;
  }
  return family; // mono has one instance; anything else passes through
}
