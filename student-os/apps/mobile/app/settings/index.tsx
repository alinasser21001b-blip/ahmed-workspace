import { router } from 'expo-router';
import { Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TopBar } from '../../src/components/editorial';
import { AcademicRow } from '../../src/components/rows';
import { Text } from '../../src/components/Text';
import { SectionHeader } from '../../src/components/surfaces';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Enter } from '../../src/motion/index';
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
  return (
    <AcademicRow onPress={onPress} accessibilityLabel={label} chevron>
      <Text variant="body" tone={tone === 'danger' ? 'danger' : 'default'}>
        {label}
      </Text>
    </AcademicRow>
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
        contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.xl }}
      >
        <Enter>
        <TopBar title={t('settings.title')} onBack={() => router.back()} rule={false} />

        <View>
          <SectionHeader title={t('settings.account')} />
          <View>
            <Row label={t('settings.blocked')} onPress={() => router.push('/settings/blocked')} />
            <Row label={t('settings.privacy')} onPress={() => router.push('/settings/privacy')} />
            <Row label={t('settings.signOut')} onPress={() => void signOut()} />
          </View>
        </View>

        {/*
         * Notifications are BLOCKED_BY_PRODUCT_CAPABILITY: the schema, the
         * rules and push-token storage all exist, but there is no producer,
         * no drain and no route. Stating that is the honest surface — a
         * toggle here would control nothing, and a tray would be empty by
         * construction rather than because nothing happened.
         */}
        <View style={{ gap: theme.spacing.xs }}>
          <SectionHeader title={t('nav.notifications')} />
          <Text variant="body" tone="secondary">
            {t('notifications.blocked.title')}
          </Text>
          <Text variant="metadata" tone="muted">
            {t('notifications.blocked.body')}
          </Text>
        </View>

        <View>
          <SectionHeader title={t('settings.support')} />
          <View>
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
          <Text variant="metadata" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
            {t('settings.deleteAccount.body')}
          </Text>
          <Row
            label={t('settings.deleteAccount')}
            tone="danger"
            onPress={() => router.push('/settings/delete-account')}
          />
        </View>
        </Enter>
      </ScrollView>
    </SafeAreaView>
  );
}
