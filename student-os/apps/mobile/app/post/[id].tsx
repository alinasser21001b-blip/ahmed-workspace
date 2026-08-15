import Ionicons from '@expo/vector-icons/Ionicons';
import type { Comment, CommentPage, ContentItem } from '@sos/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { ActionSheet } from '../../src/components/ActionSheet';
import { DirectionalIcon } from '../../src/components/DirectionalIcon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KnowledgePanel } from '../../src/components/KnowledgePanel';
import { ReportSheet } from '../../src/components/ReportSheet';
import { PostCard, formatRelative } from '../../src/components/PostCard';
import { Text } from '../../src/components/Text';
import { Avatar, Divider } from '../../src/components/surfaces';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Post detail and discussion thread.
 *
 * The composer is pinned to the bottom and the thread scrolls above it — the
 * arrangement people already know from every messaging app, which is the point
 * (§53: don't make them learn a new shape for a familiar action).
 */
export default function PostDetail(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [item, setItem] = useState<ContentItem | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      const [content, thread] = await Promise.all([
        api.get<ContentItem>(`/v1/content/${id}`),
        api.get<CommentPage>(`/v1/content/${id}/comments?limit=50`),
      ]);
      setItem(content);
      setComments(thread.items);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Accepting a correction changes the post's provenance, so the card has to
   * be re-read — but without `load()`'s loading state, which would replace the
   * thread the student is reading with a spinner.
   */
  const refreshItem = useCallback(async (): Promise<void> => {
    try {
      setItem(await api.get<ContentItem>(`/v1/content/${id}`));
    } catch {
      /* The card keeps the values it already has. */
    }
  }, [api, id]);

  const send = async (): Promise<void> => {
    const body = draft.trim();
    if (!body) return;

    setSending(true);
    // Clear immediately: retyping a lost comment is the most annoying possible
    // failure, so the draft is only restored if the send actually fails.
    setDraft('');
    try {
      const created = await api.post<Comment>(`/v1/content/${id}/comments`, { body });
      setComments((current) => [...current, created]);
      setItem((current) =>
        current
          ? { ...current, counts: { ...current.counts, comments: current.counts.comments + 1 } }
          : current,
      );
    } catch {
      setDraft(body);
    } finally {
      setSending(false);
    }
  };

  const toggleReaction = async (): Promise<void> => {
    if (!item) return;
    const wasLiked = item.viewer.reaction !== null;
    const before = item;
    setItem({
      ...item,
      viewer: { ...item.viewer, reaction: wasLiked ? null : 'like' },
      counts: { ...item.counts, likes: Math.max(0, item.counts.likes + (wasLiked ? -1 : 1)) },
    });
    try {
      const result = await api.request<{ likeCount: number }>(`/v1/content/${item.id}/reaction`, {
        method: wasLiked ? 'DELETE' : 'PUT',
        ...(wasLiked ? {} : { body: { kind: 'like' } }),
      });
      setItem((current) =>
        current ? { ...current, counts: { ...current.counts, likes: result.likeCount } } : current,
      );
    } catch {
      setItem(before);
    }
  };

  const toggleBookmark = async (): Promise<void> => {
    if (!item) return;
    const wasSaved = item.viewer.hasBookmarked;
    const before = item;
    setItem({ ...item, viewer: { ...item.viewer, hasBookmarked: !wasSaved } });
    try {
      await api.request(`/v1/content/${item.id}/bookmark`, {
        method: wasSaved ? 'DELETE' : 'PUT',
        ...(wasSaved ? {} : { body: {} }),
      });
    } catch {
      setItem(before);
    }
  };

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error' || !item) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

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
            padding: theme.spacing.lg,
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
          <Text variant="heading" style={{ flex: 1 }}>
            {t('post.comments.title')}
          </Text>
          {item && !item.viewer.isAuthor ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('action.more')}
              onPress={() => setMenuOpen(true)}
              hitSlop={8}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.text} />
            </Pressable>
          ) : null}
        </View>
        {item ? (
          <>
            <ActionSheet
              visible={menuOpen}
              onClose={() => setMenuOpen(false)}
              items={[{ label: t('profile.report', { handle: item.author.handle }), onPress: () => setReportOpen(true) }]}
            />
            <ReportSheet
              visible={reportOpen}
              onClose={() => setReportOpen(false)}
              targetType="content"
              targetId={item.id}
            />
          </>
        ) : null}

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.xl,
            gap: theme.spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <PostCard
            item={item}
            onToggleReaction={() => void toggleReaction()}
            onToggleBookmark={() => void toggleBookmark()}
          />

          {/*
           * Sources and corrections sit above the thread, not inside it. A
           * correction buried at comment 40 is invisible to the next reader,
           * which is precisely the failure this replaces.
           */}
          <KnowledgePanel item={item} onChanged={() => void refreshItem()} />

          <Divider />

          {comments.length === 0 ? (
            <View style={{ minHeight: 160 }}>
              <EmptyState title={t('post.comments.title')} body={t('post.comments.empty')} />
            </View>
          ) : (
            <View style={{ gap: theme.spacing.lg }}>
              {comments.map((comment) => (
                <View key={comment.id} style={{ gap: theme.spacing.md }}>
                  <CommentRow comment={comment} locale={locale} />
                  {comment.replies?.length ? (
                    <View
                      style={{
                        // Replies are indented on the reading side, which flips
                        // with the writing direction.
                        [theme.isRTL ? 'paddingRight' : 'paddingLeft']: theme.spacing.xxl,
                        gap: theme.spacing.md,
                      }}
                    >
                      {comment.replies.map((reply) => (
                        <CommentRow key={reply.id} comment={reply} locale={locale} />
                      ))}
                    </View>
                  ) : null}
                  <Divider />
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: theme.spacing.sm,
            padding: theme.spacing.lg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
          }}
        >
          <TextInput
            accessibilityLabel={t('post.comments.placeholder')}
            placeholder={t('post.comments.placeholder')}
            placeholderTextColor={theme.colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
            style={{
              flex: 1,
              maxHeight: 120,
              minHeight: 44,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.background,
              color: theme.colors.text,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.md,
              fontSize: 16,
              textAlign: theme.isRTL ? 'right' : 'left',
              writingDirection: theme.isRTL ? 'rtl' : 'ltr',
            }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('post.comments.send')}
            accessibilityState={{ disabled: sending || draft.trim().length === 0 }}
            disabled={sending || draft.trim().length === 0}
            onPress={() => void send()}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.primary,
              opacity: sending || draft.trim().length === 0 ? 0.4 : pressed ? 0.85 : 1,
            })}
          >
            <DirectionalIcon direction="forward" size={20} color={theme.colors.onPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CommentRow({
  comment,
  locale,
}: {
  comment: Comment;
  locale: 'ar' | 'en';
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
      <Avatar name={comment.author.displayName} size={32} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" bidi="auto">{comment.author.displayName}</Text>
        <Text variant="micro" tone="muted">
          {formatRelative(comment.createdAt, locale)}
        </Text>
        <Text variant="body" style={{ marginTop: theme.spacing.xs }} bidi="auto">
          {comment.body}
        </Text>
      </View>
    </View>
  );
}
