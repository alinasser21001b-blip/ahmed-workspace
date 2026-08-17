import type { ClassroomSummary } from '@sos/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/Button';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { Text } from '../../src/components/Text';
import { Badge, Card } from '../../src/components/surfaces';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { useI18n, type TranslationKey } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Classrooms (Phase 5b).
 *
 * Two scopes behind one control, the same shape the Groups tab has used since
 * Phase 3: the rooms you are in, and the rooms you could join. They are
 * separate lists rather than one mixed list because "my classrooms" is a place
 * you return to and "open to join" is a place you browse, and a list that
 * quietly mixes them makes the first one unreliable.
 *
 * Every affordance comes from `viewer.*` on the server's payload. The client
 * never decides for itself whether Join should be drawn.
 */

type Scope = 'mine' | 'discover';

export default function Classrooms(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const { api, user } = useSession();

  const [scope, setScope] = useState<Scope>('mine');
  const [items, setItems] = useState<ClassroomSummary[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'refreshing'>('loading');
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial'): Promise<void> => {
      setStatus(mode === 'refresh' ? 'refreshing' : 'loading');
      try {
        const page = await api.get<{ items: ClassroomSummary[] }>(
          `/v1/classrooms?scope=${scope}&limit=30`,
        );
        setItems(page.items);
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    },
    [api, scope],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Join by code is the only way into an unlisted room. The code is resolved
   * first so the student lands on the room rather than being told "joined"
   * with nowhere to go.
   */
  const joinByCode = async (): Promise<void> => {
    const code = joinCode.trim();
    if (code.length < 4) return;
    setJoining(true);
    try {
      const found = await api.get<ClassroomSummary>(
        `/v1/classrooms/lookup?joinCode=${encodeURIComponent(code)}`,
      );
      await api.request(`/v1/classrooms/${found.id}/membership`, {
        method: 'PUT',
        body: { joinCode: code },
      });
      setJoinCode('');
      router.push(`/classrooms/${found.id}`);
    } catch {
      setStatus('error');
    } finally {
      setJoining(false);
    }
  };

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
        <Text variant="display" style={{ flex: 1 }}>
          {t('classrooms.title')}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {(['mine', 'discover'] as Scope[]).map((option) => {
          const active = scope === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              aria-checked={active}
              accessibilityLabel={t(`classrooms.${option}` as TranslationKey)}
              onPress={() => setScope(option)}
              style={{
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: active ? theme.colors.primary : theme.colors.border,
                backgroundColor: active ? theme.colors.primarySoft : theme.colors.surface,
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.sm,
                minHeight: 40,
                justifyContent: 'center',
              }}
            >
              <Text variant="caption" tone={active ? 'primary' : 'muted'}>
                {t(`classrooms.${option}` as TranslationKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Card>
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label">{t('classrooms.join.code')}</Text>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
            <TextInput
              accessibilityLabel={t('classrooms.join.code')}
              placeholder={t('classrooms.join.code.placeholder')}
              placeholderTextColor={theme.colors.textMuted}
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="characters"
              autoCorrect={false}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.background,
                color: theme.colors.text,
                paddingHorizontal: theme.spacing.lg,
                fontSize: 16,
                // A join code is Latin and case-insensitive; forcing it RTL
                // would show the characters in the order they were not typed.
                textAlign: 'left',
                writingDirection: 'ltr',
              }}
            />
            <Button
              label={t('classrooms.join')}
              variant="dominant"
              loading={joining}
              disabled={joinCode.trim().length < 4}
              onPress={() => void joinByCode()}
            />
          </View>
        </View>
      </Card>

      {/*
        * Opening a classroom is a teaching act, so the control is drawn only
        * for an account the server has told us is academically eligible.
        *
        * `teachingEligible` is projected by the API, never derived here from
        * `verificationLevel` — a client that decided for itself which levels
        * count would drift from the server that enforces it. Hiding the button
        * is a courtesy, not the boundary: `POST /v1/classrooms` refuses an
        * ineligible caller regardless of what this screen chose to render, so
        * a client holding a stale session simply gets a 403 instead of a room.
        */}
      {user?.teachingEligible ? (
        <Button
          label={t('classrooms.create')}
          variant="secondary"
          fullWidth
          onPress={() => router.push('/classrooms/new')}
        />
      ) : null}
    </View>
  );

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

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
        refreshControl={
          <RefreshControl
            refreshing={status === 'refreshing'}
            onRefresh={() => void load('refresh')}
            tintColor={theme.colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={{ minHeight: 220 }}>
            <EmptyState
              title={t(
                scope === 'mine' ? 'classrooms.empty.title' : 'classrooms.discover.empty.title',
              )}
              body={t(
                scope !== 'mine'
                  ? 'classrooms.discover.empty.body'
                  : // The eligible copy offers to open a room. Saying that to a
                    // student would promise a control they are not shown.
                    user?.teachingEligible
                    ? 'classrooms.empty.body'
                    : 'classrooms.empty.body.student',
              )}
              action={
                scope === 'mine'
                  ? { label: t('classrooms.empty.action'), onPress: () => setScope('discover') }
                  : undefined
              }
            />
          </View>
        }
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/classrooms/${item.id}`)} accessibilityLabel={item.title}>
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="bodyStrong" bidi="auto">
                {item.title}
              </Text>
              {item.courseName ? (
                <Text variant="metadata" tone="muted" bidi="auto">
                  {item.courseName}
                  {item.instructor ? ` · ${item.instructor.displayName}` : ''}
                </Text>
              ) : null}
              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}
              >
                <Badge label={`${t('classrooms.members')} · ${item.memberCount}`} tone="neutral" />
                <Badge
                  label={`${t('classrooms.lectures')} · ${item.lectureCount}`}
                  tone="neutral"
                />
                {item.viewer.role ? (
                  <Badge
                    label={t(`classrooms.role.${item.viewer.role}` as TranslationKey)}
                    tone="primary"
                  />
                ) : null}
                {item.isArchived ? <Badge label={t('classrooms.archived')} tone="warning" /> : null}
              </View>
            </View>
          </Card>
        )}
      />
    </SafeAreaView>
  );
}
