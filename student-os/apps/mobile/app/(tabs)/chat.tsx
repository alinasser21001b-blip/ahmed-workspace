import type { Conversation, ConversationPage } from '@sos/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { Text } from '../../src/components/Text';
import { Avatar, Badge, Card } from '../../src/components/surfaces';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { formatRelative } from '../../src/components/PostCard';
import { useRealtime } from '../../src/state/realtime';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * The chat list (§58).
 *
 * Chat feels like chat. There are no learning controls on this surface —
 * academic context enters a thread as a shared card, not as a toolbar.
 *
 * Sorted by recent activity, which is the only ordering a chat list can have
 * and the reason `conversations.last_message_at` exists. Every row shows only
 * what this reader is entitled to: the preview is of a conversation they are in,
 * and a conversation they are not in does not appear at all — enforced by an
 * inner join on membership, not by a filter after the fetch.
 */
export default function Chat(): React.JSX.Element {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { api } = useSession();
  const { onFrame, status: connection } = useRealtime();

  const [items, setItems] = useState<Conversation[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'refreshing'>('loading');

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial'): Promise<void> => {
      setStatus(mode === 'refresh' ? 'refreshing' : 'loading');
      try {
        const page = await api.get<ConversationPage>('/v1/conversations?limit=30');
        setItems(page.items);
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

  /*
   * A new message anywhere reorders this list. Reloading rather than patching
   * in place: the ordering, the preview and the unread count all come from the
   * server, and reproducing that arithmetic here would be a second
   * implementation that drifts.
   */
  useEffect(
    () =>
      onFrame((frame) => {
        if (frame.type === 'message.new' || frame.type === 'message.read') void load();
      }),
    [onFrame, load],
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
        refreshControl={
          <RefreshControl refreshing={status === 'refreshing'} onRefresh={() => void load('refresh')} />
        }
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.xs, paddingBottom: theme.spacing.lg }}>
            <Text variant="display">{t('chat.title')}</Text>
            {/* Connection state is shown, never hidden: a student who cannot
                see why a message has not sent assumes the product lost it. */}
            {connection !== 'open' ? (
              <Text variant="micro" tone="muted">
                {t(connection === 'connecting' ? 'chat.connecting' : 'chat.offline')}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={{ minHeight: 240 }}>
            <EmptyState
              title={t('chat.empty.title')}
              body={t('chat.empty.body')}
              action={{ label: t('chat.empty.action'), onPress: () => router.push('/search') }}
            />
          </View>
        }
        renderItem={({ item }) => (
          <Card
            onPress={() => router.push(`/chat/${item.id}`)}
            accessibilityLabel={item.title}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Avatar name={item.title} size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
                >
                  <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1} bidi="auto">
                    {item.title}
                  </Text>
                  {item.lastMessageAt ? (
                    <Text variant="micro" tone="muted">
                      {formatRelative(item.lastMessageAt, locale)}
                    </Text>
                  ) : null}
                </View>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
                >
                  <Text variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={1} bidi="auto">
                    {item.lastMessagePreview ?? t('chat.noMessages')}
                  </Text>
                  {item.viewer.unreadCount > 0 ? (
                    <Badge label={String(item.viewer.unreadCount)} tone="primary" />
                  ) : null}
                </View>
              </View>
              <DirectionalIcon direction="disclosure" size={18} color={theme.colors.textMuted} />
            </View>
          </Card>
        )}
      />
    </SafeAreaView>
  );
}
