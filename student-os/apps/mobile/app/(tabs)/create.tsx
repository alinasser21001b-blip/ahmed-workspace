import Ionicons from '@expo/vector-icons/Ionicons';
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

const OPTIONS: { key: TranslationKey; icon: React.ComponentProps<typeof Ionicons>['name']; tone: 'social' | 'learning' }[] = [
  { key: 'create.post', icon: 'create-outline', tone: 'social' },
  { key: 'create.reel', icon: 'videocam-outline', tone: 'social' },
  { key: 'create.question', icon: 'help-circle-outline', tone: 'learning' },
  { key: 'create.poll', icon: 'stats-chart-outline', tone: 'social' },
  { key: 'create.resource', icon: 'document-attach-outline', tone: 'learning' },
  { key: 'create.studySession', icon: 'time-outline', tone: 'learning' },
];

export default function Create(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();

  return (
    <Screen scroll>
      <Text variant="display">{t('create.title')}</Text>

      <View style={{ gap: theme.spacing.md }}>
        {OPTIONS.map((option) => (
          <Card key={option.key} onPress={() => {}} accessibilityLabel={t(option.key)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: theme.radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor:
                    option.tone === 'learning' ? theme.colors.learningSoft : theme.colors.primarySoft,
                }}
              >
                <Ionicons
                  name={option.icon}
                  size={20}
                  color={option.tone === 'learning' ? theme.colors.learning : theme.colors.primary}
                />
              </View>
              <Text variant="bodyStrong">{t(option.key)}</Text>
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
