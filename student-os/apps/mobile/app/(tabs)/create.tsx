import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Card } from '../../src/components/surfaces';
import { Text } from '../../src/components/Text';
import { Screen } from '../../src/components/states';
import { useI18n, type TranslationKey } from '../../src/i18n/index';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Create sheet (§56).
 *
 * The order is a product statement: academic objects (question, resource,
 * study session) sit alongside social ones rather than below them. Instructor-
 * only options (lecture, quiz, assignment, announcement, live) appear for
 * instructors in a later phase, gated by role.
 */

interface CreateOption {
  key: TranslationKey;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: 'social' | 'academic';
  /** Null until the phase that ships it — shown, but visibly not yet available. */
  route: '/compose' | null;
}

const OPTIONS: CreateOption[] = [
  { key: 'create.post', icon: 'create-outline', tone: 'social', route: '/compose' },
  { key: 'create.reel', icon: 'videocam-outline', tone: 'social', route: null },
  { key: 'create.question', icon: 'help-circle-outline', tone: 'academic', route: null },
  { key: 'create.poll', icon: 'stats-chart-outline', tone: 'social', route: null },
  { key: 'create.resource', icon: 'document-attach-outline', tone: 'academic', route: null },
  { key: 'create.studySession', icon: 'time-outline', tone: 'academic', route: null },
];

export default function Create(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();

  return (
    <Screen scroll>
      <Text variant="display">{t('create.title')}</Text>

      <View style={{ gap: theme.spacing.md }}>
        {OPTIONS.map((option) => (
          <Card
            key={option.key}
            onPress={option.route ? () => router.push(option.route!) : undefined}
            accessibilityLabel={t(option.key)}
            style={option.route ? undefined : { opacity: 0.55 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: theme.radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor:
                    option.tone === 'academic' ? theme.colors.primarySoft : theme.colors.background,
                }}
              >
                <Ionicons
                  name={option.icon}
                  size={20}
                  color={option.tone === 'academic' ? theme.colors.structure : theme.colors.text}
                />
              </View>
              <Text variant="bodyStrong">{t(option.key)}</Text>
              <View style={{ flex: 1 }} />
              {option.route ? null : (
                <Text variant="metadata" tone="muted">
                  {t('phase.comingSoon.title')}
                </Text>
              )}
            </View>
          </Card>
        ))}
      </View>

      <Text variant="caption" tone="muted">
        {t('phase.comingSoon.body')}
      </Text>
    </Screen>
  );
}
