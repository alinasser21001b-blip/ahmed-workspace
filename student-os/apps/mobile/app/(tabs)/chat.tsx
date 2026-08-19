import type { Conversation, ConversationPage } from '@sos/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MetadataLine, TopBar } from '../../src/components/editorial';
import { formatRelative } from '../../src/components/PostCard';
import { AcademicRow } from '../../src/components/rows';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { Avatar } from '../../src/components/surfaces';
import { Text } from '../../src/components/Text';
import { localizeDigits, useI18n } from '../../src/i18n/index';
import { IS_PREVIEW_MODE } from '../../src/preview/preview-mode';
import { useRealtime } from '../../src/state/realtime';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Enter } from '../../src/motion/index';

/**
 * The conversation list — per 15-MESSAGES.md.
 *
 * Messages is deliberately the quietest surface in the product: no display
 * serif anywhere on it, because the editorial voice belongs to knowledge. A
 * list of equals, with no dominant action.
 *
 * The connection line is always visible when the socket is not open. That is
 * not decoration: a student who cannot see why a message has not arrived by
 * itself assumes it was lost. On the current production host the socket never
 * opens at all, so this line is the honest permanent state there — it says
 * live delivery is unavailable, and that sending and loading still work,
 * because both are true.
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

  useEffect(() => onFrame(() => void load('refresh')), [onFrame, load]);

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
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  const header = (
    <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
      <TopBar title={t('nav.chat')} />
      {/*
        Not in the preview build. The preview deliberately never opens a
        socket (`realtime.tsx` returns early on `IS_PREVIEW_MODE`), so the
        status is permanently `offline` and this line would warn every
        visitor about a failure that is not happening — the fixture world
        has no live delivery to lose. Outside preview the warning is real
        and stays.
      */}
      {connection !== 'open' && !IS_PREVIEW_MODE ? (
        <View
          style={{
            borderStartWidth: 2,
            borderStartColor: theme.colors.attention,
            paddingStart: 11,
          }}
        >
          <Text variant="metadata" tone="attention">
            {t('chat.connection.down')}
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          padding: theme.spacing.xl,
          paddingBottom: theme.spacing.xxl,
          flexGrow: 1,
        }}
        ListHeaderComponent={<Enter>{header}</Enter>}
        refreshControl={
          <RefreshControl
            refreshing={status === 'refreshing'}
            onRefresh={() => void load('refresh')}
            tintColor={theme.colors.text}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title={t('chat.empty.title')}
            body={t('chat.empty.body')}
            action={{ label: t('chat.searchPeople'), onPress: () => router.push('/search') }}
          />
        }
        renderItem={({ item }) => {
          const unread = item.viewer.unreadCount;
          return (
            <AcademicRow
              minHeight={72}
              onPress={() => router.push(`/chat/${item.id}`)}
              // One element, one sentence — the row reads as a whole.
              accessibilityLabel={[
                item.title,
                unread > 0 ? t('chat.unread.count', { count: unread }) : null,
                item.lastMessageAt ? formatRelative(item.lastMessageAt, locale) : null,
                item.lastMessagePreview,
              ]
                .filter(Boolean)
                .join(', ')}
              trailing={
                unread > 0 ? (
                  <View
                    accessible={false}
                    style={{
                      minWidth: 22,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: theme.radius.pill,
                      backgroundColor: theme.colors.structure,
                      alignItems: 'center',
                    }}
                  >
                    <Text variant="metadata" tone="inverse" style={{ fontWeight: '600' }}>
                      {localizeDigits(locale, unread)}
                    </Text>
                  </View>
                ) : null
              }
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Avatar name={item.title} size={44} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'baseline',
                      gap: theme.spacing.sm,
                    }}
                  >
                    <Text
                      variant="body"
                      numberOfLines={1}
                      bidi="auto"
                      // Unread also carries weight, so it survives greyscale.
                      style={{ flex: 1, fontWeight: unread > 0 ? '600' : '400' }}
                    >
                      {item.title}
                    </Text>
                    {item.lastMessageAt ? (
                      <Text variant="metadata" tone="muted">
                        {formatRelative(item.lastMessageAt, locale)}
                      </Text>
                    ) : null}
                  </View>
                  <MetadataLine
                    parts={[item.lastMessagePreview ?? t('chat.empty.title')]}
                    bidi="auto"
                  />
                </View>
              </View>
            </AcademicRow>
          );
        }}
      />
    </SafeAreaView>
  );
}
