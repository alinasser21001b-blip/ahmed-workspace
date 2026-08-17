import { useEffect, useRef } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localizeDigits, useI18n } from '../../i18n/index';
import { useTheme } from '../../theme/ThemeProvider';
import { Enter, timing, useMotion } from '../../motion/index';
import { Hairline } from '../editorial';
import { EvidenceDelta, type EvidencePair } from '../evidence';
import { Text } from '../Text';

/**
 * Practice components (09-COMPONENTS.md §Practice, 13-PRACTICE.md).
 *
 * The mode: an ink header band painting into the top inset, a white reading
 * body, no tab bar. Full dark inversion was tested and rejected — the band
 * keeps the mode switch unmistakable while the explanation, the longest text
 * in the product, stays dark-on-light.
 */

// ---------------------------------------------------------------------------
// PracticeHeader — ink band, close control, segment bar, counter

export type SegmentState = 'unanswered' | 'current' | 'correct' | 'incorrect';

export function PracticeHeader({
  total,
  index,
  segments,
  onExit,
}: {
  total: number;
  index: number;
  segments: SegmentState[];
  onExit: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, locale } = useI18n();

  // Four states, no teal, distinguishable in greyscale.
  const segmentColor: Record<SegmentState, string> = {
    unanswered: '#3C3A34',
    current: '#8E8B82',
    correct: '#FCFBF9',
    incorrect: theme.colors.challenged,
  };

  return (
    <View
      style={{
        backgroundColor: theme.colors.text,
        paddingTop: insets.top + theme.spacing.sm,
        paddingBottom: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.lg,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('practice.exit')}
        onPress={onExit}
        hitSlop={10}
        style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
      >
        <Ionicons name="close" size={24} color={theme.colors.textInverse} />
      </Pressable>
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{ flex: 1, flexDirection: 'row', gap: 4 }}
      >
        {segments.map((state, position) => (
          <View
            key={position}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: segmentColor[state],
            }}
          />
        ))}
      </View>
      <Text variant="numeric" tone="inverse" accessibilityLabel={t('practice.progress', { current: index + 1, total })}>
        {t('practice.counter', {
          current: localizeDigits(locale, index + 1),
          total: localizeDigits(locale, total),
        })}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// AnswerOption

const LETTERS_EN = ['A', 'B', 'C', 'D', 'E', 'F'];
const LETTERS_AR = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

