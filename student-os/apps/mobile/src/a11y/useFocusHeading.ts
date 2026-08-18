import { useEffect, useRef } from 'react';
import type { View } from 'react-native';

/**
 * Focuses a node now, and again shortly after — because a node opened right
 * after another modal closes is not the last one to touch focus.
 *
 * react-native-web keeps a closing `Modal`'s content mounted, and its own
 * focus-trap's "restore focus to whatever opened it" cleanup still armed,
 * for the length of that modal's close animation — 250ms for the `fade`
 * animation used everywhere in this app — before the content actually
 * unmounts. A single `requestAnimationFrame` call wins the race to focus
 * something as it opens, but loses the later one when that cleanup fires
 * and steals focus back. Calling again after 300ms (250ms plus a margin)
 * lets this call win last, without coupling every caller to that number.
 */
export function focusSoon(ref: React.RefObject<View | null>): () => void {
  const frame = requestAnimationFrame(() => ref.current?.focus());
  const settle = setTimeout(() => ref.current?.focus(), 300);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(settle);
  };
}

/**
 * Moves keyboard/AT focus to a screen's own heading once it has one to move
 * to.
 *
 * Expo Router's client-side navigation only replaces DOM content — it does
 * not touch focus. Whatever was focused before a navigation (a feed card, a
 * "New post" button) stays focused if it still exists, or falls back to
 * `<body>` if it does not, either way leaving a keyboard or screen-reader
 * user with no cue that anything happened: the next Tab press starts
 * scanning from the top of a screen they have no orientation on. Attach the
 * returned ref to the screen's heading (with `tabIndex={-1}`, so it is
 * programmatically focusable without joining the normal tab order) and this
 * moves focus there the moment `ready` becomes true.
 *
 * `ready` exists because a screen that loads data before it has a heading to
 * show (post detail, waiting on the fetch) would otherwise focus a node that
 * is not mounted yet. A screen whose heading is always present can pass
 * `true`.
 */
export function useFocusHeadingOnReady(ready: boolean): React.RefObject<View | null> {
  const ref = useRef<View>(null);

  useEffect(() => {
    if (!ready) return;
    return focusSoon(ref);
  }, [ready]);

  return ref;
}
