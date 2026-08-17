import { Link, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { NetworkError } from '../../src/api/client';
import { DominantAction } from '../../src/components/editorial';
import { Input } from '../../src/components/Input';
import { Text } from '../../src/components/Text';
import { Screen } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Enter } from '../../src/motion/index';

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
        <Enter>
        {/*
         * The sent state replaces the form on the same route, and announces
         * itself: without a live region a screen-reader user submits and hears
         * nothing, with no way to tell whether anything happened. The submit
         * control is gone rather than disabled, so the same request cannot be
         * fired repeatedly at a rate limiter the UI cannot see.
         */}
        <View
          accessibilityLiveRegion="polite"
          style={{ gap: theme.spacing.xs, marginTop: theme.spacing.xxl }}
        >
          <Text accessibilityRole="header" variant="display">
            {t('auth.forgotPassword.sent.title')}
          </Text>
          <Text variant="body" tone="secondary">
            {t('auth.forgotPassword.sent.body')}
          </Text>
        </View>
        <DominantAction
          label={t('auth.backToSignIn')}
          onPress={() => router.replace('/(auth)/sign-in')}
        />
        </Enter>
      </Screen>
    );
  }

  return (
    <Screen scroll>
        <Enter>
      <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.xxl }}>
        <Text accessibilityRole="header" variant="display">
          {t('auth.forgotPassword.title')}
        </Text>
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

      <DominantAction
        label={t('auth.forgotPassword.submit')}
        onPress={() => void submit()}
        loading={submitting}
        disabled={!canSubmit}
      />

      <Link href="/(auth)/sign-in" asChild>
        <Text variant="label" tone="secondary" align="center" accessibilityRole="link">
          {t('auth.backToSignIn')}
        </Text>
      </Link>
        </Enter>
      </Screen>
  );
}
