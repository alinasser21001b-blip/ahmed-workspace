import type { LectureDetail } from '@sos/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/Button';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { Badge, Card, SectionHeader } from '../../src/components/surfaces';
import { Text } from '../../src/components/Text';
import { ErrorState, LoadingState } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { API_BASE_URL, useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * A lecture.
 *
 * The hub the schema has described since Phase 0: the instructor's own text,
 * the objectives, the key concepts, the topics it belongs to, and the
 * materials. `aiSummary` has its own slot and is rendered separately from
 * anything a human wrote — it is null until Phase 6, and the separation exists
 * now so the two can never be confused later.
 *
 * Material URLs arrive already signed, minted for this reader after the server
 * checked their classroom membership. The client never constructs one.
 */
export default function LectureScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [lecture, setLecture] = useState<LectureDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [marking, setMarking] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      setLecture(await api.get<LectureDetail>(`/v1/lectures/${id}`));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (): Promise<void> => {
    setMarking(true);
    try {
      await api.request(`/v1/lectures/${id}/progress`, {
        method: 'PUT',
        body: { percent: 100 },
      });
      await load();
    } catch {
      setStatus('error');
    } finally {
      setMarking(false);
    }
  };

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error' || !lecture) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.lg,
        }}
      >
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
            <Text variant="heading" bidi="auto">
              {lecture.title}
            </Text>
            {lecture.author ? (
              <Text variant="micro" tone="muted" bidi="auto">
                {lecture.author.displayName}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
          {!lecture.publishedAt ? <Badge label={t('lecture.draft')} tone="warning" /> : null}
          {lecture.durationMinutes ? (
            <Badge label={`${lecture.durationMinutes} ${t('lecture.duration')}`} tone="neutral" />
          ) : null}
          {lecture.topics.map((topic) => (
            <Badge
              key={topic.id}
              label={topic.name}
              tone="primary"
              onPress={() => router.push(`/topic/${topic.id}`)}
            />
          ))}
        </View>

        {lecture.description ? (
          <Text variant="body" bidi="auto">
            {lecture.description}
          </Text>
        ) : null}

        {lecture.learningObjectives.length > 0 ? (
          <View>
            <SectionHeader title={t('lecture.objectives')} />
            <View style={{ gap: theme.spacing.xs }}>
              {lecture.learningObjectives.map((objective) => (
                <Text key={objective} variant="body" bidi="auto">
                  •  {objective}
                </Text>
              ))}
            </View>
          </View>
        ) : null}

        {lecture.keyConcepts.length > 0 ? (
          <View>
            <SectionHeader title={t('lecture.concepts')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              {lecture.keyConcepts.map((concept) => (
                <Badge key={concept} label={concept} tone="learning" />
              ))}
            </View>
          </View>
        ) : null}

        <View>
          <SectionHeader title={t('lecture.materials')} />
          {lecture.materials.length === 0 ? (
            <Text variant="caption" tone="muted">
              {t('lecture.materials.empty')}
            </Text>
          ) : (
            <View style={{ gap: theme.spacing.md }}>
              {lecture.materials.map((material) => {
                /*
                 * `file.url` is relative and already signed by the server; the
                 * external link is whatever the instructor typed. Both are
                 * opened rather than fetched, because a material is a document
                 * the student reads, not something this screen renders.
                 */
                const href = material.file
                  ? `${API_BASE_URL}${material.file.url}`
                  : material.externalUrl;
                return (
                  <Card key={material.id}>
                    <View style={{ gap: theme.spacing.xs }}>
                      <Text variant="bodyStrong" bidi="auto">
                        {material.title}
                      </Text>
                      {material.description ? (
                        <Text variant="caption" tone="muted" bidi="auto">
                          {material.description}
                        </Text>
                      ) : null}
                      {href ? (
                        <Button
                          label={t('lecture.open')}
                          variant="secondary"
                          onPress={() => void Linking.openURL(href)}
                        />
                      ) : null}
                    </View>
                  </Card>
                );
              })}
            </View>
          )}
        </View>

        {lecture.viewer.completedAt ? (
          <Badge label={t('lecture.completed')} tone="learning" />
        ) : (
          <Button
            label={t('lecture.markRead')}
            variant="learning"
            fullWidth
            loading={marking}
            onPress={() => void markRead()}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
