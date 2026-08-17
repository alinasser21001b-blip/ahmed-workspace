import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SecondaryAction, TopBar } from '../src/components/editorial';
import { Text } from '../src/components/Text';
import { useI18n } from '../src/i18n/index';
import { IS_PREVIEW_MODE } from '../src/preview/preview-mode';
import { motion } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeProvider';

/**
 * Motion samples — five prototypes, deliberately not a motion system.
 *
 * This route exists so the motion language can be judged before any of it
 * reaches a real screen. Nothing here is imported by the product: every
 * animated piece is local to this file, and the five demos are miniatures
 * that restate the approved composition rather than the screens themselves.
 * When a sample is approved, the *approved* version gets written into the
 * real screen — this file is not the place it graduates from.
 *
 * The durations are not invented here. `05-TOKENS.md` freezes exactly three,
 * and every sample below is built from them:
 *
 *   instant  120 ms   control press feedback
 *   enter    220 ms   modal and full-screen presentation
 *   settle   180 ms   feedback panel reveal after submission
 *
 * Easing is the platform default. There is no spring, no bounce, no scale
 * beyond 1, no colour tween, no looping, and nothing decorative — all of which
 * the handoff forbids by name. Where a sample needs what reads as a fill
 * transition, it animates the *opacity of a fill layer* rather than a colour
 * value: the result is the same to the eye, it stays on the compositor, and it
 * does not animate a token.
 *
 * Reduced motion collapses every duration to 0 ms, which is what the handoff
 * asks for. The page also carries a review-only override so the owner can see
 * both behaviours without changing an OS setting.
 */

/** Preview-only, like every other prototype surface in this build. */
const PANEL_HEIGHT = 300;

type Sample = {
  id: string;
  title: string;
  interaction: string;
  note: string;
};

const SAMPLES: Sample[] = [
  {
    id: 'learn-topic',
    title: '1 · Learn → Topic',
    interaction: 'Tap a topic row. It continues into the Topic screen rather than sliding over it.',
    note: 'enter 220 ms · the tapped row is the only thing that moves; the rest of the list fades out under it.',
  },
  {
    id: 'answer-select',
    title: '2 · Practice answer selection',
    interaction: 'Tap an option. Unselected → selected: fill, rules, and the check.',
    note: 'instant 120 ms · fill is an opacity layer, not a colour tween. Final state is the approved static one.',
  },
  {
    id: 'verdict',
    title: '3 · Correct / incorrect feedback',
    interaction: 'Submit the answer. Verdict, then explanation, then the evidence line.',
    note: 'settle 180 ms, staggered 60 ms · causality only. No celebration, and the evidence numbers never tween.',
  },
  {
    id: 'report-modal',
    title: '4 · Report modal',
    interaction: 'Open the report, then dismiss it. Context → focused task → context.',
    note: 'enter 220 ms decelerating, dismiss settle 180 ms accelerating · 16 px lift, dimmed context. No scale, no spring.',
  },
  {
    id: 'send',
    title: '5 · Message send',
    interaction: 'Send the message. The draft becomes a sent bubble.',
    note: 'instant 120 ms then settle 180 ms · confirms the tap. Nothing here simulates delivery.',
  },
];

