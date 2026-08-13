import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContentItem, FeedPage, Group, GroupMember } from '@sos/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../src/components/Button';
import { PostCard } from '../../src/components/PostCard';
import { Text } from '../../src/components/Text';
import { Avatar, Badge, Card } from '../../src/components/surfaces';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { bumpContentVersion, useContentVersion } from '../../src/state/content-events';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Group detail (§59).
 *
 * The header answers "what is this and am I in it", and everything below it
 * depends on the answer. A non-member sees the group's identity and a way in —
 * never its posts, never its roster.
 */
export default function GroupDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const theme = useTheme();
  const { api } = useSession();
  const contentVersion = useContentVersion();

  const [group, setGroup] = useState<Group | null>(null);
  const [posts, setPosts] = useState<ContentItem[]>([]);
  const [requests, setRequests] = useState<GroupMember[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [acting, setActing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      const detail = await api.get<Group>(`/v1/groups/${id}`);
      setGroup(detail);

      // Posts and the approval queue are only fetched when the viewer is
      // entitled to them, so a non-member's screen never issues a request it
      // knows will 403.
      if (detail.viewer.membershipStatus === 'active') {
        const page = await api.get<FeedPage>(`/v1/feed?scope=recent&groupId=${id}&limit=30`);
        setPosts(page.items);
      } else {
        setPosts([]);
      }

      if (detail.viewer.canModerate && (detail.pendingRequestCount ?? 0) > 0) {
        const queue = await api.get<{ items: GroupMember[] }>(
          `/v1/groups/${id}/members?status=pending&limit=20`,
        );
        setRequests(queue.items);
      } else {
        setRequests([]);
      }
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load, contentVersion]);

  const join = async (): Promise<void> => {
    setActing(true);
    try {
      await api.request(`/v1/groups/${id}/membership`, { method: 'PUT', body: {} });
      await load();
    } catch {
      /* the reload below surfaces the unchanged state */
    } finally {
      setActing(false);
    }
  };

  const leave = async (): Promise<void> => {
    setActing(true);
    try {
      await api.request(`/v1/groups/${id}/membership`, { method: 'DELETE' });
      await load();
    } finally {
      setActing(false);
    }
  };

  const decideRequest = async (handle: string, approve: boolean): Promise<void> => {
    await api.request(`/v1/groups/${id}/members/${handle}`, {
      method: approve ? 'PATCH' : 'DELETE',
      ...(approve ? { body: { status: 'active' } } : {}),
    });
    await load();
  };

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error' || !group) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  const isMember = group.viewer.membershipStatus === 'active';

  const header = (
    <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('action.back')}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons
            name={theme.isRTL ? 'arrow-forward' : 'arrow-back'}
            size={24}
            color={theme.colors.text}
          />
        </Pressable>
        <Text variant="heading" style={{ flex: 1 }} numberOfLines={1}>
          {group.name}
        </Text>
        {group.visibility === 'group' ? (
          <Ionicons name="lock-closed-outline" size={18} color={theme.colors.textMuted} />
        ) : null}
      </View>

      <Card>
        <View style={{ gap: theme.spacing.md }}>
          {group.description ? <Text variant="body">{group.description}</Text> : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Text variant="caption" tone="muted">
              {t('groups.members.count', { count: group.memberCount })}
            </Text>
            {group.courseName ? <Badge label={group.courseName} tone="learning" /> : null}
            {group.communityName ? <Badge label={group.communityName} tone="primary" /> : null}
          </View>

          {/* The label follows the server's decision rather than guessing, so
              "Join" never silently files a request. */}
          {isMember ? (
            <Button label={t('groups.leave')} variant="secondary" onPress={() => void leave()} loading={acting} />
          ) : group.viewer.membershipStatus === 'pending' ? (
            <Badge label={t('groups.join.pending')} tone="warning" />
          ) : group.viewer.canJoin ? (
            <Button
              label={t(
                group.viewer.joinOutcome === 'requested' ? 'groups.join.request' : 'groups.join',
              )}
              onPress={() => void join()}
              loading={acting}
            />
          ) : null}
        </View>
      </Card>

      {requests.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="heading">{t('groups.requests')}</Text>
          {requests.map((request) => (
            <Card key={request.profile.userId}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Avatar name={request.profile.displayName} size={36} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="label">{request.profile.displayName}</Text>
                  {request.message ? (
                    <Text variant="micro" tone="muted" numberOfLines={2}>
                      {request.message}
                    </Text>
                  ) : null}
                </View>
                <Button
                  label={t('groups.requests.approve')}
                  size="md"
                  onPress={() => void decideRequest(request.profile.handle, true)}
                />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {isMember ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="heading">{t('groups.tab.posts')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('compose.title')}
            onPress={() => router.push(`/compose?groupId=${group.id}`)}
            hitSlop={8}
          >
            <Ionicons name="create-outline" size={22} color={theme.colors.primary} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={isMember ? posts : []}
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
            {isMember ? (
              <EmptyState
                title={t('groups.posts.empty.title')}
                body={t('groups.posts.empty.body')}
                action={{
                  label: t('compose.publish'),
                  onPress: () => router.push(`/compose?groupId=${group.id}`),
                }}
              />
            ) : (
              <Text variant="body" tone="muted" align="center">
                {t('groups.notMember')}
              </Text>
            )}
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
