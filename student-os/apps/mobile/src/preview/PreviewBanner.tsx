import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeProvider';
import { previewBannerLabel } from './preview-mode';

/**
 * The preview marker.
 *
 * One thin line above the app: enough that nobody mistakes sample data for the
 * product, small enough that it does not distort a single screen underneath.
 * Renders nothing at all outside a preview build — the label resolves to null
 * and the component returns null, so production carries no banner code path
 * that could accidentally activate.
 */
export function PreviewBanner(): React.JSX.Element | null {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const label = previewBannerLabel();
  if (!label) return null;

  return (
    <View
      accessibilityRole="text"
      style={{
        backgroundColor: theme.colors.text,
        paddingTop: insets.top,
        paddingBottom: 4,
        paddingHorizontal: theme.spacing.lg,
        alignItems: 'center',
      }}
    >
      <Text variant="metadata" tone="inverse">
        {label} — sample data · بيانات تجريبية
      </Text>
    </View>
  );
}
