/**
 * Client-side message delivery state machine (§15, §52).
 *
 * A mobile client loses connectivity constantly. Without an explicit state
 * machine, a message that fails mid-send ends up in an ambiguous state and is
 * either lost or sent twice. Encoding the legal transitions here — and
 * refusing every other one — is what makes "no user content is lost on a
 * temporary network failure" a property rather than a hope.
 *
 * Pure and dependency-free so the client and the server test suite share it.
 */

export type MessageState =
  /** Composed and persisted locally, not yet dispatched. */
  | 'queued'
  /** In flight. Retries stay in this state. */
  | 'sending'
  /** Server acknowledged and assigned a seq. */
  | 'sent'
  /** At least one recipient's device received it. */
  | 'delivered'
  /** At least one recipient read it. */
  | 'read'
  /** Dispatch failed. Terminal until the user or backoff retries. */
  | 'failed';

const TRANSITIONS: Record<MessageState, readonly MessageState[]> = {
  queued: ['sending', 'failed'],
  sending: ['sent', 'failed'],
  // A server ack can be followed by delivery or, if the recipient was already
  // looking at the thread, directly by a read receipt.
  sent: ['delivered', 'read'],
  delivered: ['read'],
  read: [],
  // Retry re-enters `sending` directly; it does not go back to `queued`,
  // because the message is already persisted locally.
  failed: ['sending'],
};

export function canTransition(from: MessageState, to: MessageState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalMessageTransitionError extends Error {
  constructor(
    readonly from: MessageState,
    readonly to: MessageState,
  ) {
    super(`Illegal message state transition: ${from} -> ${to}`);
    this.name = 'IllegalMessageTransitionError';
  }
}

/**
 * Applies a transition, throwing on an illegal one.
 *
 * Out-of-order receipts are common (a `read` webhook can beat a `delivered`
 * one), so `advance` treats a transition that would move BACKWARDS as a no-op
 * rather than an error — but a genuinely impossible move still throws.
 */
export function advance(from: MessageState, to: MessageState): MessageState {
  if (from === to) return from;
  if (canTransition(from, to)) return to;
  if (rank(to) < rank(from) && rank(from) >= rank('sent') && rank(to) >= rank('sent')) {
    // Late-arriving lower-rank receipt for an already-progressed message.
    return from;
  }
  throw new IllegalMessageTransitionError(from, to);
}

const ORDER: MessageState[] = ['failed', 'queued', 'sending', 'sent', 'delivered', 'read'];
function rank(state: MessageState): number {
  return ORDER.indexOf(state);
}

export function isTerminal(state: MessageState): boolean {
  return state === 'read';
}

export function isRetryable(state: MessageState): boolean {
  return state === 'failed';
}

/**
 * Whether a message is safe to re-send. Combined with the server's
 * (conversation_id, client_message_id) uniqueness, a retry is idempotent: the
 * worst case is the server returning the row it already stored.
 */
export function shouldRetry(state: MessageState, attempts: number, maxAttempts = 5): boolean {
  return isRetryable(state) && attempts < maxAttempts;
}

/** Exponential backoff with a cap. Jitter is added by the caller. */
export function retryDelayMs(attempts: number, baseMs = 1000, capMs = 30_000): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempts));
}

/**
 * Unread count for a conversation. Derived from two integers rather than
 * stored, so it can never drift out of sync with the messages themselves.
 */
export function unreadCount(lastSeq: number, lastReadSeq: number): number {
  return Math.max(0, lastSeq - lastReadSeq);
}
