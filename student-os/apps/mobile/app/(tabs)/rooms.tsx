import type { ClassroomSummary, Group } from '@sos/contracts';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MetadataLine, SectionHeader } from '../../src/components/editorial';
import { AcademicRow } from '../../src/components/rows';
import { ErrorState, LoadingState } from '../../src/components/states';
import { Text } from '../../src/components/Text';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Rooms — the fourth tab of the frozen five (04-NAVIGATION.md).
 *
 * The places this student belongs to, under their distinct nouns: Classrooms
 * (staff-run, a lecture sequence, a course code on every row — 14-CLASSROOM
 * §distinct nouns) and Study groups (student-run, a post list). One tab
 * because both answer "where are my people"; two sections because conflating
 * the nouns is the confusion the spec calls out.
 *
 * Discovery deliberately lives one tap away (`classrooms/index` keeps the
 * browse scope and join-by-code): this tab is a place you return to, and
 * mixing "mine" with "could join" makes the first unreliable.
 */

export default function Rooms(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'refreshing'>('loading');

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial'): Promise<void> => {
      setStatus(mode === 'refresh' ? 'refreshing' : 'loading');
      try {
        const [classroomPage, groupPage] = await Promise.all([
          api.get<{ items: ClassroomSummary[] }>('/v1/classrooms?scope=mine&limit=30'),
          api.get<{ items: Group[] }>('/v1/groups?scope=mine&limit=30'),
        ]);
        setClassrooms(classroomPage.items);
        setGroups(groupPage.items);
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
        <Text accessibilityRole="header" variant="displaySerif">
          {t('nav.rooms')}
        </Text>
        <View style={{ height: 2, backgroundColor: theme.colors.text }} />

        {/* Both sections always render: their trailing links (Browse, New
            group) are the way IN, so a student with zero rooms needs them
            most — a full-screen empty state here would hide the only two
            affordances that fix it. */}
        {
          <>
            <View>
              <SectionHeader
                title={t('rooms.classrooms')}
                trailing={t('rooms.browse')}
                onTrailingPress={() => router.push('/classrooms')}
              />
              {classrooms.length === 0 ? (
                <Text variant="body" tone="muted">
                  {t('rooms.classrooms.empty')}
                </Text>
              ) : (
                classrooms.map((room) => (
                  <AcademicRow
                    key={room.id}
                    chevron
                    onPress={() => router.push(`/classrooms/${room.id}`)}
                    accessibilityLabel={room.title}
                  >
                    <View style={{ gap: 2 }}>
                      <Text variant="heading" numberOfLines={2} bidi="auto">
                        {room.title}
                      </Text>
                      {/* The course code is on every classroom row by spec —
                          it is what tells two same-named rooms apart. */}
                      <MetadataLine
                        parts={[
                          room.courseName ?? null,
                          t('classroom.members.count', { count: room.memberCount }),
                          room.isArchived ? t('classrooms.archived') : null,
                        ]}
                      />
                    </View>
                  </AcademicRow>
                ))
              )}
            </View>

            <View>
              <SectionHeader title={t('rooms.groups')} trailing={t('groups.create')} onTrailingPress={() => router.push('/group/new')} />
              {groups.length === 0 ? (
                <Text variant="body" tone="muted">
                  {t('rooms.groups.empty')}
                </Text>
              ) : (
                groups.map((group) => (
                  <AcademicRow
                    key={group.id}
                    chevron
                    onPress={() => router.push(`/group/${group.id}`)}
                    accessibilityLabel={group.name}
                  >
                    <View style={{ gap: 2 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.sm,
                        }}
                      >
                        <Text variant="heading" numberOfLines={1} bidi="auto" style={{ flexShrink: 1 }}>
                          {group.name}
                        </Text>
                        {group.visibility === 'group' ? (
                          <Ionicons
                            name="lock-closed-outline"
                            size={14}
                            color={theme.colors.textMuted}
                          />
                        ) : null}
                      </View>
                      <MetadataLine
                        parts={[
                          t('groups.members.count', { count: group.memberCount }),
                          group.viewer.membershipStatus === 'pending'
                            ? t('groups.join.pending')
                            : null,
                          group.pendingRequestCount
                            ? t('groups.requests.count', { count: group.pendingRequestCount })
                            : null,
                        ]}
                      />
                    </View>
                  </AcademicRow>
                ))
              )}
            </View>
          </>
        }
      </ScrollView>
    </SafeAreaView>
  );
}
