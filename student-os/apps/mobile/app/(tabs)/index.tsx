import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContentItem, Profile } from '@sos/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionSheet, ConfirmDialog } from '../../src/components/ActionSheet';
import { Avatar } from '../../src/components/surfaces';
import { Hairline, MetadataLine, SectionHeader } from '../../src/components/editorial';
import { ContentActions } from '../../src/components/knowledge/ContentActions';
import { ContentGrammar } from '../../src/components/knowledge/ContentGrammar';
import { ReportSheet } from '../../src/components/ReportSheet';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { Text } from '../../src/components/Text';
import { localizeDigits, useI18n } from '../../src/i18n/index';
import { bumpContentVersion } from '../../src/state/content-events';
import { useSession } from '../../src/state/session';
import { useFeed } from '../../src/state/useFeed';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Enter } from '../../src/motion/index';

/**
 * Today — the primary academic social feed (owner decision, non-negotiable).
 *
 * Header (Student OS · date · cohort) → 2 px rule → section groups → tab bar.
 * Sections are classification statements, not engagement buckets:
 * "Classified to your topics" and "Under challenge". Each item is a
 * ContentGrammar row separated by hairlines. No cards. The eleven-pill badge
 * stack is gone.
 *
 * What changed in the recovery pass: Today used to be a reading surface that
 * sent every act one screen deeper. The whole social loop — read, like,
 * comment, save, open the author, open the topic, report, compose, return —
 * now closes on this screen, against the endpoints the API has carried all
 * along (`PUT /v1/content/:id/reaction`, `…/bookmark`, `POST /v1/reports`,
 * cursor pagination on `/v1/feed`). Nothing here is a new counter or a new
 * ranking: the numbers are the server's, and the order is still the feed's
 * classification order, not an engagement score.
 *
 * The interaction model is the familiar one; the visual language is not. No
 * cards, no pill stacks, no colour standing in for a state.
 *
 * Home has no dominant action; reading is the action. The resume band exists
 * in the design only for an open practice attempt, and no endpoint exposes
 * open attempts today, so the suppression rule resolves to "never shown" —
 * an honest absence, not an omission.
 */

type Row =
  | { kind: 'section'; key: string; title: string; tone: 'structure' | 'challenged'; count?: number }
  | { kind: 'item'; key: string; item: ContentItem };

