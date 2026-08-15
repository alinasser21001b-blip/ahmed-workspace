import type { DeleteAccountRequest, DeleteAccountResponse } from '@sos/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../src/api/client';
import { Button } from '../../src/components/Button';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { Text } from '../../src/components/Text';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Account deletion, end to end (App Review Guideline 5.1.1(v)).
 *
 * Two deliberate frictions, and neither is decorative:
 *
 *   1. The account password, re-entered here. An access token that leaked from
 *      a shared device is enough to read someone's messages; it must not also
 *      be enough to irreversibly destroy their account.
 *   2. Typing the literal word DELETE. A single confirm button is one
 *      mis-tap away from an action that cannot be undone.
 *
 * On success the client forgets its local session (not `signOut`, which calls
 * `/v1/auth/logout` — a call that would fail because the account and its
 * sessions no longer exist) and returns to the signed-out state.
 */
export default function DeleteAccountScreen(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { api, forgetLocalSession } = useSession();

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DeleteAccountResponse | null>(null);

  const canSubmit = password.length > 0 && confirmation === 'DELETE' && !submitting;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: DeleteAccountRequest = { password, confirmation: 'DELETE' };
      const result = await api.request<DeleteAccountResponse>('/v1/me/account', {
        method: 'DELETE',
        body,
      });
      setDone(result);
      await forgetLocalSession();
      router.replace('/(auth)/sign-in');
    } catch (thrown) {
      setError(
        thrown instanceof ApiError && thrown.code === 'UNAUTHENTICATED'
          ? t('auth.error.invalidCredentials')
          : t('error.generic'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('action.back')}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <DirectionalIcon direction="back" size={24} color={theme.colors.text} />
          </Pressable>
          <Text variant="heading">{t('settings.deleteAccount')}</Text>
        </View>

        <Text variant="body" tone="muted">
          {t('settings.deleteAccount.confirmBody')}
        </Text>

        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="label">{t('settings.deleteAccount.password')}</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              padding: theme.spacing.sm,
              color: theme.colors.text,
            }}
          />
        </View>

        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="label">{t('settings.deleteAccount.confirmField')}</Text>
          <TextInput
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="characters"
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor:
                confirmation.length > 0 && confirmation !== 'DELETE'
                  ? theme.colors.danger
                  : theme.colors.border,
              borderRadius: theme.radius.md,
              padding: theme.spacing.sm,
              color: theme.colors.text,
            }}
          />
          {confirmation.length > 0 && confirmation !== 'DELETE' ? (
            <Text variant="micro" tone="danger">
              {t('settings.deleteAccount.wrongConfirmation')}
            </Text>
          ) : null}
        </View>

        {error ? (
          <Text variant="micro" tone="danger">
            {error}
          </Text>
        ) : null}

        {done ? (
          <Text variant="body" tone="muted">
            {t('settings.deleteAccount.success')}
          </Text>
        ) : (
          <Button
            label={t('settings.deleteAccount.submit')}
            variant="danger"
            fullWidth
            disabled={!canSubmit}
            loading={submitting}
            onPress={() => void submit()}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
