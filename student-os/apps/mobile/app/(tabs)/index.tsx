import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContentItem, Profile } from '@sos/contracts';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Hairline, MetadataLine, SectionHeader } from '../../src/components/editorial';
import { ContentGrammar } from '../../src/components/knowledge/ContentGrammar';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/states';
import { Text } from '../../src/components/Text';
import { localizeDigits, useI18n } from '../../src/i18n/index';
import { useSession } from '../../src/state/session';
import { useFeed } from '../../src/state/useFeed';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Enter } from '../../src/motion/index';

/**
 * Home — per 11-HOME.md.
 *
 * Header (Student OS · date · cohort) → 2 px rule → section groups → tab bar.
 * Sections are classification statements, not engagement buckets:
 * "Classified to your topics" and "Under challenge". Each item is a
 * ContentGrammar row separated by hairlines. No cards. The eleven-pill badge
 * stack is gone.
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

  useEffect(() => {
    void api
      .get<Profile>('/v1/me/profile')
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [api]);

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
              />
              <Hairline />
            </View>
          );
        }}
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
    </SafeAreaView>
  );
}
