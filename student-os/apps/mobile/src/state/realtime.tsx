import type { Message, RealtimeClientFrame, RealtimeServerFrame } from '@sos/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { API_BASE_URL, useSession } from './session';
import { Outbox } from './outbox';
import { IS_PREVIEW_MODE } from '../preview/preview-mode';

/**
 * The realtime connection.
 *
 * Its job is latency, not correctness. Every message this socket delivers is
 * also reachable by an ordinary HTTP read, and the client proves that on every
 * reconnect by asking for the gap after its highest known `seq`. So a socket
 * that drops, flaps, or never connects at all degrades the product to "slower",
 * never to "wrong" — which is the only sane contract for a client that spends
 * its life on a campus wifi.
 *
 * Nothing is sent over the socket that changes server state. Sends are HTTP,
 * queued in the `Outbox`; the socket carries subscriptions, typing hints, and
 * the resync request.
 */

const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 30_000;
const TYPING_DEBOUNCE_MS = 1200;

export type ConnectionStatus = 'connecting' | 'open' | 'offline';

interface RealtimeValue {
  status: ConnectionStatus;
  outbox: Outbox;
  subscribe: (conversationId: string) => void;
  unsubscribe: (conversationId: string) => void;
  /** Ephemeral. Debounced, and it stops on its own. */
  setTyping: (conversationId: string, typing: boolean) => void;
  /** Ask the server for everything after `lastSeq`. Called on every reconnect. */
  resync: (conversationId: string, lastSeq: number) => void;
  onFrame: (handler: (frame: RealtimeServerFrame) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { status: sessionStatus, api, getAccessToken } = useSession();
  const [status, setStatus] = useState<ConnectionStatus>('offline');

  const socket = useRef<WebSocket | null>(null);
  const handlers = useRef(new Set<(frame: RealtimeServerFrame) => void>());
  /** Subscriptions survive a reconnect: they are re-sent when the socket opens. */
  const subscriptions = useRef(new Set<string>());
  /** Highest seq seen per conversation, so a reconnect knows what to ask for. */
  const highWater = useRef(new Map<string, number>());
  const attempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const disposed = useRef(false);

  const outbox = useMemo(() => new Outbox(api), [api]);

  const send = useCallback((frame: RealtimeClientFrame): void => {
    const current = socket.current;
    if (!current || current.readyState !== WebSocket.OPEN) return;
    current.send(JSON.stringify(frame));
  }, []);

  const connect = useCallback(() => {
    if (disposed.current) return;
    /*
     * A preview build has no server to hold a socket, so opening one is a
     * connection to nowhere: it fails, logs an error to the console on every
     * attempt, and then retries on a backoff for as long as the preview is
     * open. Students would see nothing, but anyone inspecting the preview
     * would see a page repeatedly trying to reach a realtime endpoint — which
     * is exactly the claim a fixture preview must not make.
     *
     * Staying `offline` is also the honest status: the conversation and the
     * messages list already render the permanent "live delivery is
     * unavailable" line from it, which is true here for the same reason it is
     * true in production on the current host.
     */
    if (IS_PREVIEW_MODE) return;
    const token = getAccessToken();
    if (sessionStatus !== 'signedIn' || !token) return;
    if (socket.current && socket.current.readyState <= WebSocket.OPEN) return;

    setStatus('connecting');

    /*
     * The token travels in the query string because a browser's WebSocket
     * constructor cannot set headers. It is the short-lived access token, and
     * the server re-checks its session on the handshake exactly as it does for
     * REST.
     */
    const url = `${API_BASE_URL.replace(/^http/u, 'ws')}/v1/realtime?token=${encodeURIComponent(token)}`;
    const next = new WebSocket(url);
    socket.current = next;

    next.onopen = () => {
      attempts.current = 0;
      setStatus('open');

      /*
       * Re-subscribe, then ask for the gap. In that order: subscribing first
       * means a message that arrives *during* the resync is delivered live
       * rather than falling into the window between the two requests.
       */
      for (const conversationId of subscriptions.current) {
        send({ type: 'subscribe', conversationId });
        send({
          type: 'resync',
          conversationId,
          lastSeq: highWater.current.get(conversationId) ?? 0,
        });
      }

      // Anything that failed while the connection was down goes again.
      outbox.flush();
    };

    next.onmessage = (event: MessageEvent) => {
      let frame: RealtimeServerFrame;
      try {
        frame = JSON.parse(String(event.data)) as RealtimeServerFrame;
      } catch {
        return;
      }

      // Track the high-water mark here rather than in each screen, so the
      // resync is correct even for a conversation nothing is currently
      // rendering.
      if (frame.type === 'message.new' || frame.type === 'message.updated') {
        rememberSeq(frame.message);
      } else if (frame.type === 'resync') {
        for (const message of frame.messages) rememberSeq(message);
      }

      for (const handler of handlers.current) handler(frame);
    };

    const scheduleReconnect = (): void => {
      if (disposed.current) return;
      setStatus('offline');
      socket.current = null;

      // Exponential backoff with jitter. Without the jitter, every client on a
      // campus that lost its uplink reconnects in the same millisecond.
      const delay = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** attempts.current);
      attempts.current += 1;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connect, delay * (0.75 + Math.random() * 0.5));
    };

    next.onclose = scheduleReconnect;
    next.onerror = () => next.close();
  }, [getAccessToken, outbox, send, sessionStatus]);

  function rememberSeq(message: Message): void {
    const current = highWater.current.get(message.conversationId) ?? 0;
    if (message.seq > current) highWater.current.set(message.conversationId, message.seq);
  }

  useEffect(() => {
    disposed.current = false;
    connect();

    // Captured here rather than read in the cleanup: the ref's contents can be
    // replaced between render and unmount, and the cleanup must clear the
    // timers this effect actually created.
    const timersAtMount = typingTimers.current;

    return () => {
      disposed.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      for (const timer of timersAtMount.values()) clearTimeout(timer);
      timersAtMount.clear();
      socket.current?.close();
      socket.current = null;
      outbox.dispose();
    };
  }, [connect, outbox]);

  const value = useMemo<RealtimeValue>(
    () => ({
      status,
      outbox,
      subscribe: (conversationId) => {
        subscriptions.current.add(conversationId);
        send({ type: 'subscribe', conversationId });
      },
      unsubscribe: (conversationId) => {
        subscriptions.current.delete(conversationId);
        send({ type: 'unsubscribe', conversationId });
      },
      setTyping: (conversationId, typing) => {
        /*
         * Debounced, and self-cancelling. A frame per keystroke would be a
         * write-rate proportional to typing speed times participants, to
         * express a fact that expires in seconds. The server also expires it on
         * a timer, so a client that dies mid-word does not leave the indicator
         * up forever.
         */
        const existing = typingTimers.current.get(conversationId);
        if (existing) clearTimeout(existing);

        if (!typing) {
          typingTimers.current.delete(conversationId);
          send({ type: 'typing', conversationId, typing: false });
          return;
        }

        send({ type: 'typing', conversationId, typing: true });
        typingTimers.current.set(
          conversationId,
          setTimeout(() => {
            typingTimers.current.delete(conversationId);
            send({ type: 'typing', conversationId, typing: false });
          }, TYPING_DEBOUNCE_MS * 3),
        );
      },
      resync: (conversationId, lastSeq) => {
        const known = Math.max(lastSeq, highWater.current.get(conversationId) ?? 0);
        highWater.current.set(conversationId, known);
        send({ type: 'resync', conversationId, lastSeq: known });
      },
      onFrame: (handler) => {
        handlers.current.add(handler);
        return () => handlers.current.delete(handler);
      },
    }),
    [outbox, send, status],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error('useRealtime must be used inside <RealtimeProvider>');
  return value;
}
