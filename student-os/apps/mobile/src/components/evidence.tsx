import { View } from 'react-native';
import { localizeDigits, useI18n } from '../i18n/index';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/**
 * The evidence primitives (09-COMPONENTS.md): EvidenceFraction and
 * RelationshipPrimitive — the two components that carry the product's
 * epistemics. Everything they render is a statement about answered questions
 * or curated structure; nothing here may imply mastery, readiness, or a
 * recommendation, per the learning evidence contract in 13-PRACTICE.md.
 */

// ---------------------------------------------------------------------------
// EvidenceFraction

export interface EvidencePair {
  correct: number;
  answered: number;
}

/**
 * "5 of 12" — what was answered, without implying knowledge.
 *
 * Arabic uses the word form `٥ من ١٢`: the slash does not mirror safely under
 * RTL. The tick band restates the fraction visually and is hidden from the
 * screen reader for that reason.
 */
export function EvidenceFraction({
  correct,
  answered,
  showTicks = false,
}: EvidencePair & { showTicks?: boolean }): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useI18n();

  if (answered === 0) {
    // Never "0/0".
    return (
      <Text variant="metadata" tone="muted">
        {t('evidence.notAnswered')}
      </Text>
    );
  }

  const label = t('evidence.fraction', {
    correct: localizeDigits(locale, correct),
    answered: localizeDigits(locale, answered),
  });

  return (
    <View
      accessibilityLabel={t('evidence.fractionA11y', { correct, answered })}
      style={{ alignItems: 'flex-end', gap: theme.spacing.xxs }}
    >
      <Text variant="numeric">
        {label}
      </Text>
      {showTicks ? (
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', gap: 2 }}
        >
          {Array.from({ length: Math.min(answered, 12) }, (_, index) => (
            <View
              key={index}
              style={{
                width: 6,
                height: 6,
                borderRadius: 1,
                backgroundColor: index < correct ? theme.colors.text : theme.colors.border,
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The before → after delta: `4 of 7 → 4 of 8`.
 *
 * Before in textFaint, after in ink 600. The arrow means "progressed to" and
 * flips under RTL automatically because it is rendered in the line's reading
 * direction.
 */
export function EvidenceDelta({
  before,
  after,
}: {
  before: EvidencePair;
  after: EvidencePair;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const arrow = locale === 'ar' ? '←' : '→';
  return (
    <View
      accessibilityLabel={t('evidence.deltaA11y', {
        beforeCorrect: before.correct,
        beforeAnswered: before.answered,
        afterCorrect: after.correct,
        afterAnswered: after.answered,
      })}
      style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}
    >
      <Text variant="numeric" tone="faint">
        {t('evidence.fraction', {
          correct: localizeDigits(locale, before.correct),
          answered: localizeDigits(locale, before.answered),
        })}
      </Text>
      <Text variant="numeric" tone="muted" accessible={false}>
        {arrow}
      </Text>
      <Text variant="numeric" style={{ fontWeight: '600' }}>
        {t('evidence.fraction', {
          correct: localizeDigits(locale, after.correct),
          answered: localizeDigits(locale, after.answered),
        })}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// RelationshipPrimitive

export type RelationKind = 'part_of' | 'has_type' | 'co_occurs' | 'appears_in';

export interface RelationRow {
  kind: RelationKind;
  target: string;
  derived: boolean;
  onPress?: (() => void) | undefined;
}

const RELATION_KEY: Record<RelationKind, 'relation.partOf' | 'relation.types' | 'relation.seenWith' | 'relation.appearsIn'> = {
  part_of: 'relation.partOf',
  has_type: 'relation.types',
  co_occurs: 'relation.seenWith',
  appears_in: 'relation.appearsIn',
};

/**
 * Topic-to-topic structure, drawn rather than listed.
 *
 * Only the four supported relation kinds exist; prerequisite / recommended /
 * weakness-origin are forbidden because `topic_relations` does not support
 * them and implying one is a product claim. Curated rows draw a solid
 * connector with a structure-coloured label; derived rows draw a dashed one
 * and the section carries a single caption saying what dashed means.
 */
export function RelationshipPrimitive({
  relations,
}: {
  relations: RelationRow[];
}): React.JSX.Element | null {
  const theme = useTheme();
  const { t } = useI18n();
  if (relations.length === 0) return null;
  const hasDerived = relations.some((relation) => relation.derived);

  return (
    <View style={{ gap: theme.spacing.xs }}>
      {relations.map((relation, index) => {
        const label = t(RELATION_KEY[relation.kind]);
        return (
          <View
            key={`${relation.kind}-${relation.target}-${index}`}
            accessibilityLabel={`${label}: ${relation.target}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 44,
              gap: theme.spacing.md,
            }}
          >
            <Text
              variant="metadata"
              tone={relation.derived ? 'muted' : 'structure'}
              style={{ width: 104 }}
            >
              {label}
            </Text>
            <View
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={{
                flex: 1,
                height: 1,
                borderBottomWidth: 1,
                borderColor: relation.derived ? theme.colors.borderStrong : theme.colors.structure,
                borderStyle: relation.derived ? 'dashed' : 'solid',
              }}
            />
            <Text
              variant="body"
              bidi="auto"
              onPress={relation.onPress}
              style={relation.onPress ? { textDecorationLine: 'underline' } : undefined}
            >
              {relation.target}
            </Text>
          </View>
        );
      })}
      {hasDerived ? (
        <Text variant="caption" tone="faint">
          {t('relation.derivedNote')}
        </Text>
      ) : null}
    </View>
  );
}
