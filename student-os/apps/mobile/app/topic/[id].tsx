import type { ContentItem, FeedPage, KnowledgeType, TopicDetail } from '@sos/contracts';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DominantAction, Hairline, MetadataLine, SectionHeader, TopBar } from '../../src/components/editorial';
import { EvidenceFraction, RelationshipPrimitive, type RelationRow } from '../../src/components/evidence';
import { ContentGrammar } from '../../src/components/knowledge/ContentGrammar';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { Text } from '../../src/components/Text';
import { localizeDigits, useI18n, type TranslationKey } from '../../src/i18n/index';
import { useContentVersion } from '../../src/state/content-events';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Enter } from '../../src/motion/index';

/**
 * Topic — the reading surface, per 12-LEARN-TOPIC.md.
 *
 * Hierarchy: back + crumb → title → 2 px rule + coverage row with the inline
 * Practise action → "How it connects" (RelationshipPrimitive) → "Knowledge
 * here" (the grouped index) → the knowledge list in ContentGrammar rows.
 *
 * Coverage and accuracy are split on purpose: the metadata line states what
 * was answered, the EvidenceFraction states correct-of-answered, and the delta
 * after a Practice run lands on accuracy. Returning from Practice refetches —
 * stale evidence here defeats the loop.
 */
export default function TopicScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { api } = useSession();
  const contentVersion = useContentVersion();

  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [filter, setFilter] = useState<KnowledgeType | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(
    async (quiet = false): Promise<void> => {
      if (!quiet) setStatus('loading');
      try {
        const detail = await api.get<TopicDetail>(`/v1/topics/${id}`);
        setTopic(detail);
        const page = await api.get<FeedPage>(
          `/v1/topics/${id}/knowledge?limit=30${filter ? `&knowledgeType=${filter}` : ''}`,
        );
        setItems(page.items);
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    },
    [api, id, filter],
  );

  // Refetch on focus — including the return from Practice.
  useFocusEffect(
    useCallback(() => {
      void load(topic !== null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, contentVersion]),
  );

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error' || !topic) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  const availableTypes = topic.knowledgeCounts.filter((entry) => entry.count > 0);

  const relations: RelationRow[] = topic.related.slice(0, 5).map((relation) => ({
    kind:
      relation.relation === 'part_of'
        ? 'part_of'
        : relation.relation === 'prerequisite_of'
          ? // The contract's `prerequisite_of` may not be *shown* as a
            // prerequisite claim — the handoff forbids implying study order.
            // It renders as plain relatedness.
            'co_occurs'
          : 'co_occurs',
    target: relation.name,
    derived: relation.source === 'derived',
    onPress: () => router.push(`/topic/${relation.id}`),
  }));

  const header = (
    <View style={{ gap: theme.spacing.xl, paddingBottom: theme.spacing.lg }}>
      <TopBar
        title={topic.name}
        crumb={[topic.courseName, topic.subjectName].join(' › ')}
        onBack={() => router.back()}
      />

      {/* Coverage row + the one dominant action. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.lg,
        }}
      >
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <EvidenceFraction
            correct={topic.viewer.questionsCorrect}
            answered={topic.viewer.questionsSeen}
            showTicks
          />
          {topic.viewer.questionsSeen > 0 ? (
            <Text variant="metadata" tone="muted">
              {t('topic.answeredHere', {
                answered: localizeDigits(locale, topic.viewer.questionsSeen),
                correct: localizeDigits(locale, topic.viewer.questionsCorrect),
              })}
            </Text>
          ) : null}
        </View>
        {topic.viewer.canPractice ? (
          <DominantAction
            label={t('topic.practise')}
            onPress={() => router.push(`/practice/${topic.id}`)}
            inline
          />
        ) : null}
      </View>

      {relations.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t('topic.howItConnects')} />
          <RelationshipPrimitive relations={relations} />
        </View>
      ) : null}

      {availableTypes.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t('topic.knowledgeHere')} />
          {availableTypes.map((entry) => (
            <Pressable
              key={entry.knowledgeType}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === entry.knowledgeType }}
              aria-checked={filter === entry.knowledgeType}
              accessibilityLabel={`${t(`knowledge.type.${entry.knowledgeType}` as TranslationKey)}, ${entry.count}`}
              onPress={() =>
                setFilter((current) => (current === entry.knowledgeType ? null : entry.knowledgeType))
              }
              style={{
                minHeight: 48,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: theme.spacing.md,
                backgroundColor:
                  filter === entry.knowledgeType ? theme.colors.surfaceSelected : 'transparent',
              }}
            >
              <Text
                variant="body"
                style={{ fontWeight: filter === entry.knowledgeType ? '600' : '400' }}
              >
                {t(`knowledge.type.${entry.knowledgeType}` as TranslationKey)}
              </Text>
              <Text variant="numeric" tone="muted">
                {localizeDigits(locale, entry.count)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <MetadataLine parts={[t('learn.privateToYou')]} />
      <Hairline />
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: theme.spacing.xl, paddingBottom: theme.spacing.xxxl }}
        ListHeaderComponent={<Enter>{header}</Enter>}
        ItemSeparatorComponent={Hairline}
        renderItem={({ item }) => (
          <ContentGrammar
            item={item}
            density="feed"
            onPress={() => router.push(`/post/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            title={t('topic.knowledge.empty.title')}
            body={t('topic.knowledge.empty.body')}
            action={{ label: t('action.back'), onPress: () => router.back() }}
          />
        }
      />
    </SafeAreaView>
  );
}
