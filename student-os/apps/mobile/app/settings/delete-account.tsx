import type { DeleteAccountRequest, DeleteAccountResponse } from '@sos/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../src/api/client';
import { Button } from '../../src/components/Button';
import { TopBar } from '../../src/components/editorial';
import { Text } from '../../src/components/Text';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useSupportLinks } from '../../src/state/support-links';
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
  const supportUrl = useSupportLinks().supportUrl;

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrongPassword, setWrongPassword] = useState(false);
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
      /*
       * Two distinct failures, never collapsed into one. A wrong password
       * attaches to the password field and needs no support route; anything
       * else is generic and carries the support link, because a person whose
       * deletion keeps failing has a right to reach a human.
       *
       * Nothing was destroyed either way — the deletion is one transaction.
       */
      const wrongPassword =
        thrown instanceof ApiError && thrown.code === 'UNAUTHENTICATED';
      setWrongPassword(wrongPassword);
      setError(wrongPassword ? t('auth.error.invalidCredentials') : t('error.generic'));
      // The form keeps its confirmation; only the password clears.
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <TopBar
          title={t('settings.deleteAccount')}
          onBack={() => router.back()}
          rule={false}
        />

        {/*
         * State 2 — the warning, above the fields and never collapsed behind a
         * disclosure, so what is destroyed is read before anything is typed.
         * The body states what survives rather than promising an erasure the
         * backend does not perform.
         */}
        <Text variant="body" tone="secondary">
          {t('settings.deleteAccount.body')}
        </Text>
        <Text variant="metadata" tone="muted">
          {t('settings.deleteAccount.survives')}
        </Text>
        <Text variant="body" tone="secondary">
          {t('settings.deleteAccount.confirmBody')}
        </Text>

        {/* State 5 — success replaces the control, so the irreversible action
            cannot be pressed twice. */}
        {done ? (
          <View accessibilityLiveRegion="polite">
            <Text variant="bodyStrong">{t('settings.deleteAccount.success')}</Text>
          </View>
        ) : (
          <>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="metadata" style={{ fontWeight: '600' }}>
                {t('settings.deleteAccount.password')}
              </Text>
              <TextInput
                accessibilityLabel={t('settings.deleteAccount.password')}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                editable={!submitting}
                autoComplete="password"
                textContentType="password"
                style={{
                  borderWidth: wrongPassword ? 2 : 1.5,
                  borderColor: wrongPassword
                    ? theme.colors.danger
                    : theme.colors.borderStrong,
                  borderRadius: theme.radius.sm,
                  paddingHorizontal: theme.spacing.md,
                  minHeight: 50,
                  color: theme.colors.text,
                  // A password is never RTL: it is a credential, not prose.
                  writingDirection: 'ltr',
                  textAlign: 'left',
                }}
              />
            </View>

            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="metadata" style={{ fontWeight: '600' }}>
                {t('settings.deleteAccount.confirmField')}
              </Text>
              <TextInput
                accessibilityLabel={t('settings.deleteAccount.confirmField')}
                value={confirmation}
                onChangeText={setConfirmation}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!submitting}
                style={{
                  borderWidth: confirmation.length > 0 && confirmation !== 'DELETE' ? 2 : 1.5,
                  borderColor:
                    confirmation.length > 0 && confirmation !== 'DELETE'
                      ? theme.colors.danger
                      : theme.colors.borderStrong,
                  borderRadius: theme.radius.sm,
                  paddingHorizontal: theme.spacing.md,
                  minHeight: 50,
                  color: theme.colors.text,
                  // The literal is deliberately untranslated, so it stays LTR.
                  writingDirection: 'ltr',
                  textAlign: 'left',
                }}
              />
              {confirmation.length > 0 && confirmation !== 'DELETE' ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={{
                    borderStartWidth: 2,
                    borderStartColor: theme.colors.danger,
                    paddingStart: 11,
                  }}
                >
                  <Text variant="metadata" tone="danger">
                    {t('settings.deleteAccount.wrongConfirmation')}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* States 6 and 7 — the failure region. Retry is re-pressing the
                control below, which is live again the moment the request
                settles; the support link appears on the generic branch only. */}
            {error ? (
              <View
                accessibilityLiveRegion="polite"
                style={{
                  borderStartWidth: 2,
                  borderStartColor: theme.colors.danger,
                  paddingStart: 11,
                  gap: theme.spacing.xs,
                }}
              >
                <Text variant="metadata" tone="danger">
                  {error}
                </Text>
                {!wrongPassword && supportUrl ? (
                  <Text
                    variant="metadata"
                    tone="structure"
                    accessibilityRole="link"
                    onPress={() => void Linking.openURL(supportUrl)}
                    style={{ textDecorationLine: 'underline' }}
                  >
                    {t('settings.support.help')}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* States 3 and 4 — inert until both gates pass, and the control
                holds its own label while busy: swapping it for "Deleting…"
                or showing a progress figure the API does not report would
                describe something that is not happening. */}
            <Button
              label={t('settings.deleteAccount.submit')}
              variant="danger"
              fullWidth
              disabled={!canSubmit}
              loading={submitting}
              onPress={() => void submit()}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
