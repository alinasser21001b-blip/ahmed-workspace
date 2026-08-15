import { Link, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ApiError, NetworkError } from '../../src/api/client';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { Text } from '../../src/components/Text';
import { Screen } from '../../src/components/states';
import { useI18n, type TranslationKey } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Redeem a reset token for a new password.
 *
 * Reached one of two ways: a deep link (`studentos://reset-password?token=…`,
 * once a mail provider is wired in to send one — see `platform/mailer.ts`)
 * pre-fills the token field, or the field is edited by hand. Either way the
 * field stays a plain, visible text input rather than something masked: the
 * value is a one-time, already-expiring, single-use token, not a password —
 * hiding it protects nothing and only makes a mis-paste harder to catch.
 *
 * On success the returned session is adopted the same way sign-in adopts one,
 * so completing a reset drops the student straight into the app rather than
 * back at the sign-in screen to type the password they just chose.
 */
export default function ResetPassword(): React.JSX.Element {
  const params = useLocalSearchParams<{ token?: string }>();
  const { t } = useI18n();
  const theme = useTheme();
  const { resetPassword } = useSession();

  const [token, setToken] = useState(params.token ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await resetPassword(token.trim(), newPassword);
      router.replace('/');
    } catch (caught) {
      setError(t(messageKeyFor(caught)));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = token.trim().length > 10 && newPassword.length >= 10 && !submitting;

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.xxl }}>
        <Text variant="display">{t('auth.resetPassword.title')}</Text>
        <Text variant="body" tone="muted">
          {t('auth.resetPassword.subtitle')}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.lg }}>
        <Input
          label={t('auth.resetPassword.token')}
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <Input
          label={t('auth.resetPassword.newPassword')}
          hint={t('auth.password.hint')}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          {...(error ? { error } : {})}
        />
      </View>

      <Button
        label={t('auth.resetPassword.submit')}
        onPress={() => void submit()}
        loading={submitting}
        disabled={!canSubmit}
        size="lg"
        fullWidth
      />

      <Link href="/(auth)/sign-in" asChild>
        <Text variant="label" tone="primary" align="center" accessibilityRole="link">
          {t('auth.backToSignIn')}
        </Text>
      </Link>
    </Screen>
  );
}

function messageKeyFor(caught: unknown): TranslationKey {
  if (caught instanceof NetworkError) return 'state.offline';
  if (caught instanceof ApiError && caught.code === 'UNAUTHENTICATED') {
    return 'auth.error.resetTokenInvalid';
  }
  return 'state.error.body';
}
