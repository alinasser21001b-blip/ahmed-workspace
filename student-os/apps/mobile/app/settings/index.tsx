import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { Text } from '../../src/components/Text';
import { Card, SectionHeader } from '../../src/components/surfaces';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useSupportLinks } from '../../src/state/support-links';

/**
 * Settings.
 *
 * A new top-level surface, not present before this pass. Every row exists
 * because App Review requires the capability to be reachable from inside the
 * app: sign-out, the blocked-accounts list (Guideline 1.2), the support and
 * privacy links (Guidelines 1.5 and 5.1.1(i)), and account deletion
 * (Guideline 5.1.1(v)).
 */
function Row({
  label,
  onPress,
  tone = 'default',
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="body" tone={tone === 'danger' ? 'danger' : 'default'}>
            {label}
          </Text>
          <DirectionalIcon direction="forward" size={18} color={theme.colors.textMuted} />
        </View>
      </Card>
    </Pressable>
  );
}

export default function SettingsScreen(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { signOut } = useSession();
  const links = useSupportLinks();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('action.back')}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <DirectionalIcon direction="back" size={24} color={theme.colors.text} />
          </Pressable>
          <Text variant="heading">{t('settings.title')}</Text>
        </View>

        <View>
          <SectionHeader title={t('settings.account')} />
          <View style={{ gap: theme.spacing.sm }}>
            <Row label={t('settings.blocked')} onPress={() => router.push('/settings/blocked')} />
            <Row label={t('settings.signOut')} onPress={() => void signOut()} />
          </View>
        </View>

        <View>
          <SectionHeader title={t('settings.support')} />
          <View style={{ gap: theme.spacing.sm }}>
            {links.supportUrl ? (
              <Row
                label={t('settings.support.help')}
                onPress={() => void Linking.openURL(links.supportUrl!)}
              />
            ) : null}
            {links.privacyPolicyUrl ? (
              <Row
                label={t('settings.support.privacy')}
                onPress={() => void Linking.openURL(links.privacyPolicyUrl!)}
              />
            ) : null}
            {links.termsUrl ? (
              <Row
                label={t('settings.support.terms')}
                onPress={() => void Linking.openURL(links.termsUrl!)}
              />
            ) : null}
          </View>
        </View>

        <View>
          <SectionHeader title={t('settings.deleteAccount')} />
          <Text variant="micro" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
            {t('settings.deleteAccount.body')}
          </Text>
          <Row
            label={t('settings.deleteAccount')}
            tone="danger"
            onPress={() => router.push('/settings/delete-account')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
