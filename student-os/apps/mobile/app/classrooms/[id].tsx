import type { ClassroomDetail, ClassroomMember, LectureSummary } from '@sos/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/Button';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { Avatar, Badge, Card, SectionHeader } from '../../src/components/surfaces';
import { Text } from '../../src/components/Text';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { useI18n, type TranslationKey } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * A classroom.
 *
 * The screen has two shapes and the server decides which: a member sees the
 * lectures and the roster, a non-member sees the room's identity and a way in.
 * That split is `viewer.canRead`, projected by the API — the client does not
 * infer it, so there is no arrangement of state in which it draws a lecture
 * list it is not allowed to have.
 */
export default function ClassroomScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [classroom, setClassroom] = useState<ClassroomDetail | null>(null);
  const [lectures, setLectures] = useState<LectureSummary[]>([]);
  const [members, setMembers] = useState<ClassroomMember[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'refreshing'>('loading');
  const [joining, setJoining] = useState(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial'): Promise<void> => {
      setStatus(mode === 'refresh' ? 'refreshing' : 'loading');
      try {
        const detail = await api.get<ClassroomDetail>(`/v1/classrooms/${id}`);
        setClassroom(detail);

        // Only fetched when the server says this viewer may read them. Asking
        // anyway would produce a 404 the user never caused.
        if (detail.viewer.canRead) {
          const [lecturePage, memberPage] = await Promise.all([
            api.get<{ items: LectureSummary[] }>(`/v1/classrooms/${id}/lectures`),
            api.get<{ items: ClassroomMember[] }>(`/v1/classrooms/${id}/members`),
          ]);
          setLectures(lecturePage.items);
          setMembers(memberPage.items);
        } else {
          setLectures([]);
          setMembers([]);
        }
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    },
    [api, id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const join = async (): Promise<void> => {
    setJoining(true);
    try {
      await api.request(`/v1/classrooms/${id}/membership`, {
        method: 'PUT',
        body: { joinCode: null },
      });
      await load('refresh');
    } catch {
      setStatus('error');
    } finally {
      setJoining(false);
    }
  };

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error' || !classroom) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

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
            {classroom.title}
          </Text>
          <Text variant="micro" tone="muted" bidi="auto">
            {classroom.courseName}
            {classroom.instructor ? ` · ${classroom.instructor.displayName}` : ''}
          </Text>
        </View>
      </View>

      {classroom.description ? (
        <Text variant="body" bidi="auto">
          {classroom.description}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
        <Badge label={`${t('classrooms.members')} · ${classroom.memberCount}`} tone="neutral" />
        <Badge label={`${t('classrooms.lectures')} · ${classroom.lectureCount}`} tone="learning" />
        {classroom.viewer.role ? (
          <Badge
            label={t(`classrooms.role.${classroom.viewer.role}` as TranslationKey)}
            tone="primary"
          />
        ) : null}
        {classroom.isArchived ? <Badge label={t('classrooms.archived')} tone="warning" /> : null}
      </View>

      {/* Teaching staff only — the server sends null to everyone else. */}
      {classroom.joinCode ? (
        <Card>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="label">{t('classrooms.joinCode')}</Text>
            <Text variant="display" style={{ letterSpacing: 2 }} bidi="auto">
              {classroom.joinCode}
            </Text>
          </View>
        </Card>
      ) : null}

      {classroom.viewer.canJoin ? (
        <Button
          label={t('classrooms.join')}
          variant="learning"
          fullWidth
          loading={joining}
          onPress={() => void join()}
        />
      ) : null}

      {!classroom.viewer.canRead ? (
        <Text variant="caption" tone="muted">
          {t('classrooms.notMember')}
        </Text>
      ) : null}

      {classroom.viewer.canRead && members.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t('classrooms.members')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
            {members.slice(0, 12).map((member) => (
              <View key={member.user.userId} style={{ alignItems: 'center', width: 64 }}>
                <Avatar name={member.user.displayName} size={40} />
                <Text variant="micro" tone="muted" numberOfLines={1} bidi="auto">
                  {member.user.displayName}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {classroom.viewer.canRead ? <SectionHeader title={t('classrooms.lectures')} /> : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={classroom.viewer.canRead ? lectures : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.md,
          flexGrow: 1,
        }}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            refreshing={status === 'refreshing'}
            onRefresh={() => void load('refresh')}
            tintColor={theme.colors.primary}
          />
        }
        ListEmptyComponent={
          classroom.viewer.canRead ? (
            <View style={{ minHeight: 180 }}>
              <EmptyState
                title={t('classrooms.lectures.empty.title')}
                body={t('classrooms.lectures.empty.body')}
              />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/lecture/${item.id}`)} accessibilityLabel={item.title}>
            <View style={{ gap: theme.spacing.xs }}>
              <Text variant="bodyStrong" bidi="auto">
                {item.title}
              </Text>
              {item.description ? (
                <Text variant="caption" tone="muted" numberOfLines={2} bidi="auto">
                  {item.description}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
                {item.materialCount > 0 ? (
                  <Badge
                    label={`${t('lecture.materials')} · ${item.materialCount}`}
                    tone="neutral"
                  />
                ) : null}
                {item.durationMinutes ? (
                  <Badge
                    label={`${item.durationMinutes} ${t('lecture.duration')}`}
                    tone="neutral"
                  />
                ) : null}
                {/* Only teaching staff ever receive an unpublished lecture. */}
                {!item.publishedAt ? <Badge label={t('lecture.draft')} tone="warning" /> : null}
              </View>
            </View>
          </Card>
        )}
      />
    </SafeAreaView>
  );
}
