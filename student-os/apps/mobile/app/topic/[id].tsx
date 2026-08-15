import type { ContentItem, FeedPage, KnowledgeType, TopicDetail } from '@sos/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/Button';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { PostCard } from '../../src/components/PostCard';
import { Text } from '../../src/components/Text';
import { Badge, Card } from '../../src/components/surfaces';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { useI18n, type TranslationKey } from '../../src/i18n/index';
import { bumpContentVersion, useContentVersion } from '../../src/state/content-events';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * A topic, as a place.
 *
 * This is the Phase 5 navigation primitive and the clearest expression of what
 * separates this product from a timeline: a good explanation is in the feed for
 * a day and in its topic forever. A student arriving three months later finds
 * it here, filtered by what kind of knowledge they need.
 *
 * The filter row is deterministic — an equality on a classified column, not a
 * relevance model — so a student can always tell why something is in the list.
 */
export default function TopicScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();
  const contentVersion = useContentVersion();

  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [filter, setFilter] = useState<KnowledgeType | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
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
  }, [api, id, filter]);

  useEffect(() => {
    void load();
  }, [load, contentVersion]);

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

  /*
   * Only types that actually have visible knowledge become filter chips.
   * Offering a filter that returns nothing is a dead control, and the counts
   * are already permission-filtered, so a chip cannot advertise content the
   * reader may not open.
   */
  const availableTypes = topic.knowledgeCounts.filter((entry) => entry.count > 0);

  const header = (
    <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('action.back')}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <DirectionalIcon direction="back" size={24} color={theme.colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={2} bidi="auto">
            {topic.name}
          </Text>
          {/* Where this sits academically — the answer to "what am I studying?" */}
          <Text variant="metadata" tone="muted" bidi="auto">
            {topic.courseName} · {topic.subjectName}
            {topic.parentTopicName ? ` · ${topic.parentTopicName}` : ''}
          </Text>
        </View>
      </View>

      {/*
        The only place in the product that asks the student a question.
        Rendered from `canPractice`, which the server projects — the client
        cannot know which quizzes are published in which of this student's
        courses, and a button that 404s is the dead control Phase 3 ruled out.
      */}
      {topic.viewer.canPractice ? (
        <Button
          label={t('practice.action')}
          variant="dominant"
          fullWidth
          onPress={() => router.push(`/practice/${topic.id}`)}
        />
      ) : null}

      {topic.viewer.questionsSeen > 0 ? (
        <Card>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="bodyStrong">
              {t('practice.score', {
                correct: topic.viewer.questionsCorrect,
                seen: topic.viewer.questionsSeen,
              })}
            </Text>
            {/* A count, never a verdict — the same framing the Learn tab uses. */}
            <Text variant="metadata" tone="muted">
              {t('practice.signalNote')}
            </Text>
          </View>
        </Card>
      ) : null}

      {topic.subtopics.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label">{t('topic.subtopics')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            {topic.subtopics.map((sub) => (
              <Badge
                key={sub.id}
                label={sub.name}
                tone="primary"
                onPress={() => router.push(`/topic/${sub.id}`)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {topic.related.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label">{t('topic.related')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            {topic.related.map((rel) => (
              <Badge
                key={`${rel.id}-${rel.relation}`}
                label={rel.name}
                tone="structure"
                onPress={() => router.push(`/topic/${rel.id}`)}
              />
            ))}
          </View>
          {/* Where the edge came from, stated rather than implied. A count is
              not an assertion, and the student is told which this is. */}
          <Text variant="metadata" tone="muted">
            {topic.related.some((rel) => rel.source === 'derived')
              ? t('topic.related.derived')
              : t('topic.related.curated')}
          </Text>
        </View>
      ) : null}

      {availableTypes.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label">{t('topic.knowledge')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            <Badge
              label={t('topic.filter.all')}
              tone={filter === null ? 'primary' : 'neutral'}
              onPress={() => setFilter(null)}
            />
            {availableTypes.map((entry) => (
              <Badge
                key={entry.knowledgeType}
                label={`${t(`knowledge.type.${entry.knowledgeType}` as TranslationKey)} · ${entry.count}`}
                tone={filter === entry.knowledgeType ? 'primary' : 'neutral'}
                onPress={() => setFilter(entry.knowledgeType)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.md,
          flexGrow: 1,
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={{ minHeight: 200 }}>
            <EmptyState
              title={t('topic.knowledge.empty.title')}
              body={t('topic.knowledge.empty.body')}
              action={{
                label: t('compose.publish'),
                onPress: () => router.push('/compose'),
              }}
            />
          </View>
        }
        renderItem={({ item }) => (
          <PostCard
            item={item}
            onPress={() => router.push(`/post/${item.id}`)}
            onComment={() => router.push(`/post/${item.id}`)}
            onToggleReaction={() => {
              void api
                .request(`/v1/content/${item.id}/reaction`, {
                  method: item.viewer.reaction ? 'DELETE' : 'PUT',
                  ...(item.viewer.reaction ? {} : { body: { kind: 'like' } }),
                })
                .then(() => bumpContentVersion());
            }}
          />
        )}
      />
    </SafeAreaView>
  );
}
