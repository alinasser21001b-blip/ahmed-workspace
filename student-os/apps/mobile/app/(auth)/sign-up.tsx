import { Link, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { DominantAction } from '../../src/components/editorial';
import { Input } from '../../src/components/Input';
import { Text } from '../../src/components/Text';
import { Screen } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Enter } from '../../src/motion/index';
import { messageKeyFor } from './sign-in';

/** Account creation. Academic identity is collected afterwards, in onboarding. */
export default function SignUp(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { signUp } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Mirrors the server's rule (@sos/contracts passwordSchema). Validating in
  // the client is a courtesy, never the enforcement — the server rejects
  // regardless.
  const passwordTooShort = password.length > 0 && password.length < 10;
  const canSubmit = email.trim().length > 3 && password.length >= 10 && !submitting;

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await signUp(email.trim(), password);
      router.replace('/');
    } catch (caught) {
      setError(t(messageKeyFor(caught)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <Enter>
      <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.xxl }}>
        <Text variant="display">{t('auth.signUp.title')}</Text>
        <Text variant="body" tone="muted">
          {t('auth.signUp.subtitle')}
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
          {...(error ? { error } : {})}
        />
        <Input
          label={t('auth.password')}
          hint={t('auth.password.hint')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          {...(passwordTooShort ? { error: t('auth.password.hint') } : {})}
        />
      </View>

      <DominantAction
        label={t('auth.signUp.title')}
        onPress={() => void submit()}
        loading={submitting}
        disabled={!canSubmit}
      />

      <Link href="/(auth)/sign-in" asChild>
        <Text variant="label" tone="secondary" align="center" accessibilityRole="link">
          {t('auth.haveAccount')}
        </Text>
      </Link>
      </Enter>
    </Screen>
  );
}
