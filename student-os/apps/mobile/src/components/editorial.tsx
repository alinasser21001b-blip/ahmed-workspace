import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/index';
import { useTheme } from '../theme/ThemeProvider';
import { DirectionalIcon } from './DirectionalIcon';
import { Text } from './Text';

/**
 * The editorial shell primitives from the frozen handoff (09-COMPONENTS.md):
 * TopBar, SectionHeader, MetadataLine, DominantAction, SecondaryAction, and
 * the ink band. Screens compose these instead of restyling their own headers,
 * which is how the hierarchy stays one system instead of nine interpretations
 * of it.
 */

// ---------------------------------------------------------------------------
// MetadataLine — every interface fact, one primitive

export type MetadataTone = 'muted' | 'structure' | 'challenged' | 'provenance' | 'attention';

export function MetadataLine({
  parts,
  tone = 'muted',
  bidi = 'locale',
}: {
  parts: (string | null | undefined)[];
  tone?: MetadataTone;
  bidi?: 'locale' | 'auto';
}): React.JSX.Element | null {
  const present = parts.filter((part): part is string => Boolean(part && part.length));
  if (present.length === 0) return null;
  return (
    // Joined with commas for the screen reader so it never reads "middle dot".
    <Text variant="metadata" tone={tone} bidi={bidi} accessibilityLabel={present.join(', ')}>
      {present.join(' · ')}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// SectionHeader — 13/20 weight 600, sentence case, never uppercase

export function SectionHeader({
  title,
  tone = 'default',
  trailing,
  onTrailingPress,
}: {
  title: string;
  tone?: 'default' | 'structure' | 'challenged';
  trailing?: string;
  /** When set, the trailing text becomes a 44 px link (See all, New, Browse). */
  onTrailingPress?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: theme.spacing.sm,
      }}
    >
      <Text
        accessibilityRole="header"
        variant="metadata"
        tone={tone === 'default' ? 'default' : tone}
        style={{ fontWeight: '600' }}
      >
        {title}
      </Text>
      {trailing && onTrailingPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={trailing}
          onPress={onTrailingPress}
          hitSlop={10}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text variant="metadata" tone="structure" style={{ fontWeight: '600' }}>
            {trailing}
          </Text>
        </Pressable>
      ) : trailing ? (
        <Text variant="metadata" tone="muted">
          {trailing}
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// TopBar — the screen's own header; the navigator draws none

export function TopBar({
  title,
  crumb,
  onBack,
  rule = true,
  trailing,
}: {
  title: string;
  crumb?: string;
  onBack?: () => void;
  /** The 2 px ink rule under the title block. */
  rule?: boolean;
  trailing?: React.ReactNode;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      {onBack || crumb ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('action.back')}
              onPress={onBack}
              hitSlop={10}
              style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
            >
              <DirectionalIcon direction="back" size={22} color={theme.colors.text} />
            </Pressable>
          ) : null}
          {crumb ? (
            <Text variant="metadata" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              {crumb}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.md }}>
        {/* Wraps, never truncates: a clipped title is a lost fact. */}
        <Text accessibilityRole="header" variant="display" style={{ flex: 1 }} bidi="auto">
          {title}
        </Text>
        {trailing}
      </View>
      {rule ? <View style={{ height: 2, backgroundColor: theme.colors.text }} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// DominantAction — the one filled control a context is allowed

export function DominantAction({
  label,
  onPress,
  disabled = false,
  loading = false,
  inline = false,
  inverse = false,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  /** Topic's inline Practise: 44 px, self-sized. Default is the 54 px footer. */
  inline?: boolean;
  /** Paper fill on an ink band (Learn's Start). */
  inverse?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const inert = disabled || loading;
  // Disabled is a solid paper400 fill, not reduced opacity — a greyed label at
  // 45% opacity fails contrast, per the component spec.
  const background = inert
    ? theme.colors.borderStrong
    : inverse
      ? theme.colors.surface
      : theme.colors.text;
  const labelColor = inert
    ? theme.colors.textMuted
    : inverse
      ? theme.colors.text
      : theme.colors.textInverse;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inert, busy: loading }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: background,
          borderRadius: theme.radius.sm,
          minHeight: inline ? 44 : 54,
          paddingHorizontal: theme.spacing.xl,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: inline ? ('flex-start' as const) : ('stretch' as const),
          opacity: pressed && !inert ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <Text
          variant="bodyStrong"
          style={{ color: labelColor, fontSize: 15.5, lineHeight: 22 }}
          align="center"
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// SecondaryAction — outline beside (or instead of) the dominant one

export function SecondaryAction({
  label,
  onPress,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderWidth: 1.5,
          borderColor: theme.colors.borderStrong,
          borderRadius: theme.radius.sm,
          minHeight: 48,
          paddingHorizontal: theme.spacing.xl,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : disabled ? 0.6 : 1,
        },
        style,
      ]}
    >
      <Text variant="bodyStrong" style={{ fontSize: 15.5, lineHeight: 22 }} align="center">
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// InkBand — the dominant surface Learn (and Home's resume) use

export function InkBand({
  heading,
  detail,
  actionLabel,
  onPress,
  disabled = false,
}: {
  heading: string;
  detail: string;
  actionLabel: string;
  onPress: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.text,
        borderRadius: theme.radius.md,
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
      }}
    >
      <View style={{ gap: theme.spacing.xxs }}>
        <Text variant="bodyStrong" tone="inverse" bidi="auto">
          {heading}
        </Text>
        <Text variant="metadata" style={{ color: theme.colors.borderStrong }} bidi="auto">
          {detail}
        </Text>
      </View>
      <DominantAction label={actionLabel} onPress={onPress} disabled={disabled} inverse inline />
    </View>
  );
}


// ---------------------------------------------------------------------------
// ChipPicker — a single-choice row of chips

/**
 * One choice from a few, laid out as wrapping chips.
 *
 * The selected chip is an ink fill — the same weight the dominant action
 * carries, never teal, and never colour alone: the fill, the label weight and
 * the announced selected state all change together, so the choice survives
 * greyscale and a screen reader alike.
 */
export function ChipPicker<T extends string>({
  options,
  selected,
  onSelect,
  label,
}: {
  options: { value: T; label: string }[];
  selected: T | null;
  onSelect: (value: T) => void;
  /** Labels the radiogroup, so the section title is announced with the chips. */
  label: string;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}
    >
      {options.map((option) => {
        const active = selected === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => onSelect(option.value)}
            style={{
              borderRadius: theme.radius.pill,
              borderWidth: active ? 0 : 1.5,
              borderColor: theme.colors.borderStrong,
              // A choice made is an ink fill — the same weight the dominant
              // action carries, and never teal.
              backgroundColor: active ? theme.colors.text : 'transparent',
              paddingHorizontal: theme.spacing.lg,
              minHeight: 44,
              justifyContent: 'center',
            }}
          >
            <Text
              variant="metadata"
              tone={active ? 'inverse' : 'secondary'}
              style={{ fontWeight: active ? '600' : '500' }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Hairline + 2 px rule helpers

export function Hairline(): React.JSX.Element {
  const theme = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.colors.border }} />;
}

/** The practice header band needs the top inset; exported for reuse. */
export function useTopInset(): number {
  return useSafeAreaInsets().top;
}