export default function MotionSamples(): React.JSX.Element {
  const theme = useTheme();
  const { t } = useI18n();

  /** The OS setting, read once. */
  const [systemReduced, setSystemReduced] = useState(false);
  /** Review override, so both behaviours can be seen without leaving the page. */
  const [forceReduced, setForceReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setSystemReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) =>
      setSystemReduced(value),
    );
    /*
     * React Native Web maps `isReduceMotionEnabled` to the media query, but not
     * on every version — so the query is read directly as well. Belt and
     * braces on the one setting that must not be missed.
     */
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia) {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (query.matches) setSystemReduced(true);
    }
    return () => {
      alive = false;
      subscription?.remove?.();
    };
  }, []);

  const reduced = systemReduced || forceReduced;

  if (!IS_PREVIEW_MODE) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View style={{ padding: theme.spacing.xl, gap: theme.spacing.lg }}>
          <TopBar title="Motion samples" />
          <Text variant="body" tone="secondary">
            The motion prototypes are part of the preview build and are not available here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl,
          gap: theme.spacing.xl,
        }}
      >
        <View style={{ gap: theme.spacing.sm }}>
          <TopBar title="Motion samples" />
          <Text variant="body" tone="secondary">
            Five prototypes, for judging the motion language before any of it reaches a real
            screen. Each is a miniature — the approved screens are untouched.
          </Text>
          <Text variant="metadata" tone="muted">
            Durations come from the frozen tokens: instant {motion.instant} ms · enter{' '}
            {motion.enter} ms · settle {motion.settle} ms. Platform easing. No spring, no
            bounce, no scale, no loop.
          </Text>
        </View>

        {/* Reduced motion: the state, and a review-only override. */}
        <View
          style={{
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.sm,
            padding: theme.spacing.md,
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Ionicons
              name={reduced ? 'pause-circle-outline' : 'play-circle-outline'}
              size={20}
              color={theme.colors.text}
            />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              Reduced motion is {reduced ? 'ON' : 'OFF'}
            </Text>
          </View>
          <Text variant="metadata" tone="muted">
            {systemReduced
              ? 'Your system asks for reduced motion, so every duration below is 0 ms.'
              : 'Your system does not ask for reduced motion.'}{' '}
            With it on, each sample cuts straight to its end state — nothing is skipped, only the
            transition is.
          </Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: forceReduced }}
            accessibilityLabel="Simulate reduced motion"
            onPress={() => setForceReduced((value) => !value)}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              alignSelf: 'flex-start',
              paddingVertical: theme.spacing.xs,
            }}
          >
            <Text variant="metadata" tone="structure" style={{ fontWeight: '600' }}>
              {forceReduced ? 'Stop simulating reduced motion' : 'Simulate reduced motion'}
            </Text>
          </Pressable>
        </View>

        <SampleFrame sample={SAMPLES[0]!} reduced={reduced}>
          {(replayKey) => <LearnToTopic key={replayKey} reduced={reduced} />}
        </SampleFrame>

        <SampleFrame sample={SAMPLES[1]!} reduced={reduced}>
          {(replayKey) => <AnswerSelection key={replayKey} reduced={reduced} />}
        </SampleFrame>

        <SampleFrame sample={SAMPLES[2]!} reduced={reduced}>
          {(replayKey) => <VerdictReveal key={replayKey} reduced={reduced} />}
        </SampleFrame>

        <SampleFrame sample={SAMPLES[3]!} reduced={reduced}>
          {(replayKey) => <ReportModal key={replayKey} reduced={reduced} />}
        </SampleFrame>

        <SampleFrame sample={SAMPLES[4]!} reduced={reduced}>
          {(replayKey) => <MessageSend key={replayKey} reduced={reduced} />}
        </SampleFrame>

        <Text variant="metadata" tone="muted">
          {t('preview.feedback.noPersonalData')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The chrome around one sample: title, what the interaction is, the stage, and
 * a replay that remounts it. Remounting is the honest reset — it puts the demo
 * back at its true initial state rather than reversing an animation.
 */
function SampleFrame({
  sample,
  reduced,
  children,
}: {
  sample: Sample;
  reduced: boolean;
  children: (replayKey: number) => React.ReactNode;
}): React.JSX.Element {
  const theme = useTheme();
  const [replayKey, setReplayKey] = useState(0);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Text variant="bodyStrong">{sample.title}</Text>
      <Text variant="body" tone="secondary">
        {sample.interaction}
      </Text>
      <Text variant="metadata" tone="muted">
        {reduced ? 'Reduced motion — 0 ms. ' : ''}
        {sample.note}
      </Text>

      <View
        // A fixed stage, so no sample can push the page around as it runs.
        // Layout thrashing is the one performance failure the handoff would
        // notice, and reserving the space removes the possibility.
        style={{
          height: PANEL_HEIGHT,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surface,
          overflow: 'hidden',
        }}
      >
        {children(replayKey)}
      </View>

      <SecondaryAction label="Replay" onPress={() => setReplayKey((key) => key + 1)} />
    </View>
  );
}

/** Every sample times from the frozen tokens, or from nothing at all. */
function useDuration(reduced: boolean): (token: keyof typeof motion) => number {
  return useCallback((token) => (reduced ? 0 : motion[token]), [reduced]);
}

