import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import { motion } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

/**
 * The motion layer.
 *
 * Small on purpose. Its whole job is to stop every screen inventing its own
 * timings: the durations come from `05-TOKENS.md`, which freezes exactly
 * three, and nothing here adds a fourth.
 *
 *   instant  120 ms   interaction feedback, selection
 *   settle   180 ms   state reveal, exits
 *   enter    220 ms   local transitions and modal presentation
 *
 * The character was approved from the five prototypes and is unchanged here:
 * calm, precise, causal. Motion explains an interaction; it never decorates
 * one. So the rules are narrow —
 *
 *   - opacity and transform only, so everything stays on the compositor and
 *     nothing triggers layout while it runs;
 *   - entrances decelerate, exits accelerate and are shorter;
 *   - stagger is 60 ms, between the 50–70 the owner approved;
 *   - no spring, no overshoot, no scale, no loop, no colour tween, no
 *     count-up, nothing continuous;
 *   - reduced motion drops every duration to 0, which removes the transition
 *     and keeps the state change.
 *
 * Direction is logical rather than physical: `translateLead` moves toward the
 * start of the reading direction, so Arabic mirrors without a single screen
 * knowing it did.
 */

/** Stagger between members of a revealed group. */
export const STAGGER = 60;

/**
 * Whether this device wants motion removed.
 *
 * Read from the platform, and re-read when it changes — a student who turns
 * the setting on mid-session should not have to restart the app to be
 * believed.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);

    /*
     * React Native Web does not always route `isReduceMotionEnabled` to the
     * media query, so it is read directly as well and watched for changes.
     * This is the one setting where a false negative is a real accessibility
     * failure rather than a cosmetic one.
     */
    let media: MediaQueryList | undefined;
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia) {
      media = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (media.matches) setReduced(true);
      media.addEventListener?.('change', onChange);
    }

    return () => {
      alive = false;
      subscription?.remove?.();
      media?.removeEventListener?.('change', onChange);
    };
  }, []);

  return reduced;
}

type Direction = 'enter' | 'exit';

/**
 * One timing, built from a frozen token.
 *
 * `useNativeDriver` is not negotiable here: every property this module
 * animates is opacity or transform, which is exactly what the native driver
 * accepts, and it is what keeps a transition off the JS thread while a list
 * is still settling.
 */
export function timing(
  value: Animated.Value,
  toValue: number,
  {
    duration,
    delay = 0,
    direction = 'enter',
    reduced = false,
  }: { duration: number; delay?: number; direction?: Direction; reduced?: boolean },
): Animated.CompositeAnimation {
  return Animated.timing(value, {
    toValue,
    duration: reduced ? 0 : duration,
    delay: reduced ? 0 : delay,
    // Entrances decelerate — fast start, gentle landing. Exits accelerate —
    // gentle start, fast departure. Neither overshoots.
    easing: direction === 'exit' ? Easing.in(Easing.quad) : Easing.out(Easing.quad),
    useNativeDriver: true,
  });
}

/**
 * The durations, already collapsed for reduced motion.
 *
 * Screens ask for `d.enter` rather than `220`, so a screen cannot drift from
 * the vocabulary and cannot forget the accessibility setting.
 */
export function useMotion(): {
  reduced: boolean;
  instant: number;
  settle: number;
  enter: number;
  stagger: number;
  /** Translate toward the start of the reading direction. Mirrors in Arabic. */
  lead: (distance: number) => number;
} {
  const reduced = useReducedMotion();
  const theme = useTheme();

  return useMemo(
    () => ({
      reduced,
      instant: reduced ? 0 : motion.instant,
      settle: reduced ? 0 : motion.settle,
      enter: reduced ? 0 : motion.enter,
      stagger: reduced ? 0 : STAGGER,
      lead: (distance: number) => (theme.isRTL ? distance : -distance),
    }),
    [reduced, theme.isRTL],
  );
}

/**
 * Content arriving: fade, with an optional short rise.
 *
 * Used for a section settling after its data loads, and for the members of a
 * revealed group. The rise is deliberately small — 6–8 px reads as "this
 * arrived", where 24 px reads as "this flew in".
 */
export function Enter({
  children,
  delay = 0,
  rise = 6,
  style,
  /** Re-runs the entrance when this changes — e.g. new data for a section. */
  trigger,
}: {
  children: React.ReactNode;
  delay?: number;
  rise?: number;
  style?: ViewStyle;
  trigger?: unknown;
}): React.JSX.Element {
  const { reduced, settle } = useMotion();
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    value.setValue(0);
    const animation = timing(value, 1, { duration: settle, delay, reduced });
    animation.start();
    return () => animation.stop();
  }, [value, settle, delay, reduced, trigger]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: value,
          transform: [
            { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Press feedback: 120 ms, opacity only.
 *
 * `10-COMPONENT-STATES.md` is explicit — no scale, no ripple beyond the
 * platform default, no colour animation. The pressed state exists to confirm
 * the tap landed, and nothing more. This is a thin wrapper so that intent is
 * expressed once rather than re-derived per screen.
 */
export function PressFade({
  children,
  style,
  pressedOpacity = 0.62,
  ...rest
}: PressableProps & {
  children: React.ReactNode;
  style?: ViewStyle;
  pressedOpacity?: number;
}): React.JSX.Element {
  const { reduced } = useMotion();
  return (
    <Pressable
      {...rest}
      style={({ pressed }) => [style, { opacity: pressed && !reduced ? pressedOpacity : 1 }]}
    >
      {children}
    </Pressable>
  );
}

/**
 * The approved modal language: 16 px lift and a fade in, over `enter`; out
 * over `settle`, accelerating. No scale — a modal that grows from a point
 * claims it came from that point, and these come from a menu item or a row.
 *
 * Returns the style for the surface and the style for the context beneath it,
 * so the two always move together.
 */
export function useModalTransition(open: boolean): {
  surface: { opacity: Animated.Value; transform: { translateY: Animated.AnimatedInterpolation<number> }[] };
  contextOpacity: Animated.AnimatedInterpolation<number>;
} {
  const { reduced, enter, settle } = useMotion();
  const value = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    const animation = open
      ? timing(value, 1, { duration: enter, reduced })
      : timing(value, 0, { duration: settle, direction: 'exit', reduced });
    animation.start();
    return () => animation.stop();
  }, [open, value, enter, settle, reduced]);

  return {
    surface: {
      opacity: value,
      transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
    },
    // The context dims rather than disappearing, so the way back stays visible.
    contextOpacity: value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }),
  };
}
