import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContentItem, FeedPage, Profile, Relationship } from '@sos/contracts';
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
import { useSession } from '../../src/state/session';
import { useTheme } from '../../src/theme/ThemeProvider';

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
          {profile.displayName}
        </Text>
      </View>

      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <Avatar name={profile.displayName} size={56} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{profile.displayName}</Text>
              <Text variant="caption" tone="muted">
                @{profile.handle}
              </Text>
              <Text variant="micro" tone="muted">
                {[profile.academic.collegeName, profile.academic.stageName]
                  .filter(Boolean)
                  .join(locale === 'ar' ? ' — ' : ' · ')}
              </Text>
            </View>
          </View>

          {profile.bio ? <Text variant="body">{profile.bio}</Text> : null}

          {profile.interests.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              {profile.interests.slice(0, 6).map((topic) => (
                <Badge
                  key={topic.id}
                  label={locale === 'ar' ? topic.nameAr : topic.nameEn}
                  tone="learning"
                />
              ))}
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xl }}>
            <View>
              <Text variant="heading">{profile.contributionScore}</Text>
              <Text variant="micro" tone="muted">
                {t('profile.contributionScore')}
              </Text>
            </View>
          </View>

          {profile.viewer && !profile.viewer.isSelf && relationship ? (
            <Button
              label={relationship.isFollowing ? t('groups.leave') : t('groups.join')}
              variant={relationship.isFollowing ? 'secondary' : 'primary'}
              onPress={() => void toggleFollow()}
              loading={acting}
            />
          ) : null}
        </View>
      </Card>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.md,
          flexGrow: 1,
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={{ minHeight: 180 }}>
            <EmptyState title={t('feed.empty.title')} body={t('feed.empty.body')} />
          </View>
        }
        renderItem={({ item }) => (
          <PostCard item={item} onPress={() => router.push(`/post/${item.id}`)} />
        )}
      />
    </SafeAreaView>
  );
}
