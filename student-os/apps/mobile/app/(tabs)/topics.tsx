import type { Course, Topic } from '@sos/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Hairline, SectionHeader } from '../../src/components/editorial';
import { AcademicRow } from '../../src/components/rows';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { Text } from '../../src/components/Text';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Topics — the second tab of the frozen five (04-NAVIGATION.md).
 *
 * The browsing surface for the curriculum: every course taught to this
 * student's stage, and the topics inside each. Learn answers "where am I
 * weak"; this answers "what exists" — which is why Home's empty state can say
 * "Browse topics" and mean somewhere.
 *
 * Composition is the editorial index grammar and nothing more: serif
 * masthead, one metadata dek, course sections with hairline-separated topic
 * rows. No cards, no per-topic imagery, no progress decoration — evidence
 * belongs to Learn, and duplicating it here would create the second learning
 * surface the design consolidated away.
 */

type CourseGroup = { course: Course; topics: Topic[] };

export default function Topics(): React.JSX.Element {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [groups, setGroups] = useState<CourseGroup[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'refreshing'>('loading');

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial'): Promise<void> => {
      setStatus(mode === 'refresh' ? 'refreshing' : 'loading');
      try {
        const courses = await api.get<Course[]>('/v1/academic/courses');
        const assembled = await Promise.all(
          courses.map(async (course) => ({
            course,
            topics: await api.get<Topic[]>(`/v1/academic/topics?courseId=${course.id}`),
          })),
        );
        setGroups(assembled.filter((group) => group.topics.length > 0));
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

  const localised = (ar: string, en: string): string => (locale === 'ar' ? ar : en);

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
        <View style={{ flex: 1, padding: theme.spacing.xl }}>
          <ErrorState onRetry={() => void load()} />
        </View>
      </SafeAreaView>
    );
  }

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
        <View style={{ gap: theme.spacing.xs }}>
          <Text accessibilityRole="header" variant="displaySerif">
            {t('nav.topics')}
          </Text>
          <Text variant="body" tone="muted">
            {t('topics.dek')}
          </Text>
        </View>
        <View style={{ height: 2, backgroundColor: theme.colors.text }} />

        {groups.length === 0 ? (
          <View style={{ flex: 1, minHeight: 240 }}>
            <EmptyState title={t('topics.empty.title')} body={t('topics.empty.body')} />
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.course.id}>
              <SectionHeader
                title={localised(group.course.nameAr, group.course.nameEn)}
                {...(group.course.code ? { trailing: group.course.code } : {})}
              />
              {group.topics.map((topic) => (
                <AcademicRow
                  key={topic.id}
                  chevron
                  minHeight={52}
                  onPress={() => router.push(`/topic/${topic.id}`)}
                  accessibilityLabel={localised(topic.nameAr, topic.nameEn)}
                >
                  {/* Topic names carry the display voice — they are the
                      subject matter, not interface chrome. */}
                  <Text variant="heading" bidi="auto">
                    {localised(topic.nameAr, topic.nameEn)}
                  </Text>
                </AcademicRow>
              ))}
              <Hairline />
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
