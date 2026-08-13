import type { Message, SendMessageResponse } from '@sos/contracts';
import { retryDelayMs, shouldRetry, type MessageState } from '@sos/core';
import type { ApiClient } from '../api/client';

/**
 * The send queue.
 *
 * A message a student typed is theirs. Once it exists on their screen it must
 * not disappear because a lift, a lecture theatre or a backgrounded app ate the
 * request — so it is held here, retried with backoff, and reconciled by
 * `clientMessageId` when the server finally answers.
 *
 * Three properties, in order of how badly their absence hurts:
 *
 *  1. **Nothing is lost.** A failed send stays in the queue and is retried; a
 *     terminal failure stays visible and retryable rather than vanishing.
 *  2. **Nothing is duplicated.** `clientMessageId` is minted once per composed
 *     message and reused for every attempt, so the server collapses retries.
 *     Rapid taps on Send cannot produce two messages, because the id is minted
 *     when the draft is created, not when the request is made.
 *  3. **Order is the server's.** The queue sends one message at a time per
 *     conversation. Firing concurrently would let the second message win the
 *     race for a lower seq and permanently reorder a pair the user sent
 *     deliberately.
 *
 * The state machine itself lives in `@sos/core` and is shared with the server's
 * tests, so "which transitions are legal" has one definition.
 */

export interface PendingMessage {
  clientMessageId: string;
  conversationId: string;
  body: string;
  state: MessageState;
  attempts: number;
  /** Set once the server has answered. */
  message: Message | null;
  createdAt: number;
}

type Listener = () => void;

export class Outbox {
  private readonly pending = new Map<string, PendingMessage>();
  private readonly listeners = new Set<Listener>();
  /** One in-flight send per conversation — see property 3 above. */
  private readonly draining = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly api: ApiClient) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** Everything still unacknowledged for a conversation, oldest first. */
  pendingFor(conversationId: string): PendingMessage[] {
    return [...this.pending.values()]
      .filter((entry) => entry.conversationId === conversationId && entry.message === null)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Queues a message.
   *
   * `clientMessageId` is minted by the caller when the draft is created. That
   * timing is the anti-duplicate guarantee: a second tap on Send re-enqueues
   * the same id and is a no-op here.
   */
  enqueue(entry: { clientMessageId: string; conversationId: string; body: string }): void {
    if (this.pending.has(entry.clientMessageId)) return;

    this.pending.set(entry.clientMessageId, {
      ...entry,
      state: 'queued',
      attempts: 0,
      message: null,
      createdAt: Date.now(),
    });
    this.notify();
    void this.drain(entry.conversationId);
  }

  /** Retries a failed message on the user's command, bypassing the backoff. */
  retry(clientMessageId: string): void {
    const entry = this.pending.get(clientMessageId);
    if (!entry || entry.state !== 'failed') return;
    entry.state = 'queued';
    entry.attempts = 0;
    this.notify();
    void this.drain(entry.conversationId);
  }

  discard(clientMessageId: string): void {
    this.pending.delete(clientMessageId);
    this.notify();
  }

  /**
   * Reconciles a message that arrived by another route.
   *
   * A realtime frame for our own send can beat the HTTP response. Without this,
   * the thread would show the optimistic row and the delivered one side by
   * side — the duplicate the user actually notices.
   */
  reconcile(message: Message): void {
    const entry = this.pending.get(message.clientMessageId);
    if (!entry) return;
    entry.message = message;
    entry.state = 'sent';
    this.pending.delete(message.clientMessageId);
    this.notify();
  }

  private async drain(conversationId: string): Promise<void> {
    if (this.draining.has(conversationId)) return;
    this.draining.add(conversationId);

    try {
      for (;;) {
        const next = this.pendingFor(conversationId).find(
          (entry) => entry.state === 'queued' || entry.state === 'sending',
        );
        if (!next) return;

        next.state = 'sending';
        next.attempts += 1;
        this.notify();

        try {
          const response = await this.api.post<SendMessageResponse>(
            `/v1/conversations/${conversationId}/messages`,
            {
              clientMessageId: next.clientMessageId,
              kind: 'text',
              body: next.body,
              replyToId: null,
              attachmentFileIds: [],
            },
          );
          // `deduplicated` is not an error. It means a previous attempt did
          // land and only its response was lost — the message is delivered,
          // exactly once, which is the whole point of the key.
          this.reconcile(response.message);
        } catch {
          next.state = 'failed';
          this.notify();

          if (shouldRetry(next.state, next.attempts)) {
            const delay = retryDelayMs(next.attempts) * (0.75 + Math.random() * 0.5);
            const timer = setTimeout(() => {
              this.timers.delete(next.clientMessageId);
              const still = this.pending.get(next.clientMessageId);
              if (!still || still.state !== 'failed') return;
              still.state = 'queued';
              this.notify();
              void this.drain(conversationId);
            }, delay);
            this.timers.set(next.clientMessageId, timer);
          }
          // Stop draining this conversation: sending the next message while
          // this one is stuck would deliver them out of the order they were
          // typed in.
          return;
        }
      }
    } finally {
      this.draining.delete(conversationId);
    }
  }

  /** Called on reconnect: everything that failed while offline goes again. */
  flush(): void {
    const conversations = new Set<string>();
    for (const entry of this.pending.values()) {
      if (entry.state === 'failed') {
        entry.state = 'queued';
        entry.attempts = 0;
      }
      conversations.add(entry.conversationId);
    }
    this.notify();
    for (const conversationId of conversations) void this.drain(conversationId);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
  }
}
