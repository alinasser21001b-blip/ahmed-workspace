import { useSyncExternalStore } from 'react';

/**
 * Content invalidation signal.
 *
 * When a student publishes or deletes a post, every mounted feed has to know.
 * The obvious approach — refetch when the screen regains focus — depends on
 * navigator focus semantics that differ between native and web, and it failed
 * silently on web: the post existed on the server and simply never appeared in
 * the list.
 *
 * An explicit counter is deterministic. Publishing bumps it; every feed
 * subscribed to it reloads. No navigator involved, and the behaviour is the
 * same on every platform.
 *
 * This is not a general-purpose store. When the product grows a real cache
 * layer this becomes its invalidation key rather than a second mechanism.
 */

let version = 0;
const listeners = new Set<() => void>();

export function bumpContentVersion(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useContentVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    // Server snapshot: static rendering has no mutations to invalidate.
    () => 0,
  );
}
