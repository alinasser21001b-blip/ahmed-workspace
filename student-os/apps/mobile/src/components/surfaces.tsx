import { Pressable, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** Card, Avatar, Badge, Divider, SectionHeader — the shared surface primitives. */

export interface CardProps extends ViewProps {
  padded?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

export function Card({
  padded = true,
  onPress,
  style,
  children,
  accessibilityLabel,
  ...rest
}: CardProps): React.JSX.Element {
  const theme = useTheme();

  const surface: ViewStyle = {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: padded ? theme.spacing.lg : 0,
    // No shadow. Elevation is not used for content in this system: a hairline
    // border does that work, and a shadow under a content row reads as a card
    // in a social feed, which is the grammar this direction rejects.
  };

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        {...(accessibilityLabel ? { accessibilityLabel } : {})}
        onPress={onPress}
        style={({ pressed }) => [surface, { opacity: pressed ? 0.9 : 1 }, style as ViewStyle]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={[surface, style]} {...rest}>
      {children}
    </View>
  );
}

export function Avatar({
  name,
  size = 40,
}: {
  name: string;
  size?: number;
}): React.JSX.Element {
  const theme = useTheme();
  // Initials rather than a broken-image placeholder: most students will not
  // have uploaded a photo during the first week, and an empty grey circle makes
  // a member list unreadable.
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => [...part][0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.colors.primarySoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="label" tone="primary">
        {initials}
      </Text>
    </View>
  );
}

/**
 * `provenance` is for source and citation labels only. An academic label such
 * as a course name is classification, not provenance, and takes `structure`.
 */
export type BadgeTone = 'neutral' | 'primary' | 'provenance' | 'structure' | 'warning' | 'danger';

export function Badge({
  label,
  tone = 'neutral',
  onPress,
}: {
  label: string;
  tone?: BadgeTone;
  /** When set the badge becomes a control — a topic chip opens its topic. */
  onPress?: (() => void) | undefined;
}): React.JSX.Element {
  const theme = useTheme();
  const backgrounds: Record<BadgeTone, string> = {
    neutral: theme.colors.background,
    primary: theme.colors.primarySoft,
    provenance: theme.colors.provenanceSoft,
    structure: theme.colors.primarySoft,
    // Was the learning fill, which made a warning badge indistinguishable from
    // a study badge. There is deliberately no `attentionSoft` token, so this
    // takes the plain ground and is carried by the `attention` text colour and
    // the word itself.
    warning: theme.colors.background,
    danger: theme.colors.dangerSoft,
  };
  const tones = {
    neutral: 'muted',
    primary: 'primary',
    provenance: 'provenance',
    structure: 'structure',
    warning: 'attention',
    danger: 'danger',
  } as const;

  const style = {
    backgroundColor: backgrounds[tone],
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xxs,
    alignSelf: 'flex-start' as const,
  };

  const content = (
    <Text variant="metadata" tone={tones[tone]} bidi="auto">
      {label}
    </Text>
  );

  // A badge with a press handler is a control and is announced as one; without
  // it, it stays a plain label rather than becoming an inert button.
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={style} hitSlop={6}>
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
}

export function Divider(): React.JSX.Element {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }} />;
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.md,
      }}
    >
      <Text variant="heading">{title}</Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress}>
          <Text variant="label" tone="primary">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
