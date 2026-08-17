import type { ClassroomDetail, ClassroomMember, LectureSummary } from '@sos/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  DominantAction,
  Hairline,
  MetadataLine,
  SectionHeader,
  TopBar,
} from '../../src/components/editorial';
import { ClassroomActivityRow, MemberAvatarRow, RoleLabel } from '../../src/components/rows';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { Text } from '../../src/components/Text';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Enter } from '../../src/motion/index';

/**
 * Classroom — per 14-CLASSROOM.md.
 *
 * Two shapes, and the server chooses: `viewer.canRead === false` means the
 * roster and the lectures are never fetched, so the non-member view is a
 * genuinely different screen with less in it rather than a blurred version of
 * the member view. Getting that wrong leaks the lecture list.
 *
 * A classroom's academic content is its lecture sequence, so numbered lecture
 * rows are the screen. Roles are one structure-coloured label and counts are
 * metadata text — the count-pills this design retired are exactly what made
 * the old version read as a roster.
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

        // Only fetched when the server says this viewer may read them.
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
      // Joining does not navigate — it refetches in place and the member view
      // replaces the join view.
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

  const isMember = classroom.viewer.canRead;
  const mostRecent = lectures[lectures.length - 1];
  const roleLabel = classroom.viewer.canTeach
    ? t('classroom.youAreTeacher')
    : classroom.viewer.isMember
      ? t('classroom.youAreStudent')
      : null;

  const header = (
    <View style={{ gap: theme.spacing.xl, paddingBottom: theme.spacing.lg }}>
      <TopBar
        title={classroom.title}
        crumb={classroom.courseName ?? undefined}
        onBack={() => router.back()}
      />

      {classroom.description ? (
        <Text variant="body" tone="secondary" bidi="auto">
          {classroom.description}
        </Text>
      ) : null}

      {/* Role chip and counts share one row, as frame 5a composes them. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: theme.spacing.md,
        }}
      >
        {roleLabel ? <RoleLabel label={roleLabel} /> : null}
        <MetadataLine
          parts={[
            t('classroom.members.count', { count: classroom.memberCount }),
            classroom.instructor?.displayName ?? null,
            classroom.isArchived ? t('classrooms.archived') : null,
          ]}
        />
      </View>

      {/* Teaching staff only — the server sends null to everyone else. The
          code stays LTR in both languages: a code shown right-to-left is a
          code the student did not type. */}
      {classroom.joinCode ? (
        <View style={{ gap: theme.spacing.xxs }}>
          <SectionHeader title={t('classroom.joinCodePrompt')} />
          <Text
            variant="numeric"
            style={{ letterSpacing: 2, writingDirection: 'ltr', textAlign: 'left' }}
          >
            {classroom.joinCode}
          </Text>
        </View>
      ) : null}

      {isMember ? (
        <>
          {members.length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              <SectionHeader
                title={t('classrooms.members')}
                {...(members.length < classroom.memberCount
                  ? { trailing: t('classroom.seeAll') }
                  : {})}
              />
              <MemberAvatarRow members={members} total={classroom.memberCount} />
            </View>
          ) : null}

          <SectionHeader title={t('classrooms.lectures')} />
        </>
      ) : (
        // The non-member view: identity, counts, an explanation, and the way in.
        <View style={{ gap: theme.spacing.lg }}>
          <Text variant="body" tone="secondary">
            {t('classroom.membersOnly')}
          </Text>
          {classroom.viewer.canJoin ? (
            <DominantAction
              label={t('classrooms.join')}
              onPress={() => void join()}
              loading={joining}
            />
          ) : null}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={isMember ? lectures : []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          padding: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl,
          flexGrow: 1,
        }}
        ListHeaderComponent={<Enter>{header}</Enter>}
        ListFooterComponent={
          isMember && mostRecent ? (
            /* The one dominant action a member sees — the ink band opening
               the most recent lecture. It sits at the foot of the content,
               above the tab bar, scrolling with it (14 §Scrolling). */
            <View style={{ paddingTop: theme.spacing.xl, gap: theme.spacing.md }}>
              <Hairline />
              <View
                style={{
                  backgroundColor: theme.colors.text,
                  borderRadius: theme.radius.md,
                  padding: theme.spacing.lg,
                  gap: theme.spacing.md,
                }}
              >
                <View style={{ gap: theme.spacing.xxs }}>
                  <Text variant="metadata" style={{ color: theme.colors.borderStrong }}>
                    {t('classroom.mostRecent')}
                  </Text>
                  <Text variant="heading" tone="inverse" bidi="auto">
                    {mostRecent.title}
                  </Text>
                </View>
                <DominantAction
                  label={t('classroom.openLecture')}
                  onPress={() => router.push(`/lecture/${mostRecent.id}`)}
                  inverse
                  inline
                />
              </View>
            </View>
          ) : isMember && lectures.length > 0 ? (
            <Hairline />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={status === 'refreshing'}
            onRefresh={() => void load('refresh')}
            tintColor={theme.colors.text}
          />
        }
        ListEmptyComponent={
          isMember ? (
            <View style={{ minHeight: 180 }}>
              <EmptyState
                title={t('classrooms.lectures.empty.title')}
                body={t('classrooms.lectures.empty.body')}
              />
            </View>
          ) : null
        }
        renderItem={({ item, index }) => (
          <ClassroomActivityRow
            lecture={item}
            index={index}
            onPress={() => router.push(`/lecture/${item.id}`)}
          />
        )}
      />
    </SafeAreaView>
  );
}