export function AnswerOption({
  index,
  label,
  kind,
  selected,
  revealed,
  isCorrect,
  wasChosen,
  onPress,
}: {
  index: number;
  label: string;
  kind: 'single' | 'multi' | 'boolean';
  selected: boolean;
  revealed: boolean;
  isCorrect: boolean;
  wasChosen: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const { instant, reduced } = useMotion();

  const letter = (locale === 'ar' ? LETTERS_AR : LETTERS_EN)[index] ?? String(index + 1);

  /*
   * The reveal grammar, exactly as specified — and correctness is never a
   * colour alone: the key carries a checkmark and the word "Correct"; a wrong
   * choice carries "You chose"; the rest dim.
   */
  /*
   * The frame's grammar: options are hairline-separated ROWS of the page,
   * not boxes floating on it. A choice is stated by filling the row and
   * ruling it top and bottom at 2 px in ink — the same weight the masthead
   * rule carries — plus a trailing check. Never colour alone.
   */
  let ruleColor = theme.colors.border;
  let ruleWidth = 1;
  let background: string = 'transparent';
  let dimmed = false;
  let emphasized = false;
  let stateWord: string | null = null;
  let stateTone: 'default' | 'challenged' = 'default';

  if (!revealed && selected) {
    ruleColor = theme.colors.text;
    ruleWidth = 2;
    background = theme.colors.surfaceSelected;
    emphasized = true;
  } else if (revealed) {
    if (isCorrect) {
      ruleColor = theme.colors.text;
      ruleWidth = 2;
      background = theme.colors.surfaceSelected;
      emphasized = true;
      stateWord = t('practice.correct');
    } else if (wasChosen) {
      ruleColor = theme.colors.challenged;
      ruleWidth = 2;
      stateWord = t('practice.youChose');
      stateTone = 'challenged';
    } else {
      dimmed = true;
    }
  }

  /*
   * The fill arrives over `instant` as the opacity of a paper layer rather
   * than as an animated colour: it reads the same, it stays on the
   * compositor, and no design token is tweened.
   *
   * The two 2 px rules are deliberately NOT animated. They are real borders,
   * and a border width is layout — fading them would mean either shifting the
   * row by a pixel mid-transition or drawing a second set of lines over the
   * first. At 120 ms the rule and the fill are not separable events, and the
   * approved static geometry is worth more than the difference.
   */
  const fill = useRef(new Animated.Value(emphasized ? 1 : 0)).current;
  useEffect(() => {
    const animation = timing(fill, emphasized ? 1 : 0, { duration: instant, reduced });
    animation.start();
    return () => animation.stop();
  }, [emphasized, fill, instant, reduced]);

  const a11ySuffix = revealed
    ? isCorrect
      ? `, ${t('practice.a11yCorrectAnswer')}`
      : wasChosen
        ? `, ${t('practice.a11yYourAnswerIncorrect')}`
        : ''
    : '';

  return (
    <Pressable
      accessibilityRole={kind === 'multi' ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled: revealed }}
      // RNW 0.21 does not derive aria-checked from accessibilityState, so a
      // screen reader heard "radio" and never which one was chosen.
      aria-checked={selected}
      accessibilityLabel={`${label}${a11ySuffix}`}
      disabled={revealed}
      onPress={onPress}
      style={({ pressed }) => ({
        borderTopColor: ruleColor,
        borderTopWidth: ruleWidth,
        borderBottomColor: ruleColor,
        borderBottomWidth: emphasized || (revealed && wasChosen && !isCorrect) ? ruleWidth : 0,
        // Negative margin keeps adjacent hairlines from doubling where an
        // emphasized row's bottom rule meets the next row's top rule.
        marginTop: -1,
        // The colour lives on the animated layer below; at rest the two are
        // indistinguishable, which is the point.
        backgroundColor: 'transparent',
        minHeight: 56,
        paddingHorizontal: theme.spacing.xs,
        paddingVertical: theme.spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.lg,
        opacity: pressed && !revealed ? 0.9 : 1,
      })}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: background === 'transparent' ? 'transparent' : background,
          opacity: fill,
        }}
      />
      {kind === 'multi' ? (
        <View
          accessible={false}
          style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            borderWidth: selected ? 0 : 1.5,
            borderColor: theme.colors.borderStrong,
            backgroundColor: selected ? theme.colors.text : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? (
            <Ionicons name="checkmark" size={16} color={theme.colors.textInverse} />
          ) : null}
        </View>
      ) : (
        <Text variant="numeric" tone={dimmed ? 'faint' : 'muted'} accessible={false}>
          {letter}
        </Text>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          variant="body"
          bidi="auto"
          tone={dimmed ? 'faint' : 'default'}
          style={{ fontWeight: selected || (revealed && isCorrect) ? '500' : '400' }}
        >
          {label}
        </Text>
        {stateWord ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
            {revealed && isCorrect ? (
              <Ionicons name="checkmark-circle" size={16} color={theme.colors.text} />
            ) : null}
            <Text variant="metadata" tone={stateTone} style={{ fontWeight: '600' }}>
              {stateWord}
            </Text>
          </View>
        ) : null}
      </View>
      {kind !== 'multi' && selected && !revealed ? (
        <Ionicons accessible={false} name="checkmark" size={20} color={theme.colors.text} />
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// ExplanationBlock — the longest text in the product

export function ExplanationBlock({ children }: { children: string }): React.JSX.Element {
  return (
    <Text variant="body" tone="secondary" bidi="auto" style={{ fontSize: 15.5, lineHeight: 27 }}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// FeedbackPanel

export function FeedbackPanel({
  isCorrect,
  explanation,
  progressBefore,
  progressAfter,
  lowConfidence,
  alreadyAnswered,
  hasTopic,
}: {
  isCorrect: boolean;
  explanation: string | null;
  progressBefore: EvidencePair | null;
  progressAfter: EvidencePair | null;
  lowConfidence: boolean;
  alreadyAnswered: boolean;
  hasTopic: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useI18n();
  const { stagger } = useMotion();

  /*
   * The order is the causality: was I right → why → what changed. Each beat
   * is `settle`, 60 ms apart, which is enough to read as consequence and not
   * enough to read as a performance.
   *
   * The evidence fraction fades in with its line. It never counts up —
   * `05-TOKENS.md` rejects the evidence tween by name, because animating the
   * number dramatises a figure the product states quietly on purpose.
   */
  return (
    <View style={{ gap: theme.spacing.md }}>
      {/* Verdict + why-label. Incorrect is "Why", never "Wrong". */}
      <Enter rise={4}>
        <Text
          variant="bodyStrong"
          tone={isCorrect ? 'default' : 'challenged'}
          accessibilityLiveRegion="polite"
        >
          {isCorrect ? t('practice.correct') : t('practice.incorrect')}
        </Text>
      </Enter>

      {explanation ? (
        <Enter rise={4} delay={stagger} style={{ gap: theme.spacing.xs }}>
          <Text
            variant="metadata"
            tone={isCorrect ? 'default' : 'challenged'}
            style={{ fontWeight: '600' }}
          >
            {isCorrect ? t('practice.whyRight') : t('practice.why')}
          </Text>
          <ExplanationBlock>{explanation}</ExplanationBlock>
        </Enter>
      ) : null}

      <Hairline />

      {/* The evidence delta — or its honest absences. */}
      <Enter rise={4} delay={stagger * 2}>
      {alreadyAnswered ? (
        // A stored result moved no counter; showing a delta would be a lie.
        <Text variant="metadata" tone="muted">
          {t('practice.alreadyAnswered')}
        </Text>
      ) : !hasTopic || !progressBefore || !progressAfter ? (
        <Text variant="metadata" tone="muted">
          {t('practice.noTopicAttached')}
        </Text>
      ) : (
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="metadata" style={{ fontWeight: '600' }}>
            {t('practice.whatChanged')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}>
            <EvidenceDelta before={progressBefore} after={progressAfter} />
            <Text variant="metadata" tone="muted">
              {t('practice.answeredOnTopic')}
            </Text>
          </View>
          {lowConfidence ? (
            <Text variant="metadata" tone="muted">
              {t('practice.stillSmallSample')}
            </Text>
          ) : null}
        </View>
      )}
      </Enter>
    </View>
  );
}
