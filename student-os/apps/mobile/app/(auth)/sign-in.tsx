import { Link, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ApiError, NetworkError } from '../../src/api/client';
import { DominantAction } from '../../src/components/editorial';
import { Input } from '../../src/components/Input';
import { Text } from '../../src/components/Text';
import { Screen } from '../../src/components/states';
import { useI18n, type TranslationKey } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Sign in.
 *
 * Server error codes are mapped to translated messages here rather than
 * displaying `error.message` directly: the server's message is English and
 * deliberately generic, while the user needs their own language and a hint
 * about what to do next.
 */
export default function SignIn(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { signIn } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace('/');
    } catch (caught) {
      setError(t(messageKeyFor(caught)));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = email.trim().length > 3 && password.length > 0 && !submitting;

  return (
    <Screen scroll>
      <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.xxl }}>
        <Text variant="display">{t('auth.signIn.title')}</Text>
        <Text variant="body" tone="muted">
          {t('auth.signIn.subtitle')}
        </Text>
      </View>

      <View style={{ gap: theme.spacing.lg }}>
        <Input
          label={t('auth.email')}
          placeholder={t('auth.email.placeholder')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <Input
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          {...(error ? { error } : {})}
        />
        <Link href="/(auth)/forgot-password" asChild>
          <Text variant="label" tone="secondary" accessibilityRole="link">
            {t('auth.forgotPassword.link')}
          </Text>
        </Link>
      </View>

      <DominantAction
        label={t('auth.signIn.title')}
        onPress={() => void submit()}
        loading={submitting}
        disabled={!canSubmit}
      />

      <Link href="/(auth)/sign-up" asChild>
        <Text variant="label" tone="secondary" align="center" accessibilityRole="link">
          {t('auth.noAccount')}
        </Text>
      </Link>
    </Screen>
  );
}

export function messageKeyFor(caught: unknown): TranslationKey {
  if (caught instanceof NetworkError) return 'state.offline';
  if (caught instanceof ApiError) {
    if (caught.code === 'UNAUTHENTICATED') return 'auth.error.invalidCredentials';
    if (caught.code === 'ACCOUNT_SUSPENDED') return 'auth.error.suspended';
    if (caught.code === 'CONFLICT') return 'auth.error.emailTaken';
  }
  return 'state.error.body';
}
