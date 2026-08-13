import { View } from 'react-native';
import { Card, SectionHeader } from '../../src/components/surfaces';
import { Text } from '../../src/components/Text';
import { EmptyState, Screen } from '../../src/components/states';
import { useI18n, type TranslationKey } from '../../src/i18n/index';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Learn shell (§57).
 *
 * The disclaimer at the bottom is not boilerplate. Everything on this screen is
 * built from activity counts, and calling those "progress" or "mastery" would
 * be a claim the data does not support (§35). Naming them learning signals, in
 * the UI and not just in the schema, is part of the product being honest.
 */

const SECTIONS: TranslationKey[] = [
  'learn.myCourses',
  'learn.continue',
  'learn.weakTopics',
  'learn.saved',
  'learn.quizzes',
  'learn.flashcards',
  'learn.aiTutor',
];

export default function Learn(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();

  return (
    <Screen scroll>
      <Text variant="display">{t('learn.title')}</Text>

      <Card>
        <View style={{ height: 180 }}>
          <EmptyState
            title={t('learn.empty.title')}
            body={t('learn.empty.body')}
            action={{ label: t('learn.empty.action'), onPress: () => {} }}
          />
        </View>
      </Card>

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader title={t('phase.comingSoon.title')} />
        {SECTIONS.map((key) => (
          <Card key={key}>
            <Text variant="bodyStrong" tone="muted">
              {t(key)}
            </Text>
          </Card>
        ))}
      </View>

      <Text variant="caption" tone="muted">
        {t('learn.signalsDisclaimer')}
      </Text>
    </Screen>
  );
}
