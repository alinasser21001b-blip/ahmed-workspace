import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContentItem } from '@sos/contracts';
import { router } from 'expo-router';
import { Image, Pressable, View } from 'react-native';
import { useI18n } from '../i18n/index';
import { API_BASE_URL } from '../state/session';
import { useTheme } from '../theme/ThemeProvider';
import { KnowledgeBadges, ReaderCaution, TopicChips } from './KnowledgeBadges';
import { Text } from './Text';
import { Avatar, Badge, Card } from './surfaces';

/**
 * A feed card.
 *
 * Every affordance is driven by `item.viewer.*` from the server rather than
 * inferred here. A client that decides for itself whether a delete button
 * belongs will eventually show one that fails on tap, or hide one that should
 * be there.
 */

export interface PostCardProps {
  item: ContentItem;
  onPress?: () => void;
  onToggleReaction?: () => void;
  onToggleBookmark?: () => void;
  onComment?: () => void;
  onAuthorPress?: () => void;
}

function ActionButton({
  icon,
  label,
  count,
  active,
  activeColor,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  count?: number;
  active?: boolean;
  activeColor?: string;
  onPress?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const color = active ? (activeColor ?? theme.colors.primary) : theme.colors.textMuted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active === true }}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        opacity: pressed ? 0.6 : 1,
        minHeight: 32,
      })}
    >
      <Ionicons name={icon} size={18} color={color} />
      {count !== undefined && count > 0 ? (
        <Text variant="caption" style={{ color }}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function PostCard({
  item,
  onPress,
  onToggleReaction,
  onToggleBookmark,
  onComment,
  onAuthorPress,
}: PostCardProps): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useI18n();

  const liked = item.viewer.reaction !== null;
  const firstImage = item.media[0];

  return (
    <Card onPress={onPress} accessibilityLabel={item.body ?? t('post.viewThread')}>
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Pressable onPress={onAuthorPress} accessibilityRole="button" hitSlop={4}>
            <Avatar name={item.author.displayName} size={36} />
          </Pressable>
          <View style={{ flex: 1, gap: 1 }}>
            <Text variant="label" bidi="auto">{item.author.displayName}</Text>
            <Text variant="micro" tone="muted">
              {[item.author.stageName, formatRelative(item.createdAt, locale)]
                .filter(Boolean)
                .join(' · ')}
              {item.editedAt ? ` · ${t('post.edited')}` : ''}
            </Text>
          </View>
          {item.author.verificationLevel === 'instructor' ||
          item.author.verificationLevel === 'official' ? (
            <Ionicons name="shield-checkmark" size={16} color={theme.colors.primary} />
          ) : null}
        </View>

        {/* Above the body, deliberately: a reader must know the content is
            under challenge before they read it, not after. */}
        <ReaderCaution item={item} />

        {item.body ? <Text variant="body" bidi="auto">{item.body}</Text> : null}

        {firstImage ? (
          <Image
            // The URL is relative and signed; the base is the API host.
            source={{ uri: `${API_BASE_URL}${firstImage.url}` }}
            accessibilityIgnoresInvertColors
            // Aspect ratio comes from the stored dimensions, so the card
            // reserves the right space before the bytes arrive and the feed
            // does not jump as images load.
            style={{
              width: '100%',
              aspectRatio:
                firstImage.width && firstImage.height
                  ? firstImage.width / firstImage.height
                  : 4 / 3,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.background,
            }}
            resizeMode="cover"
          />
        ) : null}

        {/*
         * Academic context is what separates this from a generic social card.
         * The topic chips come from `item.topics` rather than
         * `item.academic.topics` — the same rows, but carrying who classified
         * them, and pressable so a card is a way into a topic rather than a
         * dead end. `academic.topics` stays in the contract for consumers that
         * want the bilingual names.
         */}
        {item.academic.courseName ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            <Badge label={item.academic.courseName} tone="learning" />
          </View>
        ) : null}

        <TopicChips
          topics={item.topics.slice(0, 3)}
          onPress={(topicId) => router.push(`/topic/${topicId}`)}
        />

        {/* Counts and a provenance class — never a score (ADR-0013). */}
        <KnowledgeBadges item={item} />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.xl,
            paddingTop: theme.spacing.xs,
          }}
        >
          <ActionButton
            icon={liked ? 'heart' : 'heart-outline'}
            label={t('post.like')}
            count={item.counts.likes}
            active={liked}
            activeColor={theme.colors.danger}
            onPress={onToggleReaction}
          />
          <ActionButton
            icon="chatbubble-outline"
            label={t('post.comment')}
            count={item.counts.comments}
            onPress={onComment}
          />
          <View style={{ flex: 1 }} />
          <ActionButton
            icon={item.viewer.hasBookmarked ? 'bookmark' : 'bookmark-outline'}
            label={item.viewer.hasBookmarked ? t('post.saved') : t('post.save')}
            active={item.viewer.hasBookmarked}
            activeColor={theme.colors.learning}
            onPress={onToggleBookmark}
          />
        </View>
      </View>
    </Card>
  );
}

/**
 * Relative time, in the reader's language.
 *
 * `Intl.RelativeTimeFormat` rather than a date library: it is built in, it
 * knows Arabic plural rules, and a formatting dependency for one function is
 * not worth the bundle.
 */
export function formatRelative(iso: string, locale: 'ar' | 'en'): string {
  const then = new Date(iso).getTime();
  const diffSeconds = Math.round((then - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];

  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds) {
      return formatter.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return formatter.format(diffSeconds, 'second');
}
