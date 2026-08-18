import type { ContentItem, FeedPage } from '@sos/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useContentVersion } from './content-events';
import { useSession } from './session';

/**
 * Feed state.
 *
 * Reactions and bookmarks apply optimistically: a like that waits for a round
 * trip feels broken on a phone. The rollback on failure is the part that makes
 * that honest — an optimistic update with no rollback is just a lie that
 * survives until the next refresh (§51).
 */

export type FeedStatus = 'loading' | 'ready' | 'error' | 'refreshing' | 'loadingMore';

export interface FeedState {
  items: ContentItem[];
  status: FeedStatus;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  toggleReaction: (item: ContentItem) => Promise<void>;
  toggleBookmark: (item: ContentItem) => Promise<void>;
  /** Inserts a freshly-created post at the top without a full refetch. */
  prepend: (item: ContentItem) => void;
  /** Replaces one item, e.g. after returning from the detail screen. */
  replace: (item: ContentItem) => void;
}

export function useFeed(scope: 'home' | 'saved' = 'home'): FeedState {
  const { api } = useSession();
  const contentVersion = useContentVersion();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [hasMore, setHasMore] = useState(false);

  /*
   * Re-entrancy guard.
   *
   * `cursor`/`hasMore` are React state: they only update once the fetch that
   * reads them resolves. A fast scroll fires `onEndReached` more than once
   * before that happens, so two calls to `load('more')` both read the same
   * stale cursor, both fetch the same page, and both append it — the same
   * posts rendered twice, on the primary feed, from an ordinary scroll
   * gesture. A ref (not state) is checked and set synchronously before the
   * first `await`, so the second call inside the same tick sees it already
   * held and returns without fetching anything.
   */
  const loading = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'more') => {
      if (loading.current) return;
      loading.current = true;
      setStatus(mode === 'refresh' ? 'refreshing' : mode === 'more' ? 'loadingMore' : 'loading');
      try {
        const query = new URLSearchParams({ scope, limit: '20' });
        if (mode === 'more' && cursor) query.set('cursor', cursor);

        const page = await api.get<FeedPage>(`/v1/feed?${query.toString()}`);
        setItems((current) => (mode === 'more' ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
        setStatus('ready');
      } catch {
        // A failed "load more" must not blank the page the user is reading.
        setStatus(mode === 'more' ? 'ready' : 'error');
      } finally {
        loading.current = false;
      }
    },
    [api, cursor, scope],
  );

  /*
   * Reloads on mount, and again whenever content is published or removed
   * anywhere in the app. `contentVersion` is the explicit invalidation signal;
   * navigator focus alone was not reliable across platforms and let a
   * freshly-published post go missing from the list.
   *
   * `load` is deliberately not a dependency: its identity changes with the
   * cursor, so depending on it would refetch after every page.
   */
  useEffect(() => {
    void load('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, contentVersion]);

  /*
   * Refresh when the screen regains focus, so returning from the composer or a
   * post detail shows the current state rather than the list as it was before
   * the user acted. Skipped on first focus, which the initial load already
   * covers — otherwise every mount would fetch twice.
   */
  const hasFocusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true;
        return;
      }
      void load('refresh');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope]),
  );

  const patch = useCallback((id: string, change: (item: ContentItem) => ContentItem) => {
    setItems((current) => current.map((item) => (item.id === id ? change(item) : item)));
  }, []);

  const toggleReaction = useCallback(
    async (item: ContentItem) => {
      const wasLiked = item.viewer.reaction !== null;
      const before = item;

      patch(item.id, (current) => ({
        ...current,
        viewer: { ...current.viewer, reaction: wasLiked ? null : 'like' },
        counts: {
          ...current.counts,
          likes: Math.max(0, current.counts.likes + (wasLiked ? -1 : 1)),
        },
      }));

      try {
        const result = wasLiked
          ? await api.request<{ likeCount: number }>(`/v1/content/${item.id}/reaction`, {
              method: 'DELETE',
            })
          : await api.request<{ likeCount: number }>(`/v1/content/${item.id}/reaction`, {
              method: 'PUT',
              body: { kind: 'like' },
            });
        // Reconcile with the server's count rather than trusting the local
        // increment, which drifts if two devices react at once.
        patch(item.id, (current) => ({
          ...current,
          counts: { ...current.counts, likes: result.likeCount },
        }));
      } catch {
        patch(item.id, () => before);
      }
    },
    [api, patch],
  );

  const toggleBookmark = useCallback(
    async (item: ContentItem) => {
      const wasSaved = item.viewer.hasBookmarked;
      const before = item;

      patch(item.id, (current) => ({
        ...current,
        viewer: { ...current.viewer, hasBookmarked: !wasSaved },
      }));

      try {
        await api.request(`/v1/content/${item.id}/bookmark`, {
          method: wasSaved ? 'DELETE' : 'PUT',
          ...(wasSaved ? {} : { body: {} }),
        });
        if (wasSaved && scope === 'saved') {
          setItems((current) => current.filter((entry) => entry.id !== item.id));
        }
      } catch {
        patch(item.id, () => before);
      }
    },
    [api, patch, scope],
  );

  return {
    items,
    status,
    hasMore,
    refresh: () => load('refresh'),
    loadMore: () => (hasMore ? load('more') : Promise.resolve()),
    toggleReaction,
    toggleBookmark,
    prepend: (item) => setItems((current) => [item, ...current]),
    replace: (item) => patch(item.id, () => item),
  };
}
