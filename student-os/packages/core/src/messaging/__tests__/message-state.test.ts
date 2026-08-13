import { describe, expect, it } from 'vitest';
import {
  advance,
  canTransition,
  IllegalMessageTransitionError,
  isRetryable,
  retryDelayMs,
  shouldRetry,
  unreadCount,
} from '../message-state.js';

describe('message state machine', () => {
  it('follows the happy path', () => {
    let s = advance('queued', 'sending');
    s = advance(s, 'sent');
    s = advance(s, 'delivered');
    s = advance(s, 'read');
    expect(s).toBe('read');
  });

  it('allows a send failure and a retry back into sending', () => {
    const failed = advance('sending', 'failed');
    expect(isRetryable(failed)).toBe(true);
    expect(advance(failed, 'sending')).toBe('sending');
  });

  it('rejects impossible transitions', () => {
    expect(() => advance('read', 'sending')).toThrow(IllegalMessageTransitionError);
    expect(() => advance('queued', 'read')).toThrow(IllegalMessageTransitionError);
    expect(canTransition('delivered', 'sent')).toBe(false);
  });

  it('tolerates out-of-order receipts once the message is acknowledged', () => {
    // A `delivered` webhook arriving after `read` must not throw or regress:
    // receipts routinely arrive out of order over an unreliable network.
    expect(advance('read', 'delivered')).toBe('read');
    expect(advance('delivered', 'sent')).toBe('delivered');
  });

  it('allows sent to jump straight to read', () => {
    // The recipient already had the thread open.
    expect(advance('sent', 'read')).toBe('read');
  });

  it('treats a repeated transition as a no-op', () => {
    expect(advance('sent', 'sent')).toBe('sent');
  });
});

describe('retry policy', () => {
  it('stops retrying after the attempt cap', () => {
    expect(shouldRetry('failed', 0)).toBe(true);
    expect(shouldRetry('failed', 4)).toBe(true);
    expect(shouldRetry('failed', 5)).toBe(false);
  });

  it('never retries a state that is not failed', () => {
    expect(shouldRetry('sending', 0)).toBe(false);
    expect(shouldRetry('sent', 0)).toBe(false);
  });

  it('backs off exponentially and caps', () => {
    expect(retryDelayMs(0)).toBe(1000);
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(3)).toBe(8000);
    expect(retryDelayMs(20)).toBe(30_000);
  });
});

describe('unreadCount', () => {
  it('derives from sequence numbers', () => {
    expect(unreadCount(10, 7)).toBe(3);
    expect(unreadCount(10, 10)).toBe(0);
  });

  it('never goes negative when a read receipt races ahead', () => {
    expect(unreadCount(5, 9)).toBe(0);
  });
});
