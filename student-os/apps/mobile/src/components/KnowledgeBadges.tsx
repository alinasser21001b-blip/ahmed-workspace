import type { ContentItem } from '@sos/contracts';
import { View } from 'react-native';
import { useI18n, type TranslationKey } from '../i18n/index';
import { useTheme } from '../theme/ThemeProvider';
import { Badge, type BadgeTone } from './surfaces';
import { Text } from './Text';

/**
 * What a reader is told about a piece of knowledge.
 *
 * Counts and a class, never a score (ADR-0013). Each number is a number of
 * rows: two sources means two citations someone can go and read. There is
 * deliberately no percentage, no star rating and no badge that blends the
 * facts into one judgement — a number nobody can argue with is a number nobody
 * can improve.
 */

/**
 * How prominent the provenance is.
 *
 * Only content whose accuracy has actually been questioned gets a warning tone.
 * An uncited explanation is the normal state of a student's note, and flagging
 * every one of those would train readers to ignore the flag — costing exactly
 * the cases it exists for.
 */
const PROVENANCE_TONE: Record<ContentItem['signals']['provenance'], BadgeTone> = {
  corrected: 'danger',
  disputed: 'warning',
  source_backed: 'primary',
  author_claim: 'neutral',
};

export function KnowledgeBadges({
  item,
  showProvenance = true,
}: {
  item: ContentItem;
  showProvenance?: boolean;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const theme = useTheme();

  const chips: { key: string; label: string; tone: BadgeTone }[] = [];

  if (item.knowledgeType) {
    chips.push({
      key: 'type',
      label: t(`knowledge.type.${item.knowledgeType}` as TranslationKey),
      tone: 'structure',
    });
  }
  if (item.difficulty) {
    chips.push({
      key: 'difficulty',
      label: t(`knowledge.difficulty.${item.difficulty}` as TranslationKey),
      tone: 'neutral',
    });
  }

  /*
   * The provenance chip is shown when it says something. `author_claim` is the
   * default and the honest description of most student notes — labelling every
   * post with it would be noise, so it is left off and its absence means
   * exactly that.
   */
  if (showProvenance && item.signals.provenance !== 'author_claim') {
    chips.push({
      key: 'provenance',
      label: t(`knowledge.provenance.${item.signals.provenance}` as TranslationKey),
      tone: PROVENANCE_TONE[item.signals.provenance],
    });
  }

  if (item.signals.sourceCount > 0) {
    chips.push({
      key: 'sources',
      label: `${t('knowledge.sources')} · ${item.signals.sourceCount}`,
      tone: 'neutral',
    });
  }
  if (item.signals.helpfulCount > 0) {
    chips.push({
      key: 'helpful',
      label: `${t('knowledge.helpful')} · ${item.signals.helpfulCount}`,
      tone: 'neutral',
    });
  }

  if (chips.length === 0) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: theme.spacing.xs,
      }}
    >
      {chips.map((chip) => (
        <Badge key={chip.key} label={chip.label} tone={chip.tone} />
      ))}
    </View>
  );
}

/**
 * The topics a piece of content is classified under, with who said so.
 *
 * The source is rendered rather than dropped even though nothing sets `ai`
 * yet: a UI that has silently shown model tags as the author's for a year
 * cannot be un-merged, and the fix has to be in place before the classifier is
 * (ADR-0013).
 */
export function TopicChips({
  topics,
  onPress,
}: {
  topics: ContentItem['topics'];
  onPress?: (topicId: string) => void;
}): React.JSX.Element | null {
  const theme = useTheme();
  const { t } = useI18n();
  if (topics.length === 0) return null;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
      {topics.map((topic) => (
        <Badge
          key={topic.id}
          label={topic.source === 'author' ? topic.name : `${topic.name} · ${t('topic.related.derived')}`}
          tone="primary"
          onPress={onPress ? () => onPress(topic.id) : undefined}
        />
      ))}
    </View>
  );
}

/**
 * A caution shown above the body, for content under challenge.
 *
 * Deliberately not a hidden or collapsed post: a disagreement is often where
 * the learning is, and the product's job is to make sure the reader knows
 * before they read — not to decide for them.
 */
export function ReaderCaution({ item }: { item: ContentItem }): React.JSX.Element | null {
  const { t } = useI18n();
  const theme = useTheme();
  const { provenance } = item.signals;
  if (provenance !== 'corrected' && provenance !== 'disputed') return null;

  return (
    <View
      style={{
        borderRadius: theme.radius.md,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        backgroundColor:
          provenance === 'corrected' ? theme.colors.challengedSoft : theme.colors.provenanceSoft,
      }}
    >
      {/*
       * A corrected claim is `challenged` — something does not hold — not
       * `danger`, which is reserved for actions that destroy something.
       */}
      <Text variant="metadata" tone={provenance === 'corrected' ? 'challenged' : 'provenance'}>
        {t(`knowledge.provenance.${provenance}` as TranslationKey)}
      </Text>
    </View>
  );
}
