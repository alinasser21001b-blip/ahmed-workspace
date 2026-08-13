import { ActivityIndicator, ScrollView, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/index';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Text } from './Text';

/**
 * Screen scaffold and the four states every async surface must have (§65, §66).
 *
 * These exist as components specifically so that "we forgot the empty state" is
 * visible in review: a screen that renders a list without an `EmptyState`
 * branch is obviously incomplete, whereas an ad-hoc `{items.length === 0 &&
 * null}` is not.
 */

export function Screen({
  children,
  scroll = false,
  padded = true,
  edges = ['top'],
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: Edge[];
  style?: ViewStyle;
}): React.JSX.Element {
  const theme = useTheme();
  const container: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background,
  };
  const inner: ViewStyle = {
    padding: padded ? theme.spacing.lg : 0,
    gap: theme.spacing.lg,
    ...style,
  };

  return (
    <SafeAreaView style={container} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[inner, { paddingBottom: theme.spacing.xxxl }]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function LoadingState({ label }: { label?: string }): React.JSX.Element {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t('state.loading')}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md }}
    >
      <ActivityIndicator color={theme.colors.primary} />
      <Text variant="caption" tone="muted">
        {label ?? t('state.loading')}
      </Text>
    </View>
  );
}

/**
 * Empty states always carry an action. "No study groups yet" with no way to
 * make one is a dead end, and dead ends are what make a new product feel empty
 * rather than new.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.xl,
      }}
    >
      <Text variant="heading" align="center">
        {title}
      </Text>
      <Text variant="body" tone="muted" align="center">
        {body}
      </Text>
      {action ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          variant="primary"
          style={{ marginTop: theme.spacing.md }}
        />
      ) : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View
      accessibilityRole="alert"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.xl,
      }}
    >
      <Text variant="heading" tone="danger" align="center">
        {t('state.error.title')}
      </Text>
      <Text variant="body" tone="muted" align="center">
        {message ?? t('state.error.body')}
      </Text>
      {onRetry ? (
        <Button
          label={t('action.retry')}
          onPress={onRetry}
          variant="secondary"
          style={{ marginTop: theme.spacing.md }}
        />
      ) : null}
    </View>
  );
}

/** Placeholder block used while content loads, sized to the content it replaces. */
export function Skeleton({
  height = 16,
  width = '100%',
  radiusKey = 'sm',
}: {
  height?: number;
  width?: number | `${number}%`;
  radiusKey?: 'sm' | 'md' | 'lg';
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height,
        width,
        borderRadius: theme.radius[radiusKey],
        backgroundColor: theme.colors.border,
        opacity: 0.6,
      }}
    />
  );
}
