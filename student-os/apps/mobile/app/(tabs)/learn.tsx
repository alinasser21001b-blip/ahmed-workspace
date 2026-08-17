import type { LearnOverview } from '@sos/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { InkBand, MetadataLine, SectionHeader, TopBar } from '../../src/components/editorial';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { Text } from '../../src/components/Text';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Enter } from '../../src/motion/index';

/**
 * Learn — the frozen hierarchy from 12-LEARN-TOPIC.md.
 *
 * Title → "Built only from questions you have answered." → 2 px rule →
 * ink band (Quick Practice) → "Recent answers suggest difficulty" →
 * "Not enough evidence to say" (dashed, desaturated) → privacy line.
 *
 * The two evidence groups are the screen's argument. Difficulty is a solid
 * group; low evidence is a structurally different dashed group, not a colour
 * warning. Membership comes from the server's `lowConfidence` — the client
 * renders the boolean and never computes a threshold.
 *
 * The contract carries `questionsSeen` per topic but not `questionsCorrect`,
 * so rows state the answered count; the accuracy fraction lives on Topic,
 * where the viewer data exists. Stating a fraction here would mean inventing
 * a numerator.
 */

export default function Learn(): React.JSX.Element {
  const { t, locale } = useI18n();
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

  // Refetch on every return — including the return from Practice, which is
  // the one the loop exists for. Stale evidence here defeats the product.
  useFocusEffect(
    useCallback(() => {
      void load(overview ? 'refresh' : 'initial');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

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

  const difficulty = overview.focusTopics.filter((topic) => !topic.lowConfidence);
  const lowEvidence = overview.focusTopics.filter((topic) => topic.lowConfidence);
  const bandTopic = difficulty[0] ?? overview.focusTopics[0];
  const empty = overview.focusTopics.length === 0 && overview.interestTopics.length === 0;

  const topicRow = (
    topic: LearnOverview['focusTopics'][number],
    dashed: boolean,
  ): React.JSX.Element => (
    <Pressable
      key={topic.id}
      accessibilityRole="button"
      // The caveat is part of the row's label, not a node a reader can skip.
      accessibilityLabel={[
        topic.name,
        t('learn.answered.count', { count: topic.questionsSeen }),
        dashed ? t('learn.smallSample') : null,
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={() => router.push(`/topic/${topic.id}`)}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingVertical: theme.spacing.md,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading" bidi="auto" tone={dashed ? 'secondary' : 'default'}>
          {topic.name}
        </Text>
        <MetadataLine
          parts={[topic.subjectName, t('learn.answered.count', { count: topic.questionsSeen })]}
        />
      </View>
      <DirectionalIcon direction="forward" size={18} color={theme.colors.textFaint} />
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.xl,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={status === 'refreshing'}
            onRefresh={() => void load('refresh')}
            tintColor={theme.colors.text}
          />
        }
      >
        <Enter>
        <TopBar title={t('learn.title')} />
        <Text variant="metadata" tone="muted" style={{ marginTop: -theme.spacing.md }}>
          {t('learn.builtFrom')}
        </Text>

        {empty ? (
          <View style={{ minHeight: 260 }}>
            <EmptyState
              title={t('learn.empty.real.title')}
              body={t('learn.empty.real.body')}
              action={{ label: t('nav.today'), onPress: () => router.push('/(tabs)') }}
            />
          </View>
        ) : (
          <>
            {/* The one dominant action on this screen. */}
            {bandTopic ? (
              <InkBand
                heading={t('learn.readyToPractise')}
                detail={bandTopic.name}
                actionLabel={t('learn.start')}
                onPress={() => router.push(`/practice/${bandTopic.id}`)}
              />
            ) : null}

            {difficulty.length > 0 ? (
              <View>
                <SectionHeader title={t('learn.suggestDifficulty')} />
                {difficulty.map((topic) => topicRow(topic, false))}
              </View>
            ) : null}

            {lowEvidence.length > 0 || overview.interestTopics.length > 0 ? (
              // Dashed and desaturated: a structural difference, not a warning.
              <View
                style={{
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: theme.colors.borderStrong,
                  borderRadius: theme.radius.md,
                  padding: theme.spacing.lg,
                }}
              >
                <SectionHeader title={t('learn.notEnoughEvidence')} />
                {lowEvidence.map((topic) => topicRow(topic, true))}
                {overview.interestTopics.map((topic) => (
                  <Pressable
                    key={topic.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${locale === 'ar' ? topic.name : topic.name}, ${t('evidence.notAnswered')}`}
                    onPress={() => router.push(`/topic/${topic.id}`)}
                    style={{
                      minHeight: 52,
                      paddingVertical: theme.spacing.md,
                      borderTopWidth: 1,
                      borderTopColor: theme.colors.border,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.md,
                    }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong" tone="secondary" bidi="auto">
                        {topic.name}
                      </Text>
                      <MetadataLine parts={[t('evidence.notAnswered')]} />
                    </View>
                    <DirectionalIcon direction="forward" size={18} color={theme.colors.textFaint} />
                  </Pressable>
                ))}
                <Text
                  variant="caption"
                  tone="faint"
                  style={{ marginTop: theme.spacing.sm }}
                >
                  {t('learn.smallSample')}
                </Text>
              </View>
            ) : null}
          </>
        )}

        {/* Classrooms — a destination, always reachable. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('classrooms.title')}
          onPress={() => router.push('/classrooms')}
          style={{
            minHeight: 48,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            paddingVertical: theme.spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{t('classrooms.title')}</Text>
          </View>
          <DirectionalIcon direction="forward" size={18} color={theme.colors.textFaint} />
        </Pressable>

        <Text variant="metadata" tone="muted">
          {t('learn.privateToYou')}
        </Text>
        </Enter>
      </ScrollView>
    </SafeAreaView>
  );
}
