import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { useTheme } from '../theme/ThemeProvider';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Icons whose meaning depends on writing direction — and only those.
 *
 * The rule this file exists to enforce: **mirror navigation, never mirror
 * everything.** An arrow that means "go back" points at the start of the line,
 * so it flips in Arabic. A clock, a play button, a checkmark, a search glyph
 * and an external-link arrow do not: they are objects and symbols, not
 * directions, and flipping them produces an interface that looks translated
 * rather than designed.
 *
 * Naming the intent — `back`, `forward`, `disclosure` — rather than the glyph is
 * what makes that distinction reviewable. A screen that writes
 * `theme.isRTL ? 'arrow-forward' : 'arrow-back'` inline has re-derived the rule,
 * and the next screen will re-derive it slightly differently.
 */
export type Direction =
  /** Return to the previous screen. Points at the start of the line. */
  | 'back'
  /** Advance. Points at the end of the line. */
  | 'forward'
  /** The chevron on a row that opens a detail screen. */
  | 'disclosure'
  /** Previous / next in a paginated set. */
  | 'previous'
  | 'next';

const LTR: Record<Direction, IoniconName> = {
  back: 'arrow-back',
  forward: 'arrow-forward',
  disclosure: 'chevron-forward',
  previous: 'chevron-back',
  next: 'chevron-forward',
};

const RTL: Record<Direction, IoniconName> = {
  back: 'arrow-forward',
  forward: 'arrow-back',
  disclosure: 'chevron-back',
  previous: 'chevron-forward',
  next: 'chevron-back',
};

/**
 * Icons that must NOT mirror, recorded so the decision is visible rather than
 * implicit in their absence from the maps above:
 *
 *   play / pause / skip   media transport — a play triangle points right in
 *                         every locale, including Arabic
 *   checkmark             a symbol, not a direction
 *   search                the handle's angle is part of the glyph
 *   open-outline          "opens elsewhere", not "moves rightwards"
 *   time / hourglass      clocks run clockwise everywhere
 *   lock, create, add     objects
 */

export function useDirectionalIcon(direction: Direction): IoniconName {
  const theme = useTheme();
  return (theme.isRTL ? RTL : LTR)[direction];
}

export function DirectionalIcon({
  direction,
  size = 24,
  color,
}: {
  direction: Direction;
  size?: number;
  color: string;
}): React.JSX.Element {
  const name = useDirectionalIcon(direction);
  return <Ionicons name={name} size={size} color={color} />;
}
