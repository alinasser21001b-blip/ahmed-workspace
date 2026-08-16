import Ionicons from '@expo/vector-icons/Ionicons';
import type { ContentItem, ContentSource } from '@sos/contracts';
import { Pressable, View } from 'react-native';
import { localizeDigits, useI18n, type TranslationKey } from '../../i18n/index';
import { useTheme } from '../../theme/ThemeProvider';
import { MetadataLine } from '../editorial';
import { Avatar } from '../surfaces';
import { formatRelative } from '../PostCard';
import { Text } from '../Text';

/**
 * ContentGrammar — one representation of an academic object everywhere it
 * appears, so no feature team invents a second (09-COMPONENTS.md).
 *
 * Anatomy, in fixed order: classification metadata › knowledge body in the
 * display voice › ProvenanceLine › author metadata › optional challenged
 * status. No cards, no shadows — rows separated by hairlines. The eleven-pill
 * badge stack from the earlier design is gone; this is what replaced it.
 */

// ---------------------------------------------------------------------------
// ProvenanceLine — the product's defining primitive

export function ProvenanceLine({
  sourceCount,
  sources = [],
  density = 'inline',
}: {
  sourceCount: number;
  sources?: Pick<ContentSource, 'citation' | 'pageRef'>[];
  density?: 'full' | 'inline';
}): React.JSX.Element | null {
  const theme = useTheme();
  const { t, locale } = useI18n();

  // Absent provenance renders nothing at all. No "no sources" placeholder:
  // an uncited claim is an author claim, not an error.
  if (sourceCount === 0) return null;

  const first = sources[0];
  const count = t('provenance.cites', { count: sourceCount });
  const label =
    density === 'inline' && first
      ? `${count} — ${first.citation}`
      : count;

  return (
    <View
      accessibilityLabel={[count, first?.citation, first?.pageRef]
        .filter(Boolean)
        .join('. ')}
      style={{
        borderStartWidth: 2,
        borderStartColor: theme.colors.provenance,
        paddingStart: 11,
        gap: 2,
      }}
    >
      <Text
        variant="metadata"
        tone="provenance"
        style={{ fontWeight: '600' }}
        numberOfLines={density === 'inline' ? 1 : undefined}
        bidi="auto"
      >
        {localizeDigits(locale, label)}
      </Text>
      {density === 'full'
        ? sources.map((source, index) => (
            <View
              key={index}
              style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.spacing.sm }}
            >
              <Text variant="metadata" tone="muted" bidi="auto">
                {source.citation}
              </Text>
              {source.pageRef ? <Text variant="numeric" tone="muted">{source.pageRef}</Text> : null}
            </View>
          ))
        : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ContentGrammar

export type ContentDensity = 'feed' | 'search' | 'profile' | 'detail';

export function ContentGrammar({
  item,
  density = 'feed',
  sources,
  onPress,
  onPressAuthor,
}: {
  item: ContentItem;
  density?: ContentDensity;
  /** Detail surfaces pass the fetched sources so the full line can render. */
  sources?: Pick<ContentSource, 'citation' | 'pageRef'>[];
  onPress?: () => void;
  onPressAuthor?: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useI18n();

  const classification = [
    item.knowledgeType ? t(`knowledge.type.${item.knowledgeType}` as TranslationKey) : null,
    item.academic.topics[0]
      ? locale === 'ar'
        ? item.academic.topics[0].nameAr
        : item.academic.topics[0].nameEn
      : item.academic.courseName,
  ];

  const authorParts = [
    item.author.displayName,
    item.author.verificationLevel === 'instructor' ? t('profile.instructor') : null,
    formatRelative(item.createdAt, locale),
  ];

  const challenged = item.signals.provenance === 'disputed';
  const corrected = item.signals.provenance === 'corrected';

  const body = (
    <View style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.lg }}>
      {/* 1 — classification frames the claim, so it is read first. */}
      <MetadataLine parts={classification} tone="structure" />

      {/* 2 — the knowledge body, in the editorial voice: Newsreader for
          Latin, Plex Arabic 600 for Arabic. This is the voice that makes a
          feed of claims read as an academic page rather than a timeline. */}
      {item.body ? (
        <Text
          variant={density === 'detail' ? 'body' : 'heading'}
          bidi="auto"
          numberOfLines={density === 'feed' ? 5 : density === 'search' ? 3 : undefined}
        >
          {item.body}
        </Text>
      ) : null}

      {/* 3 — provenance, or nothing at all. */}
      <ProvenanceLine
        sourceCount={item.signals.sourceCount}
        sources={sources ?? []}
        density={density === 'detail' ? 'full' : 'inline'}
      />

      {/* 4 — the author line: 24px avatar, name, verification glyph, role,
          time. The glyph accompanies the worded role — it never replaces
          it, so the state survives greyscale and a screen reader alike. */}
      {onPressAuthor ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.author.displayName}
          onPress={onPressAuthor}
          hitSlop={6}
        >
          <AuthorLine item={item} parts={authorParts} />
        </Pressable>
      ) : (
        <AuthorLine item={item} parts={authorParts} />
      )}

      {/* 5 — status, spoken as words, never colour alone. */}
      {challenged ? (
        <View
          style={{
            borderStartWidth: 2,
            borderStartColor: theme.colors.challenged,
            paddingStart: 11,
          }}
        >
          <Text variant="metadata" tone="challenged" style={{ fontWeight: '600' }}>
            {t('knowledge.underChallenge', { count: item.signals.openCorrectionCount })}
          </Text>
        </View>
      ) : null}
      {corrected ? (
        <Text variant="metadata" tone="muted">
          {t('knowledge.provenance.corrected')}
        </Text>
      ) : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
    >
      {body}
    </Pressable>
  );
}

function AuthorLine({
  item,
  parts,
}: {
  item: ContentItem;
  parts: (string | null)[];
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
      <Avatar name={item.author.displayName} size={24} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
        <MetadataLine parts={[parts[0] ?? null]} bidi="auto" />
        {item.author.verificationLevel === 'instructor' ? (
          <Ionicons name="shield-checkmark" size={13} color={theme.colors.structure} />
        ) : null}
        <MetadataLine parts={parts.slice(1)} bidi="auto" />
      </View>
    </View>
  );
}