const timing = (
  value: Animated.Value,
  toValue: number,
  duration: number,
  delay = 0,
  direction: 'enter' | 'exit' = 'enter',
): Animated.CompositeAnimation =>
  Animated.timing(value, {
    toValue,
    duration,
    delay,
    /*
     * Platform default, split by direction the way every platform splits it:
     * entrances decelerate (fast start, gentle landing) and exits accelerate
     * (gentle start, fast departure). The installed motion skills state the
     * same rule — entrance = ease-out family, exit = ease-in family, exits at
     * ~65–75% of the entrance duration — and the dismissals below follow it
     * using the frozen tokens (`settle` 180 ms against `enter` 220 ms ≈ 82%,
     * the nearest the three frozen durations allow). No overshoot either way.
     */
    easing: direction === 'exit' ? Easing.in(Easing.quad) : Easing.out(Easing.quad),
    useNativeDriver: true,
  });

// ---------------------------------------------------------------------------
// 1 · Learn → Topic

/**
 * Spatial continuity, not a page transition.
 *
 * The row the student tapped is the one thing that survives the change: it
 * travels to where the Topic title sits, and everything else fades out beneath
 * it. Nothing slides in from the edge, because the student did not move
 * sideways — they went *into* the thing they touched.
 */
function LearnToTopic({ reduced }: { reduced: boolean }): React.JSX.Element {
  const theme = useTheme();
  const duration = useDuration(reduced);
  const [opened, setOpened] = useState(false);

  const progress = useRef(new Animated.Value(0)).current;

  const open = (): void => {
    setOpened(true);
    timing(progress, 1, duration('enter')).start();
  };

  const ROWS = ['Acid–base balance', 'Renal physiology', 'Cardiac cycle'];

  return (
    <View style={{ flex: 1, padding: theme.spacing.lg }}>
      {/* The list, minus the tapped row. */}
      <Animated.View
        pointerEvents={opened ? 'none' : 'auto'}
        style={{ opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}
      >
        <Text variant="metadata" tone="structure" style={{ fontWeight: '600' }}>
          Recent answers suggest difficulty
        </Text>
      </Animated.View>

      {/* The tapped row: it moves, and it is the only thing that does. */}
      <Animated.View
        style={{
          marginTop: theme.spacing.sm,
          transform: [
            {
              translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -26] }),
            },
          ],
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Acid–base balance"
          onPress={open}
          disabled={opened}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Animated.View
            style={{
              transform: [
                { scale: 1 }, // never animated — stated so it cannot drift
              ],
            }}
          >
            <Text variant="heading" style={{ fontSize: 20, lineHeight: 28 }}>
              {ROWS[0]}
            </Text>
          </Animated.View>
          <Animated.View
            style={{ opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}
          >
            <Text variant="metadata" tone="muted">
              Physiology · 6 answered
            </Text>
          </Animated.View>
        </Pressable>
      </Animated.View>

      {/* The rest of the list. */}
      <Animated.View
        pointerEvents="none"
        style={{
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          marginTop: theme.spacing.sm,
        }}
      >
        {ROWS.slice(1).map((row) => (
          <View key={row} style={{ paddingVertical: theme.spacing.sm }}>
            <Text variant="body">{row}</Text>
          </View>
        ))}
      </Animated.View>

      {/* What the row continued into. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: theme.spacing.lg,
          right: theme.spacing.lg,
          top: 96,
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        }}
      >
        <View style={{ height: 2, backgroundColor: theme.colors.text, marginBottom: 12 }} />
        <Text variant="body" tone="secondary">
          The chemistry of pH regulation, the buffer systems, and how the lungs and kidneys
          compensate.
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, alignItems: 'center' }}>
          <View style={{ width: 2, height: 16, backgroundColor: theme.colors.provenance }} />
          <Text variant="metadata" tone="provenance">
            Cites 2 sources
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 2 · Practice answer selection

/**
 * unselected → selected, in 120 ms.
 *
 * Three things move together, because in the approved design three things
 * differ: the fill, the two rules, and the check. The fill is the opacity of a
 * paper layer rather than an animated colour — the eye reads a fill either
 * way, and this keeps the work on the compositor and the token untouched.
 */
function AnswerSelection({ reduced }: { reduced: boolean }): React.JSX.Element {
  const theme = useTheme();
  const duration = useDuration(reduced);
  const [selected, setSelected] = useState<number | null>(null);

  const OPTIONS = ['Metabolic acidosis with respiratory compensation', 'Respiratory acidosis'];

  return (
    <View style={{ flex: 1, padding: theme.spacing.lg, justifyContent: 'center' }}>
      {OPTIONS.map((label, index) => (
        <Option
          key={label}
          letter={String.fromCharCode(65 + index)}
          label={label}
          selected={selected === index}
          duration={duration('instant')}
          onPress={() => setSelected(index)}
        />
      ))}
      <Text variant="metadata" tone="muted" style={{ marginTop: theme.spacing.md }}>
        {selected === null ? 'Nothing selected.' : 'Selected — the static design, arrived at.'}
      </Text>
    </View>
  );
}

function Option({
  letter,
  label,
  selected,
  duration,
  onPress,
}: {
  letter: string;
  label: string;
  selected: boolean;
  duration: number;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    timing(value, selected ? 1 : 0, duration).start();
  }, [selected, duration, value]);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{ minHeight: 56, justifyContent: 'center' }}
    >
      {/* The fill, as an opacity layer over the surface. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: -theme.spacing.md,
          right: -theme.spacing.md,
          top: 0,
          bottom: 0,
          backgroundColor: theme.colors.surfaceSelected,
          opacity: value,
        }}
      />
      {/* The two rules the approved design draws on a selected option. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: -theme.spacing.md,
          right: -theme.spacing.md,
          top: 0,
          height: 2,
          backgroundColor: theme.colors.text,
          opacity: value,
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: -theme.spacing.md,
          right: -theme.spacing.md,
          bottom: 0,
          height: 2,
          backgroundColor: theme.colors.text,
          opacity: value,
        }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Text variant="metadata" tone="muted">
          {letter}
        </Text>
        <Text variant="body" style={{ flex: 1 }}>
          {label}
        </Text>
        {/* The check fades in place. It does not pop, scale or rotate. */}
        <Animated.View style={{ opacity: value }}>
          <Ionicons name="checkmark" size={18} color={theme.colors.text} />
        </Animated.View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 3 · Correct / incorrect feedback

/**
 * question → feedback, as a sequence rather than a reveal.
 *
 * The order carries the causality: the verdict answers "was I right", the
 * explanation answers "why", and the evidence line answers "what changed".
 * A 60 ms stagger is enough to read as consequence; more would read as a
 * performance. The evidence fraction appears — it never counts up.
 */
function VerdictReveal({ reduced }: { reduced: boolean }): React.JSX.Element {
  const theme = useTheme();
  const duration = useDuration(reduced);
  const [submitted, setSubmitted] = useState(false);

  const verdict = useRef(new Animated.Value(0)).current;
  const explanation = useRef(new Animated.Value(0)).current;
  const evidence = useRef(new Animated.Value(0)).current;

  const submit = (): void => {
    setSubmitted(true);
    const stagger = reduced ? 0 : 60;
    Animated.parallel([
      timing(verdict, 1, duration('settle')),
      timing(explanation, 1, duration('settle'), stagger),
      timing(evidence, 1, duration('settle'), stagger * 2),
    ]).start();
  };

  const rise = (value: Animated.Value): Animated.AnimatedInterpolation<number> =>
    value.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });

  return (
    <View style={{ flex: 1, padding: theme.spacing.lg, gap: theme.spacing.md }}>
      <Text variant="body" tone="secondary">
        A patient presents with pH 7.1, PaCO₂ 30 mmHg and HCO₃⁻ 12 mmol/L.
      </Text>

      {!submitted ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Check answer"
          onPress={submit}
          style={{
            backgroundColor: theme.colors.text,
            borderRadius: theme.radius.sm,
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="bodyStrong" tone="inverse">
            Check answer
          </Text>
        </Pressable>
      ) : null}

      <Animated.View style={{ opacity: verdict, transform: [{ translateY: rise(verdict) }] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="checkmark-circle-outline" size={18} color={theme.colors.text} />
          <Text variant="bodyStrong">Correct</Text>
        </View>
      </Animated.View>

      <Animated.View
        style={{ opacity: explanation, transform: [{ translateY: rise(explanation) }] }}
      >
        <Text variant="body" tone="secondary">
          A low pH with a low bicarbonate is a metabolic acidosis; the low PaCO₂ is the
          respiratory compensation.
        </Text>
      </Animated.View>

      <Animated.View style={{ opacity: evidence, transform: [{ translateY: rise(evidence) }] }}>
        <Text variant="metadata" tone="muted">
          Evidence for this topic: <Text variant="numeric">5 of 7</Text>
        </Text>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 4 · Report modal

/**
 * context → focused task → context.
 *
 * The modal lifts 16 px and fades in over the same 220 ms a presentation gets,
 * and the context dims rather than disappearing — so the student can see they
 * are on top of something, and that dismissing returns them to it. There is no
 * scale: a modal that grows from a point implies it came *from* that point,
 * and this one came from a menu item.
 */
function ReportModal({ reduced }: { reduced: boolean }): React.JSX.Element {
  const theme = useTheme();
  const duration = useDuration(reduced);
  const [open, setOpen] = useState(false);
  const value = useRef(new Animated.Value(0)).current;

  const toggle = (next: boolean): void => {
    setOpen(next);
    // Enter at 220 ms decelerating; leave at 180 ms accelerating. The return
    // to context is quicker than the arrival because the student has finished
    // — the skills' exit rule, expressed in the frozen tokens.
    if (next) timing(value, 1, duration('enter')).start();
    else timing(value, 0, duration('settle'), 0, 'exit').start();
  };

  return (
    <View style={{ flex: 1 }}>
      {/* The context underneath. */}
      <Animated.View
        style={{
          flex: 1,
          padding: theme.spacing.lg,
          gap: theme.spacing.sm,
          opacity: value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }),
        }}
      >
        <Text variant="bodyStrong">Layla Hassan</Text>
        <Text variant="metadata" tone="muted">
          @layla.hassan · Second year
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Report @layla.hassan"
          onPress={() => toggle(true)}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text variant="body" tone="structure">
            Report @layla.hassan
          </Text>
        </Pressable>
      </Animated.View>

      {/* The focused task. */}
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: theme.colors.surface,
          padding: theme.spacing.lg,
          gap: theme.spacing.md,
          opacity: value,
          transform: [
            { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
          ],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}>
          <Text variant="title" style={{ flex: 1 }}>
            Report content
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={() => toggle(false)}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={22} color={theme.colors.text} />
          </Pressable>
        </View>
        <Text variant="body" tone="secondary">
          A moderator from your college reviews this. You will not be told who.
        </Text>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 5 · Message send

/**
 * compose → sent.
 *
 * The draft leaves the field and the bubble takes its place, then the state
 * word settles under it. That second beat is the whole point: the student's
 * word for "it worked" is the state, not the bubble. Nothing after `sent` is
 * animated, because nothing after `sent` has happened — delivery and read are
 * facts from a server this build does not have.
 */
function MessageSend({ reduced }: { reduced: boolean }): React.JSX.Element {
  const theme = useTheme();
  const duration = useDuration(reduced);
  const [sent, setSent] = useState(false);

  const bubble = useRef(new Animated.Value(0)).current;
  const state = useRef(new Animated.Value(0)).current;
  const draft = useRef(new Animated.Value(1)).current;

  const send = (): void => {
    setSent(true);
    Animated.parallel([
      timing(draft, 0, duration('instant'), 0, 'exit'),
      timing(bubble, 1, duration('instant')),
      timing(state, 1, duration('settle'), reduced ? 0 : motion.instant),
    ]).start();
  };

  return (
    <View style={{ flex: 1, padding: theme.spacing.lg, justifyContent: 'flex-end', gap: theme.spacing.md }}>
      <Animated.View
        style={{
          alignSelf: 'flex-end',
          maxWidth: '85%',
          opacity: bubble,
          transform: [
            { translateY: bubble.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        }}
      >
        <View
          style={{
            backgroundColor: theme.colors.text,
            borderRadius: 12,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
          }}
        >
          <Text variant="body" tone="inverse">
            Reviewed the blood-gas table — the compensation rules make sense now.
          </Text>
        </View>
        <Animated.View style={{ opacity: state, alignSelf: 'flex-end' }}>
          <Text variant="metadata" tone="muted">
            Sent
          </Text>
        </Animated.View>
      </Animated.View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          paddingTop: theme.spacing.md,
        }}
      >
        <Animated.View style={{ flex: 1, opacity: draft }}>
          <Text variant="body" tone="secondary" numberOfLines={1}>
            Reviewed the blood-gas table — the compensation…
          </Text>
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={send}
          disabled={sent}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: sent ? theme.colors.surface : theme.colors.text,
          }}
        >
          <Ionicons
            name="send"
            size={17}
            color={sent ? theme.colors.textMuted : theme.colors.textInverse}
          />
        </Pressable>
      </View>
    </View>
  );
}
