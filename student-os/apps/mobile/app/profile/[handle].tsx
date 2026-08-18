import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContentItem, Conversation, FeedPage, Profile, Relationship } from '@sos/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionSheet, ConfirmDialog } from '../../src/components/ActionSheet';
import { ReportSheet } from '../../src/components/ReportSheet';
import {
  DominantAction,
  Hairline,
  MetadataLine,
  SectionHeader,
  SecondaryAction,
  TopBar,
} from '../../src/components/editorial';
import { ContentGrammar } from '../../src/components/knowledge/ContentGrammar';
import { Text } from '../../src/components/Text';
import { Avatar, Badge } from '../../src/components/surfaces';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { localizeDigits, useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Enter } from '../../src/motion/index';

/**
 * Student profile (§7).
 *
 * An academic identity, not a vanity page: college and stage sit next to the
 * name, and the headline number is the contribution score rather than a
 * follower count (§37).
 */
export default function ProfileScreen(): React.JSX.Element {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { api } = useSession();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [posts, setPosts] = useState<ContentItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [acting, setActing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      const [detail, rel, page] = await Promise.all([
        api.get<Profile>(`/v1/profiles/${handle}`),
        api.get<Relationship>(`/v1/profiles/${handle}/relationship`),
        api.get<FeedPage>(`/v1/feed?scope=author&authorHandle=${handle}&limit=20`),
      ]);
      setProfile(detail);
      setRelationship(rel);
      setPosts(page.items);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [api, handle]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFollow = async (): Promise<void> => {
    if (!relationship) return;
    setActing(true);
    try {
      const next = await api.request<Relationship>(`/v1/profiles/${handle}/follow`, {
        method: relationship.isFollowing ? 'DELETE' : 'PUT',
      });
      setRelationship(next);
    } catch {
      /* the button simply stays as it was */
    } finally {
      setActing(false);
    }
  };

  /**
   * Opens (or reopens) the direct conversation with this person and goes to
   * it. The endpoint is idempotent per unordered pair, so tapping Message
   * twice cannot produce two threads with the same student.
   */
  const openConversation = async (): Promise<void> => {
    setActing(true);
    try {
      const conversation = await api.post<Conversation>('/v1/conversations', {
        recipientHandle: handle,
      });
      router.push(`/chat/${conversation.id}`);
    } catch {
      // Blocked in either direction, or offline. The profile stays put rather
      // than navigating to a thread that does not exist.
    } finally {
      setActing(false);
    }
  };

  /*
   * Guideline 1.2 — "the ability to block abusive users from the service".
   *
   * Confirmed rather than instant: blocking cuts off messaging, following and
   * private-content visibility in one step, and the person is never told —
   * which means an accidental tap has no easy way back except finding this
   * screen again through Settings → Blocked accounts.
   */
  const toggleBlock = async (): Promise<void> => {
    if (!relationship) return;
    setActing(true);
    try {
      const next = await api.request<Relationship>(`/v1/profiles/${handle}/block`, {
        method: relationship.isBlocked ? 'DELETE' : 'PUT',
        // The route's body is `{ reason }` with `reason` optional — but the
        // payload itself must still be a JSON object. Omitting `body` here
        // sent no payload at all (the client only attaches one when it is
        // not `undefined`), which the server correctly rejected with 400 on
        // every single call. The catch below then swallowed that failure
        // silently, so the confirm dialog closed as if the block had taken
        // and it never had — the same shape of bug `toggleBookmark` in
        // `useFeed.ts` already avoids by sending `{}` on its PUT.
        ...(relationship.isBlocked ? {} : { body: {} }),
      });
      setRelationship(next);
    } catch {
      /* the button simply stays as it was */
    } finally {
      setActing(false);
    }
  };

  if (status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (status === 'error' || !profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ErrorState onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  const isSelf = profile.viewer?.isSelf ?? false;
  const blocked = relationship?.isBlocked ?? false;

  const header = (
    <View style={{ gap: theme.spacing.xl, paddingBottom: theme.spacing.lg }}>
      <TopBar
        title={profile.displayName}
        onBack={() => router.back()}
        rule={false}
        trailing={
          isSelf ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.title')}
              onPress={() => router.push('/settings')}
              hitSlop={8}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="settings-outline" size={22} color={theme.colors.text} />
            </Pressable>
          ) : profile.viewer ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile.more')}
              onPress={() => setMenuOpen(true)}
              hitSlop={8}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.text} />
            </Pressable>
          ) : null
        }
      />

      {/* Identity, then context, then work. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
        <Avatar name={profile.displayName} size={56} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
            <Text variant="title" bidi="auto" style={{ flexShrink: 1 }}>
              {profile.displayName}
            </Text>
            {profile.verificationLevel === 'instructor' ? (
              <Ionicons
                name="ribbon-outline"
                size={16}
                color={theme.colors.structure}
                accessibilityLabel={t('profile.verifiedInstructor')}
              />
            ) : null}
          </View>
          {/* The handle is a Latin run and stays isolated beside an Arabic name. */}
          <MetadataLine
            parts={[`@${profile.handle}`, profile.academic.collegeName, profile.academic.stageName]}
            bidi="auto"
          />
        </View>
      </View>

      {profile.bio ? (
        <Text variant="body" tone="secondary" bidi="auto">
          {profile.bio}
        </Text>
      ) : null}

      <View style={{ height: 2, backgroundColor: theme.colors.text }} />

      {/*
       * THE NUMBER THAT IS NOT HERE.
       *
       * A profile used to open with one display-sized figure labelled
       * "contribution". The audit traced it to `profiles.contribution_score`:
       * a column created with `DEFAULT 0` and a non-negativity check that no
       * migration, service, trigger, job or seed ever writes. Every real
       * student's profile therefore showed a 30 px `0` forever; the lively
       * numbers people remembered seeing (12, 120, 25) existed only in the
       * preview fixtures.
       *
       * Rendering a constant as if it were an achievement is the exact shape
       * of a fake feature, so it is gone. The alternative — inventing a
       * formula here — would be worse: a reputation number is a product
       * decision with real social consequences, not a client-side sum. The
       * column stays reserved, and 06-LEARNING-ARCHITECTURE.md records what a
       * real computation would have to decide.
       *
       * `followerCount`/`followingCount` remain deliberately unshown for the
       * original reason: a popularity metric beside anything else wins.
       *
       * What a profile carries instead is what it always should have: an
       * academic identity, declared interests, and the person's actual posts.
       */}

      {profile.interests.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <SectionHeader title={t('profile.interests')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            {profile.interests.slice(0, 6).map((topic) => (
              <Badge
                key={topic.id}
                label={locale === 'ar' ? topic.nameAr : topic.nameEn}
                tone="structure"
                onPress={() => router.push(`/topic/${topic.id}`)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/* Relationship actions announce their result politely. */}
      <View accessibilityLiveRegion="polite">
        {blocked ? (
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="body" tone="secondary">
              {t('social.blockedPerson')}
            </Text>
            <SecondaryAction
              label={t('profile.unblock', { handle: profile.handle })}
              onPress={() => void toggleBlock()}
              disabled={acting}
            />
          </View>
        ) : isSelf ? (
          <SecondaryAction
            label={t('profile.editProfile')}
            onPress={() => router.push('/settings')}
          />
        ) : relationship ? (
          // Not following → a filled Follow. Following → an outlined
          // "Following"; there is no dominant action on a profile you follow.
          //
          // Beside it, Message. `POST /v1/conversations` is idempotent per
          // unordered pair and has existed since the messaging module landed,
          // but nothing in the app ever called it: the Chat tab could only
          // show conversations that already existed, and its own empty state
          // sent you to search, which sent you to a profile, which offered no
          // way to write to anyone. That was the one broken link in an
          // otherwise complete messaging core.
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <View style={{ flex: 1 }}>
              {relationship.isFollowing ? (
                <SecondaryAction
                  label={t('social.following')}
                  onPress={() => void toggleFollow()}
                  disabled={acting}
                />
              ) : (
                <DominantAction
                  label={t('social.follow')}
                  onPress={() => void toggleFollow()}
                  loading={acting}
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <SecondaryAction
                label={t('profile.message')}
                onPress={() => void openConversation()}
                disabled={acting}
              />
            </View>
          </View>
        ) : null}
      </View>

      <SectionHeader title={t('profile.posts')} />
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={[
          {
            label: relationship?.isBlocked
              ? t('profile.unblock', { handle: profile.handle })
              : t('profile.block', { handle: profile.handle }),
            tone: relationship?.isBlocked ? 'default' : 'danger',
            onPress: () => {
              if (relationship?.isBlocked) void toggleBlock();
              else setBlockConfirmOpen(true);
            },
          },
          {
            label: t('profile.report', { handle: profile.handle }),
            onPress: () => setReportOpen(true),
          },
        ]}
      />
      <ConfirmDialog
        visible={blockConfirmOpen}
        title={t('profile.block.confirmTitle', { handle: profile.handle })}
        body={t('profile.block.confirmBody', { handle: profile.handle })}
        confirmLabel={t('profile.block', { handle: profile.handle })}
        cancelLabel={t('action.cancel')}
        danger
        onConfirm={() => {
          setBlockConfirmOpen(false);
          void toggleBlock();
        }}
        onCancel={() => setBlockConfirmOpen(false)}
      />
      <ReportSheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="profile"
        targetId={profile.userId}
        {...(profile.viewer && !profile.viewer.isSelf && !blocked
          ? { onBlock: () => setBlockConfirmOpen(true) }
          : {})}
      />
      <FlatList
        data={blocked ? [] : posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          padding: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl,
          flexGrow: 1,
        }}
        ListHeaderComponent={<Enter>{header}</Enter>}
        ListEmptyComponent={
          <View style={{ minHeight: 180 }}>
            <EmptyState
              title={t('profile.noPosts')}
              body={t('feed.empty.body')}
              {...(isSelf
                ? {
                    action: {
                      label: t('profile.writeSomething'),
                      onPress: () => router.push('/compose'),
                    },
                  }
                : {})}
            />
          </View>
        }
        ItemSeparatorComponent={Hairline}
        renderItem={({ item }) => (
          <ContentGrammar
            item={item}
            density="profile"
            onPress={() => router.push(`/post/${item.id}`)}
          />
        )}
      />
    </SafeAreaView>
  );
}
