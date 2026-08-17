import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContentItem } from '@sos/contracts';
import { View } from 'react-native';
import { localizeDigits, useI18n } from '../../i18n/index';
import { PressFade } from '../../motion/index';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from '../Text';

/**
 * The interaction row that turns a read-only feed into a social one.
 *
 * Today is the primary academic social feed (owner decision), so the acts a
 * student performs on a post — like, comment, save, and the quieter reporting
 * path — belong on the post where they read it, not one screen deeper. What
 * this row must NOT become is a metrics bar: the reference model is the
 * familiarity of the interaction, never the engagement language around it.
 *
 * Three rules hold it to the Academic Editorial system:
 *
 *   1. No colour carries a state on its own. A liked post is a filled glyph,
 *      an ink-weighted count and an `accessibilityState` — never a red heart
 *      doing all three jobs at once.
 *   2. Counts render only when there are any. A row of zeroes is a scoreboard
 *      inviting a student to fill it in; an absent count is simply a post
 *      nobody has replied to yet.
 *   3. Metadata scale, not body scale. These are instruments beside the
 *      claim — the claim stays the loudest thing in the row.
 */

export function ContentActions({
  item,
  onToggleReaction,
  onToggleBookmark,
  onComment,
  onMore,
}: {
  item: ContentItem;
  onToggleReaction: () => void;
  onToggleBookmark: () => void;
  onComment: () => void;
  onMore?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useI18n();
  const liked = item.viewer.reaction !== null;
  const saved = item.viewer.hasBookmarked;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xl,
        paddingTop: theme.spacing.xs,
      }}
    >
      <Action
        icon={liked ? 'heart' : 'heart-outline'}
        label={t('post.like')}
        count={item.counts.likes}
        active={liked}
        onPress={onToggleReaction}
      />
      <Action
        icon="chatbubble-outline"
        label={t('post.comment')}
        count={item.counts.comments}
        onPress={onComment}
      />
      <Action
        icon={saved ? 'bookmark' : 'bookmark-outline'}
        label={saved ? t('post.saved') : t('post.save')}
        active={saved}
        onPress={onToggleBookmark}
      />
      <View style={{ flex: 1 }} />
      {onMore ? (
        <Action icon="ellipsis-horizontal" label={t('action.more')} onPress={onMore} />
      ) : null}
    </View>
  );
}

function Action({
  icon,
  label,
  count,
  active = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  count?: number;
  active?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { locale } = useI18n();

  return (
    <PressFade
      accessibilityRole="button"
      accessibilityLabel={count && count > 0 ? `${label}, ${count}` : label}
      // A liked or saved post is a *state*, and a screen reader is told so
      // rather than being left to infer it from a glyph name.
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={10}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 44,
        // The row reads as instruments, so the hit area is generous while the
        // ink stays small: 44 px of target under a 16 px glyph.
        justifyContent: 'center',
      }}
    >
      <Ionicons
        name={icon}
        size={16}
        color={active ? theme.colors.text : theme.colors.textMuted}
      />
      {count !== undefined && count > 0 ? (
        <Text
          variant="metadata"
          tone={active ? 'default' : 'muted'}
          {...(active ? { style: { fontWeight: '600' } } : {})}
        >
          {localizeDigits(locale, count)}
        </Text>
      ) : null}
    </PressFade>
  );
}
