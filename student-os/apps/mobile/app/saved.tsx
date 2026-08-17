import { router } from 'expo-router';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Hairline, TopBar } from '../src/components/editorial';
import { ContentActions } from '../src/components/knowledge/ContentActions';
import { ContentGrammar } from '../src/components/knowledge/ContentGrammar';
import { EmptyState, ErrorState, LoadingState } from '../src/components/states';
import { Text } from '../src/components/Text';
import { useI18n } from '../src/i18n/index';
import { Enter } from '../src/motion/index';
import { useFeed } from '../src/state/useFeed';
import { useTheme } from '../src/theme/ThemeProvider';

/**
 * Saved — the read-back half of the bookmark.
 *
 * Saving a post has always worked: it writes a bookmark and, in the same
 * transaction, a `knowledge_saved` learning signal per topic. Reading them
 * back did not exist anywhere in the app — `GET /v1/feed?scope=saved` was
 * served by the API, supported by the feed hook, exercised by the smoke test,
 * and rendered by nothing. From the student's side the bookmark was write-only:
 * an act with no consequence they could see.
 *
 * This screen is that consequence. It is deliberately the same grammar as
 * Today — same rows, same provenance line, same actions — because a saved post
 * is not a different kind of object, and unsaving here removes the row rather
 * than leaving a ghost the next refresh would clear.
 */
export default function Saved(): React.JSX.Element {
  const { t } = useI18n();
  const theme = useTheme();
  const feed = useFeed('saved');

  if (feed.status === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
        <View style={{ padding: theme.spacing.xl }}>
          <TopBar title={t('saved.title')} onBack={() => router.back()} />
        </View>
        <LoadingState />
      </SafeAreaView>
    );
  }

  if (feed.status === 'error') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
        <View style={{ padding: theme.spacing.xl }}>
          <TopBar title={t('saved.title')} onBack={() => router.back()} />
        </View>
        <ErrorState onRetry={() => void feed.refresh()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
      <FlatList
        data={feed.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: theme.spacing.lg,
          paddingBottom: theme.spacing.xxl,
          flexGrow: 1,
        }}
        ListHeaderComponent={
          <Enter>
            <View style={{ gap: theme.spacing.xs, paddingBottom: theme.spacing.md }}>
              <TopBar title={t('saved.title')} onBack={() => router.back()} />
              <Text variant="metadata" tone="muted">
                {t('saved.subtitle')}
              </Text>
            </View>
          </Enter>
        }
        renderItem={({ item }) => (
          <View>
            <ContentGrammar
              item={item}
              density="feed"
              onPress={() => router.push(`/post/${item.id}`)}
              onPressAuthor={() => router.push(`/profile/${item.author.handle}`)}
              {...(item.academic.topics[0]
                ? { onPressTopic: () => router.push(`/topic/${item.academic.topics[0]!.id}`) }
                : {})}
              actions={
                <ContentActions
                  item={item}
                  onToggleReaction={() => void feed.toggleReaction(item)}
                  onToggleBookmark={() => void feed.toggleBookmark(item)}
                  onComment={() => router.push(`/post/${item.id}`)}
                />
              }
            />
            <Hairline />
          </View>
        )}
        onEndReached={() => void feed.loadMore()}
        onEndReachedThreshold={0.6}
        ListEmptyComponent={
          <EmptyState
            title={t('saved.empty.title')}
            body={t('saved.empty.body')}
            action={{ label: t('saved.empty.action'), onPress: () => router.push('/(tabs)') }}
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
