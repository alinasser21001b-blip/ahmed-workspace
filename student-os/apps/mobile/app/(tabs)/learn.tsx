import type { LearnOverview } from '@sos/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '../../src/components/Text';
import { Badge, Card, SectionHeader } from '../../src/components/surfaces';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Learn (§57, Phase 5).
 *
 * Previously a shell whose only control did nothing. It now shows what the
 * system actually knows about this student, and nothing else: topics they have
 * answered questions on, topics they declared an interest in, how much they
 * have saved, and how many meaningful learning actions they took this week.
 *
 * Two rules shape every section here:
 *
 *  1. **A section with no data is absent.** A "Quizzes" card that leads
 *     nowhere teaches students that the tab is decorative, which is worse than
 *     a shorter screen.
 *  2. **A weakness signal is a count, never a verdict.** Where the sample is
 *     too small to conclude anything the API says so and the row says so too —
 *     the alternative is a number that looks like an assessment and is not
 *     (ADR-0014).
 */

export default function Learn(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [overview, setOverview] = useState<LearnOverview | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'refreshing'>('loading');

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial'): Promise<void> => {
      setStatus(mode === 'refresh' ? 'refreshing' : 'loading');
      try {
        setOverview(await api.get<LearnOverview>('/v1/learn'));
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    },
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error' || !overview) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  /*
   * "Nothing yet" is a real state for a new student, not a failure. It gets the
   * empty state rather than a screen of zeroes, because a zero next to a label
   * like "topics to review" reads as a judgement about the student.
   */
  const hasAnything =
    overview.focusTopics.length > 0 ||
    overview.interestTopics.length > 0 ||
    overview.savedCount > 0 ||
    overview.meaningfulActionsThisWeek > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.lg,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={status === 'refreshing'}
            onRefresh={() => void load('refresh')}
            tintColor={theme.colors.primary}
          />
        }
      >
        <Text variant="display">{t('learn.title')}</Text>

        {!hasAnything ? (
          <View style={{ minHeight: 260 }}>
            <EmptyState
              title={t('learn.empty.real.title')}
              body={t('learn.empty.real.body')}
              action={{ label: t('nav.home'), onPress: () => router.push('/(tabs)') }}
            />
          </View>
        ) : null}

        {/* The two counts, side by side. Both are literal row counts. */}
        {overview.savedCount > 0 || overview.meaningfulActionsThisWeek > 0 ? (
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            {overview.savedCount > 0 ? (
              <View style={{ flex: 1 }}>
                <Card>
                  <Text variant="display">{overview.savedCount}</Text>
                  <Text variant="caption" tone="muted">
                    {t('learn.savedCount')}
                  </Text>
                </Card>
              </View>
            ) : null}
            {overview.meaningfulActionsThisWeek > 0 ? (
              <View style={{ flex: 1 }}>
                <Card>
                  <Text variant="display">{overview.meaningfulActionsThisWeek}</Text>
                  <Text variant="caption" tone="muted">
                    {t('learn.thisWeek')}
                  </Text>
                </Card>
              </View>
            ) : null}
          </View>
        ) : null}

        {overview.focusTopics.length > 0 ? (
          <View>
            <SectionHeader title={t('learn.focus')} />
            <View style={{ gap: theme.spacing.md }}>
              {overview.focusTopics.map((topic) => (
                <Pressable
                  key={topic.id}
                  accessibilityRole="button"
                  accessibilityLabel={topic.name}
                  onPress={() => router.push(`/topic/${topic.id}`)}
                >
                  <Card>
                    <View style={{ gap: theme.spacing.xs }}>
                      <Text variant="bodyStrong" bidi="auto">
                        {topic.name}
                      </Text>
                      {topic.subjectName ? (
                        <Text variant="micro" tone="muted" bidi="auto">
                          {topic.subjectName}
                        </Text>
                      ) : null}
                      <View
                        style={{
                          flexDirection: 'row',
                          flexWrap: 'wrap',
                          gap: theme.spacing.xs,
                          alignItems: 'center',
                        }}
                      >
                        <Badge
                          label={`${t('learn.questionsSeen')} · ${topic.questionsSeen}`}
                          tone="neutral"
                        />
                        {/* Stated on the row, not buried in a tooltip: the
                            student sees the caveat at the same moment as the
                            signal it qualifies. */}
                        {topic.lowConfidence ? (
                          <Badge label={t('learn.focus.lowConfidence')} tone="warning" />
                        ) : null}
                      </View>
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {overview.interestTopics.length > 0 ? (
          <View>
            <SectionHeader title={t('learn.interests')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              {overview.interestTopics.map((topic) => (
                <Badge
                  key={topic.id}
                  label={topic.name}
                  tone="primary"
                  onPress={() => router.push(`/topic/${topic.id}`)}
                />
              ))}
            </View>
          </View>
        ) : null}

        <Text variant="caption" tone="muted">
          {t('learn.signalsDisclaimer')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