export default function Home(): React.JSX.Element {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { api } = useSession();
  const feed = useFeed('home');

  const [profile, setProfile] = useState<Profile | null>(null);
  /** The post whose overflow menu is open, and the sheets it can raise. */
  const [menuFor, setMenuFor] = useState<ContentItem | null>(null);
  const [reportFor, setReportFor] = useState<ContentItem | null>(null);
  const [deleteFor, setDeleteFor] = useState<ContentItem | null>(null);

  useEffect(() => {
    void api
      .get<Profile>('/v1/me/profile')
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [api]);

  /**
   * Deleting your own post. The endpoint has always existed
   * (`DELETE /v1/content/:id`); nothing in the app ever called it, so a
   * student could publish but never retract — the one asymmetry in the social
   * model that no product would ship on purpose.
   */
  const deletePost = useCallback(
    async (item: ContentItem): Promise<void> => {
      try {
        await api.request(`/v1/content/${item.id}`, { method: 'DELETE' });
        bumpContentVersion();
      } catch {
        // The list is unchanged and the post is still there: refreshing is
        // the honest recovery, not a local removal that lies about the server.
        void feed.refresh();
      }
    },
    [api, feed],
  );

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { item: Row }[] }) => {
      for (const entry of viewableItems) {
        if (entry.item.kind !== 'item' || entry.item.item.viewer.hasViewed) continue;
        void api.post(`/v1/content/${entry.item.item.id}/view`, {}).catch(() => {
          /* a dropped view signal is not worth surfacing */
        });
      }
    },
    [api],
  );

  const rows = useMemo<Row[]>(() => {
    const challenged = feed.items.filter((item) => item.signals.provenance === 'disputed');
    const classified = feed.items.filter((item) => item.signals.provenance !== 'disputed');
    const list: Row[] = [];
    if (classified.length > 0) {
      list.push({
        kind: 'section',
        key: 'section-classified',
        title: t('feed.classified'),
        tone: 'structure',
        count: classified.length,
      });
      for (const item of classified) list.push({ kind: 'item', key: item.id, item });
    }
    if (challenged.length > 0) {
      list.push({
        kind: 'section',
        key: 'section-challenged',
        title: t('feed.underChallenge'),
        tone: 'challenged',
        count: challenged.length,
      });
      for (const item of challenged) list.push({ kind: 'item', key: item.id, item });
    }
    return list;
  }, [feed.items, t]);

  const today = new Date().toLocaleDateString(locale === 'ar' ? 'ar' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const header = (
    <View style={{ gap: theme.spacing.md, paddingBottom: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" variant="display">
            Student OS
          </Text>
          <MetadataLine
            parts={[today, profile?.academic.stageName ?? null, profile?.academic.collegeName ?? null]}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('search.placeholder')}
          onPress={() => router.push('/search')}
          hitSlop={8}
          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="search-outline" size={22} color={theme.colors.text} />
        </Pressable>
        {/*
         * Your own face, as the way back to your own profile and to Settings.
         * Before this, a student could reach their own profile only by finding
         * one of their own posts — so account deletion, blocked accounts and
         * the whole settings group sat behind an accident.
         */}
        {profile ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('nav.profile')}
            onPress={() => router.push(`/profile/${profile.handle}`)}
            hitSlop={8}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Avatar name={profile.displayName} size={28} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          // `compose.title`, not `nav.create`: this glyph opens the composer,
          // and sharing a label with the Create tab makes both ambiguous to a
          // screen reader and to any test that addresses them by name.
          accessibilityLabel={t('compose.title')}
          onPress={() => router.push('/compose')}
          hitSlop={8}
          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="create-outline" size={22} color={theme.colors.text} />
        </Pressable>
      </View>
      <View style={{ height: 2, backgroundColor: theme.colors.text }} />
    </View>
  );

  if (feed.status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
        <View style={{ padding: theme.spacing.xl }}>{header}</View>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (feed.status === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
        <View style={{ padding: theme.spacing.xl }}>{header}</View>
        <ErrorState onRetry={() => void feed.refresh()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: theme.spacing.lg,
          paddingBottom: theme.spacing.xxl,
        }}
        ListHeaderComponent={<Enter>{header}</Enter>}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 800 }}
        renderItem={({ item: row, index }) => {
          if (row.kind === 'section') {
            return (
              <View
                style={{
                  paddingTop: index === 0 ? theme.spacing.sm : theme.spacing.xl,
                  paddingBottom: theme.spacing.xs,
                }}
              >
                <SectionHeader
                  title={row.title}
                  tone={row.tone}
                  {...(row.count !== undefined
                    ? { trailing: localizeDigits(locale, row.count) }
                    : {})}
                />
              </View>
            );
          }
          return (
            <View>
              <ContentGrammar
                item={row.item}
                density="feed"
                onPress={() => router.push(`/post/${row.item.id}`)}
                onPressAuthor={() => router.push(`/profile/${row.item.author.handle}`)}
                onPressTopic={
                  row.item.academic.topics[0]
                    ? () => router.push(`/topic/${row.item.academic.topics[0]!.id}`)
                    : undefined
                }
                actions={
                  <ContentActions
                    item={row.item}
                    onToggleReaction={() => void feed.toggleReaction(row.item)}
                    onToggleBookmark={() => void feed.toggleBookmark(row.item)}
                    // Comments live on the post, where the thread is. The act
                    // that belongs to the feed is deciding to join it.
                    onComment={() => router.push(`/post/${row.item.id}`)}
                    onMore={() => setMenuFor(row.item)}
                  />
                }
              />
              <Hairline />
            </View>
          );
        }}
        onEndReached={() => void feed.loadMore()}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          feed.status === 'loadingMore' ? (
            <View style={{ paddingVertical: theme.spacing.xl }}>
              <ActivityIndicator color={theme.colors.textMuted} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            title={t('feed.empty.title')}
            body={t('feed.empty.body')}
            action={{ label: t('feed.empty.action'), onPress: () => router.push('/compose') }}
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={feed.status === 'refreshing'}
            onRefresh={() => void feed.refresh()}
            tintColor={theme.colors.text}
          />
        }
      />

      {/*
       * The quiet half of the social model. A student who meets something
       * wrong in the feed can act on it there: report it, or — for their own
       * post — withdraw it. Blocking stays on the profile, where you can see
       * whom you are blocking; the report sheet offers that route on
       * confirmation, which is the path the profile screen already uses.
       */}
      <ActionSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        accessibilityLabel={t('action.more')}
        items={
          menuFor === null
            ? []
            : menuFor.viewer.isAuthor
              ? [
                  {
                    label: t('post.delete'),
                    tone: 'danger' as const,
                    onPress: () => setDeleteFor(menuFor),
                  },
                ]
              : [
                  { label: t('post.report'), onPress: () => setReportFor(menuFor) },
                  {
                    label: t('post.openProfile'),
                    onPress: () => router.push(`/profile/${menuFor.author.handle}`),
                  },
                ]
        }
      />
      {reportFor ? (
        <ReportSheet
          visible
          onClose={() => setReportFor(null)}
          targetType="content"
          targetId={reportFor.id}
        />
      ) : null}
      <ConfirmDialog
        visible={deleteFor !== null}
        title={t('post.delete.confirm.title')}
        body={t('post.delete.confirm.body')}
        confirmLabel={t('post.delete')}
        cancelLabel={t('action.cancel')}
        danger
        onCancel={() => setDeleteFor(null)}
        onConfirm={() => {
          const target = deleteFor;
          setDeleteFor(null);
          if (target) void deletePost(target);
        }}
      />
    </SafeAreaView>
  );
}
