import { Link, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { NetworkError } from '../../src/api/client';
import { Button } from '../../src/components/Button';
import { Input } from '../../src/components/Input';
import { Text } from '../../src/components/Text';
import { Screen } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Request a password reset link.
 *
 * The confirmation screen is shown after every submission that reaches the
 * server, with no branch on the outcome — the server's response is
 * deliberately identical whether or not the email belongs to an account
 * (`auth.routes.ts`), and a client that displayed a different message for
 * "sent" versus "no such account" would rebuild the enumeration hole the
 * server was built to close. Only a network failure — the request never
 * reaching the server at all — gets a different screen, because that is a
 * true statement about what happened, not a guess about the account.
 */
export default function ForgotPassword(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { requestPasswordReset } = useSession();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setNetworkError(false);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (caught) {
      // Any non-network failure (validation, rate limit) still resolves to
      // the same confirmation screen — see the module doc for why.
      if (caught instanceof NetworkError) setNetworkError(true);
      else setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = email.trim().length > 3 && !submitting;

  if (sent) {
    return (
      <Screen scroll>
        <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.xxl }}>
          <Text variant="display">{t('auth.forgotPassword.sent.title')}</Text>
          <Text variant="body" tone="muted">
            {t('auth.forgotPassword.sent.body')}
          </Text>
        </View>
        <Button
          label={t('auth.backToSignIn')}
          onPress={() => router.replace('/(auth)/sign-in')}
          size="lg"
          fullWidth
        />
      </Screen>
    );
  }



  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.xxl }}>
        <Text variant="display">{t('auth.forgotPassword.title')}</Text>
        <Text variant="body" tone="muted">
          {t('auth.forgotPassword.subtitle')}
        </Text>
      </View>

      <Input
        label={t('auth.email')}
        placeholder={t('auth.email.placeholder')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        {...(networkError ? { error: t('state.offline') } : {})}
      />

      <Button
        label={t('auth.forgotPassword.submit')}
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
