import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { useI18n } from '../i18n/index';
import { useTheme } from '../theme/ThemeProvider';
import { previewBannerLabel } from './preview-mode';

/**
 * The preview marker, and the way to answer it.
 *
 * One thin line above the app: enough that nobody mistakes sample data for the
 * product, small enough that it does not distort a single screen underneath.
 * Renders nothing at all outside a preview build — the label resolves to null
 * and the component returns null, so production carries no banner code path
 * that could accidentally activate.
 *
 * The feedback control lives here rather than inside Settings on purpose. A
 * student is asked to judge screens, and the moment worth capturing is the one
 * where a screen confused them — which is any screen, not the one they would
 * have to navigate away to reach. Putting it in the banner makes it reachable
 * from all of them without adding a control to any of them.
 */
export function PreviewBanner(): React.JSX.Element | null {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const label = previewBannerLabel();
  if (!label) return null;

  return (
    <View
      style={{
        backgroundColor: theme.colors.text,
        paddingTop: insets.top,
        paddingBottom: 4,
        paddingHorizontal: theme.spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
      }}
    >
      <Text variant="metadata" tone="inverse" style={{ flex: 1 }} numberOfLines={1}>
        {label} — sample data · بيانات تجريبية
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('preview.feedback.open')}
        onPress={() => router.push('/preview-feedback')}
        hitSlop={12}
        // The banner is thin by design, so the target is made by the box rather
        // than by the line height it sits in.
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text
          variant="metadata"
          tone="inverse"
          style={{ fontWeight: '600', textDecorationLine: 'underline' }}
        >
          {t('preview.feedback.open')}
        </Text>
      </Pressable>
    </View>
  );
}
