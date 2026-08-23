import type { PrivacySettings, Visibility } from '@sos/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChipPicker, TopBar } from '../../src/components/editorial';
import { Text } from '../../src/components/Text';
import { SectionHeader } from '../../src/components/surfaces';
import { ErrorState, LoadingState } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Enter } from '../../src/motion/index';

/**
 * Privacy settings — the five fields the contract supports and the product
 * can actually honour (24-APP-STORE-SURFACES.md).
 *
 * `showOnlineStatus` and `showLastSeen` exist on the server and govern a
 * presence feature that does not. They are not drawn: a toggle that controls
 * nothing is the dead control the product ruled out in Phase 3.
 */

const SCOPES: Visibility[] = ['stage', 'college', 'university', 'private'];

function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingVertical: theme.spacing.md,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        gap: theme.spacing.xs,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Text variant="body" style={{ flex: 1 }}>
          {label}
        </Text>
        <Switch
          accessibilityLabel={label}
          accessibilityHint={hint}
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: theme.colors.borderStrong, true: theme.colors.text }}
          thumbColor={theme.colors.surface}
        />
      </View>
      <Text variant="metadata" tone="muted">
        {hint}
      </Text>
    </View>
  );
}

export default function PrivacySettingsScreen(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      setSettings(await api.get<PrivacySettings>('/v1/me/privacy'));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (next: Partial<PrivacySettings>): Promise<void> => {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, ...next });
    try {
      setSettings(await api.patch<PrivacySettings>('/v1/me/privacy', next));
    } catch {
      setSettings(previous);
    }
  };

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState />
      </SafeAreaView>
    );
  }
  if (status === 'error' || !settings) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  const scopeOptions = SCOPES.map((value) => ({
    value,
    label: t(`settings.privacy.scope.${value}` as 'settings.privacy.scope.stage'),
  }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.xl }}>
        <Enter>
        <TopBar title={t('settings.privacy')} onBack={() => router.back()} rule={false} />

        <View>
          <SectionHeader title={t('settings.privacy.whoCanSee')} />
          <View style={{ gap: theme.spacing.lg, paddingTop: theme.spacing.md }}>
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="body">{t('settings.privacy.profileVisibility')}</Text>
              <ChipPicker
                label={t('settings.privacy.profileVisibility')}
                options={scopeOptions}
                selected={settings.profileVisibility}
                onSelect={(value) => void patch({ profileVisibility: value })}
              />
            </View>
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="body">{t('settings.privacy.defaultPostVisibility')}</Text>
              <ChipPicker
                label={t('settings.privacy.defaultPostVisibility')}
                options={scopeOptions}
                selected={settings.defaultPostVisibility}
                onSelect={(value) => void patch({ defaultPostVisibility: value })}
              />
            </View>
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="body">{t('settings.privacy.whoCanMessage')}</Text>
              <ChipPicker
                label={t('settings.privacy.whoCanMessage')}
                options={scopeOptions}
                selected={settings.whoCanMessage}
                onSelect={(value) => void patch({ whoCanMessage: value })}
              />
            </View>
          </View>
        </View>

        <View>
          <SectionHeader title={t('settings.privacy.discovery')} />
          <ToggleRow
            label={t('settings.privacy.searchable')}
            hint={t('settings.privacy.searchable.off')}
            value={settings.searchable}
            onValueChange={(searchable) => void patch({ searchable })}
          />
          <ToggleRow
            label={t('settings.privacy.showActivity')}
            hint={t('settings.privacy.showActivity.off')}
            value={settings.showActivity}
            onValueChange={(showActivity) => void patch({ showActivity })}
          />
        </View>
        </Enter>
      </ScrollView>
    </SafeAreaView>
  );
}
