import type { Conversation, Message, MessagePage } from '@sos/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { Text } from '../../src/components/Text';
import { Avatar } from '../../src/components/surfaces';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useRealtime } from '../../src/state/realtime';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * One conversation (§58).
 *
 * The screen is a projection of two things and re-derives neither: the server's
 * message list, ordered by `seq`, and the outbox's pending sends. A pending
 * message is rendered in place with its state; when the server answers, the
 * outbox reconciles it by `clientMessageId` and it becomes an ordinary message
 * — it never appears twice, because the two lists are keyed on the same id.
 */

function uuid(): string {
  // `crypto.randomUUID` is present on modern web and on Hermes; the fallback is
  // for older runtimes and is only ever used to key an idempotent request.
  const generator = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (generator?.randomUUID) return generator.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-4000-8000-${Math.random()
    .toString(16)
    .slice(2, 14)}`;
}

export default function ConversationScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { api, user } = useSession();
  const { onFrame, subscribe, unsubscribe, setTyping, resync, outbox, status: connection } =
    useRealtime();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState('');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [pendingVersion, setPendingVersion] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);

  /** Where the unread divider goes: the read position on entry, not after. */
  const enteredWithLastRead = useRef<number | null>(null);
  const listRef = useRef<FlatList<Row>>(null);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      const detail = await api.get<Conversation>(`/v1/conversations/${id}`);
      setConversation(detail);
      if (enteredWithLastRead.current === null) {
        enteredWithLastRead.current = detail.viewer.lastReadSeq;
      }

      const page = await api.get<MessagePage>(`/v1/conversations/${id}/messages?limit=50`);
      setMessages(page.items);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [api, id]);

  /**
   * Marks the thread read up to a seq, once.
   *
   * `markedUpTo` is a ref rather than state: this fires from a realtime frame
   * handler, and a state read there would see the value from the render that
   * installed the handler.
   */
  const markedUpTo = useRef(0);
  const markRead = useCallback(
    async (seq: number): Promise<void> => {
      if (seq <= markedUpTo.current) return;
      markedUpTo.current = seq;
      try {
        await api.request(`/v1/conversations/${id}/read`, { method: 'PUT', body: { seq } });
      } catch {
        // A failed receipt is not worth surfacing: the next message, or the
        // next visit, will carry a higher seq and supersede it.
        markedUpTo.current = 0;
      }
    },
    [api, id],
  );

  /*
   * Reading is continuous, not a one-off on open.
   *
   * Marking read only on load left a thread the student was actively watching
   * accumulating an unread badge for every message that arrived in front of
   * them — which the two-user E2E caught, and which no amount of reading the
   * code would have.
   */
  useEffect(() => {
    if (status !== 'ready') return;
    const highest = messages.reduce((max, message) => Math.max(max, message.seq), 0);
    if (highest > 0) void markRead(highest);
  }, [messages, status, markRead]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => outbox.subscribe(() => setPendingVersion((v) => v + 1)), [outbox]);

  /*
   * Subscribe while the screen is mounted, and resync on every reconnect. The
   * resync is what makes a dropped socket a latency problem: the client says
   * what it has, and the server sends the rest.
   */
  useEffect(() => {
    subscribe(id);
    return () => unsubscribe(id);
  }, [id, subscribe, unsubscribe]);

  useEffect(() => {
    if (connection !== 'open') return;
    const highest = messages.reduce((max, message) => Math.max(max, message.seq), 0);
    resync(id, highest);
  }, [connection, id, resync, messages]);

  useEffect(
    () =>
      onFrame((frame) => {
        switch (frame.type) {
          case 'message.new':
          case 'message.updated': {
            if (frame.message.conversationId !== id) return;
            // Reconcile our own optimistic row rather than appending beside it.
            outbox.reconcile(frame.message);
            setMessages((current) => mergeBySeq(current, [frame.message]));
            return;
          }
          case 'resync': {
            if (frame.conversationId !== id) return;
            for (const message of frame.messages) outbox.reconcile(message);
            setMessages((current) => mergeBySeq(current, frame.messages));
            return;
          }
          case 'typing': {
            if (frame.conversationId !== id || frame.userId === user?.id) return;
            setTypingUsers((current) =>
              frame.typing
                ? current.includes(frame.userId)
                  ? current
                  : [...current, frame.userId]
                : current.filter((candidate) => candidate !== frame.userId),
            );
            return;
          }
          default:
            return;
        }
      }),
    [id, onFrame, outbox, user?.id],
  );

  const pending = useMemo(() => {
    void pendingVersion;
    return outbox.pendingFor(id);
  }, [outbox, id, pendingVersion]);

  const send = useCallback((): void => {
    const body = draft.trim();
    if (body.length === 0) return;
    /*
     * The id is minted here, once, before anything is dispatched. That is what
     * makes a rapid double-tap on Send harmless: the second tap sees an empty
     * draft, and even if it did not, the outbox would recognise the id.
     */
    outbox.enqueue({ clientMessageId: uuid(), conversationId: id, body });
    setDraft('');
    setTyping(id, false);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [draft, id, outbox, setTyping]);

  const loadOlder = useCallback(async (): Promise<void> => {
    const oldest = messages[0];
    if (!oldest || loadingOlder || oldest.seq <= 1) return;
    setLoadingOlder(true);
    try {
      const page = await api.get<MessagePage>(
        `/v1/conversations/${id}/messages?limit=50&beforeSeq=${oldest.seq}`,
      );
      setMessages((current) => mergeBySeq(current, page.items));
    } finally {
      setLoadingOlder(false);
    }
  }, [api, id, loadingOlder, messages]);

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error' || !conversation) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  const rows = buildRows(messages, pending, {
    lastReadOnEntry: enteredWithLastRead.current ?? 0,
    selfId: user?.id ?? null,
    unreadLabel: t('chat.unreadDivider'),
    formatDay: (iso) => formatDayLabel(iso, locale, t('chat.today'), t('chat.yesterday')),
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('action.back')}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <DirectionalIcon direction="back" size={24} color={theme.colors.text} />
          </Pressable>
          <Avatar name={conversation.title} size={32} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1} bidi="auto">
              {conversation.title}
            </Text>
            {typingUsers.length > 0 ? (
              <Text variant="micro" tone="primary">
                {t('chat.typing')}
              </Text>
            ) : connection !== 'open' ? (
              <Text variant="micro" tone="muted">
                {t(connection === 'connecting' ? 'chat.connecting' : 'chat.offline')}
              </Text>
            ) : null}
          </View>
        </View>

        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            gap: theme.spacing.sm,
            flexGrow: 1,
          }}
          onEndReachedThreshold={0.2}
          ListEmptyComponent={
            <View style={{ minHeight: 200, justifyContent: 'center' }}>
              <EmptyState
                title={t('chat.empty.thread.title')}
                body={t('chat.empty.thread.body')}
              />
            </View>
          }
          ListHeaderComponent={
            messages[0] && messages[0].seq > 1 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadOlder()}
                style={{ paddingVertical: theme.spacing.md, alignItems: 'center' }}
              >
                <Text variant="micro" tone="muted">
                  {loadingOlder ? t('state.loading') : t('action.loadMore')}
                </Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => {
            if (item.kind === 'separator') {
              return (
                <View style={{ alignItems: 'center', paddingVertical: theme.spacing.sm }}>
                  <Text variant="micro" tone="muted">
                    {item.label}
                  </Text>
                </View>
              );
            }

            if (item.kind === 'unread') {
              return (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingVertical: theme.spacing.xs,
                  }}
                >
                  <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.primary }} />
                  <Text variant="micro" tone="primary">
                    {item.label}
                  </Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.primary }} />
                </View>
              );
            }

            const mine = item.senderId === user?.id;
            return (
              <View
                style={{
                  alignSelf: mine ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  backgroundColor: mine ? theme.colors.primary : theme.colors.surface,
                  borderRadius: theme.radius.lg,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                  gap: 2,
                  opacity: item.state === 'sending' || item.state === 'queued' ? 0.6 : 1,
                }}
              >
                {!mine && conversation.kind === 'group' && item.authorName ? (
                  <Text variant="micro" tone={mine ? 'inverse' : 'muted'} bidi="auto">
                    {item.authorName}
                  </Text>
                ) : null}
                <Text
                  variant="body"
                  tone={mine ? 'inverse' : 'default'}
                  bidi="auto"
                  style={item.deleted ? { fontStyle: 'italic' } : undefined}
                >
                  {item.deleted ? t('chat.deleted') : item.body}
                </Text>
                {mine ? (
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' }}
                  >
                    <Text variant="micro" tone="inverse">
                      {item.state === 'failed'
                        ? t('chat.failed')
                        : item.state === 'sending' || item.state === 'queued'
                          ? t('chat.state.sending')
                          : t('chat.state.sent')}
                    </Text>
                    {item.state === 'failed' && item.clientMessageId ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('chat.retry')}
                        onPress={() => outbox.retry(item.clientMessageId!)}
                        hitSlop={8}
                      >
                        <Ionicons name="refresh" size={14} color={theme.colors.textInverse} />
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          }}
        />

        {/* The composer is absent, not disabled, when the reader may not send —
            and the reason is stated rather than left to be guessed. */}
        {conversation.viewer.canSend ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: theme.spacing.sm,
              padding: theme.spacing.md,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
            }}
          >
            <TextInput
              value={draft}
              onChangeText={(next) => {
                setDraft(next);
                setTyping(id, next.length > 0);
              }}
              placeholder={t('chat.composer.placeholder')}
              placeholderTextColor={theme.colors.textMuted}
              multiline
              accessibilityLabel={t('chat.composer.placeholder')}
              style={{
                flex: 1,
                maxHeight: 120,
                color: theme.colors.text,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.lg,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                textAlign: theme.isRTL ? 'right' : 'left',
                writingDirection: theme.isRTL ? 'rtl' : 'ltr',
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('chat.send')}
              onPress={send}
              disabled={draft.trim().length === 0}
              hitSlop={8}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor:
                  draft.trim().length === 0 ? theme.colors.surface : theme.colors.primary,
              }}
            >
              <Ionicons
                name="send"
                size={18}
                color={
                  draft.trim().length === 0 ? theme.colors.textMuted : theme.colors.textInverse
                }
                /*
                 * Mirrored, unlike most glyphs. A paper plane depicts motion
                 * along the direction of writing — the message travelling away
                 * from the composer — so in Arabic it flies leftwards. This is
                 * the exception that `DirectionalIcon`'s "never mirror objects"
                 * rule does not cover, and it is why it is annotated here.
                 */
                style={theme.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
              />
            </Pressable>
          </View>
        ) : (
          <View style={{ padding: theme.spacing.lg }}>
            <Text variant="caption" tone="muted" align="center">
              {t('chat.readOnly')}
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// --- row assembly -----------------------------------------------------------

type Row =
  | { kind: 'separator'; key: string; label: string }
  | { kind: 'unread'; key: string; label: string }
  | {
      kind: 'message';
      key: string;
      senderId: string | null;
      authorName: string | null;
      body: string | null;
      deleted: boolean;
      state: 'queued' | 'sending' | 'sent' | 'failed';
      clientMessageId: string | null;
    };

/**
 * Merges pages and live frames into one ascending, de-duplicated list.
 *
 * Keyed on `seq`, which is unique per conversation — so the same message
 * arriving twice (once from a page, once from a frame) collapses instead of
 * rendering twice. Sorting by seq rather than by arrival is what makes an
 * out-of-order frame harmless.
 */
function mergeBySeq(current: Message[], incoming: Message[]): Message[] {
  const bySeq = new Map(current.map((message) => [message.seq, message]));
  for (const message of incoming) bySeq.set(message.seq, message);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * A date separator a person would read.
 *
 * `Intl` rather than a hand-rolled month table: it renders Arabic month names
 * and Arabic-Indic digits correctly for `ar`, which a bilingual product has to
 * get right and which no amount of string concatenation does.
 */
function formatDayLabel(iso: string, locale: 'ar' | 'en', today: string, yesterday: string): string {
  const date = new Date(iso);
  const now = new Date();
  const days = Math.round(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) /
      86_400_000,
  );
  if (days === 0) return today;
  if (days === 1) return yesterday;

  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-IQ' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
}

function buildRows(
  messages: Message[],
  pending: { clientMessageId: string; body: string; state: string }[],
  options: {
    lastReadOnEntry: number;
    selfId: string | null;
    unreadLabel: string;
    formatDay: (iso: string) => string;
  },
): Row[] {
  const { lastReadOnEntry, selfId, unreadLabel, formatDay } = options;
  const rows: Row[] = [];
  let previousDay: string | null = null;
  let unreadPlaced = false;

  for (const message of messages) {
    const day = dayKey(message.createdAt);
    if (day !== previousDay) {
      rows.push({ kind: 'separator', key: `day-${day}`, label: formatDay(message.createdAt) });
      previousDay = day;
    }

    // The divider sits where the read position was when the screen opened, so
    // it does not jump as the screen marks itself read.
    if (!unreadPlaced && message.seq > lastReadOnEntry && lastReadOnEntry > 0) {
      rows.push({ kind: 'unread', key: 'unread-divider', label: unreadLabel });
      unreadPlaced = true;
    }

    rows.push({
      kind: 'message',
      key: `m-${message.seq}`,
      senderId: message.author?.userId ?? null,
      authorName: message.author?.displayName ?? null,
      body: message.body,
      deleted: message.deletedAt !== null,
      state: 'sent',
      clientMessageId: message.clientMessageId,
    });
  }

  // Pending sends are always the reader's own, and render on their side.
  for (const entry of pending) {
    rows.push({
      kind: 'message',
      key: `p-${entry.clientMessageId}`,
      senderId: selfId,
      authorName: null,
      body: entry.body,
      deleted: false,
      state: entry.state === 'failed' ? 'failed' : 'sending',
      clientMessageId: entry.clientMessageId,
    });
  }

  return rows;
}
