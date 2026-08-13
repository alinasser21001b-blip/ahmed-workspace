import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContentItem, Profile } from '@sos/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PostCard } from '../../src/components/PostCard';
import { Text } from '../../src/components/Text';
import { Avatar } from '../../src/components/surfaces';
import { EmptyState, ErrorState, LoadingState, Skeleton } from '../../src/components/states';
import { useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useFeed } from '../../src/state/useFeed';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Home — the cohort feed (§55).
 *
 * The list is virtualised from the start. A feed that renders every item is
 * fine at twenty posts and unusable at two hundred, and retrofitting
 * virtualisation means rewriting every row component.
 */
export default function Home(): React.JSX.Element {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { api } = useSession();
  const feed = useFeed('home');

  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    void api
      .get<Profile>('/v1/me/profile')
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [api]);

  /**
   * Reports a view once an item has actually been on screen. Tied to
   * viewability rather than to render, so scrolling past something at speed
   * does not count as having seen it.
   */
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { item: ContentItem }[] }) => {
      for (const entry of viewableItems) {
        if (entry.item.viewer.hasViewed) continue;
        void api
          .post(`/v1/content/${entry.item.id}/view`, {})
          .catch(() => {/* a dropped view signal is not worth surfacing */});
      }
    },
    [api],
  );

  const header = (
    <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        {profile ? (
          <>
            <Avatar name={profile.displayName} size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading">{t('home.greeting', { name: profile.displayName })}</Text>
              <Text variant="caption" tone="muted">
                {[profile.academic.collegeName, profile.academic.stageName]
                  .filter(Boolean)
                  .join(locale === 'ar' ? ' — ' : ' · ')}
              </Text>
            </View>
          </>
        ) : (
          <>
            <Skeleton height={44} width={44} radiusKey="lg" />
            <View style={{ flex: 1, gap: theme.spacing.xs }}>
              <Skeleton height={18} width="60%" />
              <Skeleton height={14} width="40%" />
            </View>
          </>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('nav.search')}
          onPress={() => router.push('/search')}
          hitSlop={8}
        >
          <Ionicons name="search-outline" size={24} color={theme.colors.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('compose.title')}
          onPress={() => router.push('/compose')}
          hitSlop={8}
        >
          <Ionicons name="create-outline" size={24} color={theme.colors.primary} />
        </Pressable>
      </View>
      <Text variant="heading">{t('home.section.feed')}</Text>
    </View>
  );

  if (feed.status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
        <View style={{ padding: theme.spacing.lg, flex: 1 }}>
          {header}
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  if (feed.status === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
        <View style={{ padding: theme.spacing.lg, flex: 1 }}>
          <ErrorState onRetry={() => void feed.refresh()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
      <FlatList
        data={feed.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.md,
          flexGrow: 1,
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={{ flex: 1, minHeight: 280 }}>
            <EmptyState
              title={t('feed.empty.title')}
              body={t('feed.empty.body')}
              action={{ label: t('feed.empty.action'), onPress: () => router.push('/compose') }}
            />
          </View>
        }
        renderItem={({ item }) => (
          <PostCard
            item={item}
            onPress={() => router.push(`/post/${item.id}`)}
            onComment={() => router.push(`/post/${item.id}`)}
            onToggleReaction={() => void feed.toggleReaction(item)}
            onToggleBookmark={() => void feed.toggleBookmark(item)}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={feed.status === 'refreshing'}
            onRefresh={() => void feed.refresh()}
            tintColor={theme.colors.primary}
          />
        }
        onEndReached={() => void feed.loadMore()}
        onEndReachedThreshold={0.6}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60, minimumViewTime: 800 }}
        ListFooterComponent={
          feed.status === 'loadingMore' ? (
            <View style={{ paddingVertical: theme.spacing.xl }}>
              <Skeleton height={120} radiusKey="lg" />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
