import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { TypographyVariant } from '../theme/tokens';

/**
 * The only text primitive in the app.
 *
 * Using `react-native`'s `Text` directly is forbidden by review: it defaults to
 * a hardcoded colour that does not follow the theme, and it does not align
 * correctly under RTL without being told to.
 */

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: 'default' | 'muted' | 'inverse' | 'primary' | 'learning' | 'danger';
  align?: 'start' | 'center' | 'end';
}

export function Text({
  variant = 'body',
  tone = 'default',
  align = 'start',
  style,
  ...rest
}: TextProps): React.JSX.Element {
  const theme = useTheme();

  const color = {
    default: theme.colors.text,
    muted: theme.colors.textMuted,
    inverse: theme.colors.textInverse,
    primary: theme.colors.primary,
    learning: theme.colors.learning,
    danger: theme.colors.danger,
  }[tone];

  // `start`/`end` rather than `left`/`right`: the platform resolves them
  // against the writing direction, so Arabic text aligns correctly without a
  // separate RTL branch at every call site.
  const textAlign: TextStyle['textAlign'] =
    align === 'center' ? 'center' : align === 'end' ? 'right' : 'left';

  return (
    <RNText
      style={[
        theme.typography[variant] as TextStyle,
        { color, textAlign, writingDirection: theme.isRTL ? 'rtl' : 'ltr' },
        style,
      ]}
      {...rest}
    />
  );
}
