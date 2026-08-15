import { createHash } from 'node:crypto';
import {
  moderateText,
  normaliseForMatching,
  type ModerationResult,
  type ModerationTerm,
} from '@sos/core';
import { AppError } from '../../platform/errors.js';
import { getLogger } from '../../platform/logger.js';
import type { Sql } from '../../platform/db.js';
import * as repo from './moderation.repository.js';

/**
 * The moderation gate (App Review Guideline 1.2).
 *
 * One function, `gate()`, sits in front of every path that turns text a person
 * typed into text another person can read. There is exactly one of it for the
 * same reason there is exactly one authorization layer (ADR-0003): a second
 * implementation is a second thing to forget, and the one that gets forgotten
 * is the one that ships.
 *
 * The rules live in `@sos/core` (pure, unit-tested, no I/O) and the lexicon
 * lives in `moderation_terms` (rows, so it changes without a deploy). This
 * module is only the wiring: load, decide, record, refuse.
 *
 * It is NOT AI, and nothing in the product may say it is. What it is, honestly:
 * a deterministic first gate whose job is to stop the unambiguous cases at the
 * door and route the doubtful ones to a person. The rest of the Guideline 1.2
 * answer is user reporting, the moderator queue, and blocking — all of which
 * are separate capabilities and all of which must exist.
 */

export type ModerationSurfaceKind = 'post' | 'comment' | 'message' | 'profile';

/**
 * The lexicon, cached.
 *
 * A per-request read of a table that changes a few times a year would add a
 * round trip to every post, comment and message in the product. Sixty seconds
 * is short enough that a moderator adding a term sees it take effect while they
 * are still looking at the screen, and long enough that the read disappears.
 */
const TERM_TTL_MS = 60_000;
let cache: { terms: ModerationTerm[]; loadedAt: number } | null = null;

export async function loadTerms(client?: Sql): Promise<ModerationTerm[]> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < TERM_TTL_MS) return cache.terms;
  const terms = await repo.listActiveTerms(client);
  cache = { terms, loadedAt: now };
  return terms;
}

/** Drops the cache. Used by tests and by the admin term-management path. */
export function invalidateTermCache(): void {
  cache = null;
}

/**
 * Raised when the gate refuses. A distinct class so the HTTP layer can attach
 * the rule category without every caller re-deriving it.
 */
export class ContentRefusedError extends AppError {
  constructor(readonly result: ModerationResult) {
    super('CONTENT_REFUSED', 422, 'That content cannot be posted.', {
      context: { categories: [...new Set(result.matches.map((m) => m.category))] },
    });
    this.name = 'ContentRefusedError';
  }
}

export interface GateOutcome {
  /** `review` verdicts pass through; the caller must record the target id. */
  flagged: boolean;
  result: ModerationResult;
  contentHash: string;
}

/**
 * Runs the gate over one submission and throws if it must not be posted.
 *
 * Called BEFORE the write, outside the caller's transaction, because a refusal
 * is not a rollback — nothing has happened yet — and because the decision row
 * for a refusal must survive even though the submission does not.
 *
 * A `review` verdict returns rather than throwing: flagged content is created
 * and queued, because refusing everything doubtful would make the gate a
 * censor, and a medical cohort discussing forensic pathology would meet it
 * daily.
 */
export async function gate(input: {
  userId: string;
  surface: ModerationSurfaceKind;
  audience: 'public' | 'private';
  text: string | null | undefined;
}): Promise<GateOutcome> {
  const text = input.text ?? '';
  const contentHash = createHash('sha256').update(normaliseForMatching(text)).digest('hex');

  if (text.trim().length === 0) {
    return { flagged: false, result: { verdict: 'allow', matches: [], reasonKey: null }, contentHash };
  }

  const terms = await loadTerms();
  const result = moderateText(text, { terms, surface: { audience: input.audience } });

  if (result.verdict === 'allow') return { flagged: false, result, contentHash };

  /*
   * Recorded outside any caller transaction and best-effort.
   *
   * A gate that fails closed on its own audit write would refuse a legitimate
   * post because the log was briefly unavailable, which is a worse failure than
   * an unlogged decision. The decision itself is still enforced.
   */
  try {
    await repo.recordDecision({
      userId: input.userId,
      surface: input.surface,
      verdict: result.verdict,
      ruleIds: result.matches.map((m) => m.ruleId),
      contentHash,
    });
  } catch (error) {
    getLogger().error({ err: error, surface: input.surface }, 'moderation decision not recorded');
  }

  if (result.verdict === 'block') throw new ContentRefusedError(result);

  return { flagged: true, result, contentHash };
}

/**
 * Attaches a created row to the decision that flagged it.
 *
 * Split from `gate()` because the target does not exist yet when the gate runs —
 * and a queue entry a moderator cannot open is not a queue entry.
 */
export async function linkFlaggedTarget(
  input: {
    userId: string;
    surface: ModerationSurfaceKind;
    contentHash: string;
    targetKind: string;
    targetId: string;
  },
  client?: Sql,
): Promise<void> {
  try {
    await repo.recordDecision(
      {
        userId: input.userId,
        surface: input.surface,
        verdict: 'review',
        ruleIds: [],
        contentHash: input.contentHash,
        targetKind: input.targetKind,
        targetId: input.targetId,
      },
      client,
    );
  } catch (error) {
    getLogger().error({ err: error }, 'moderation queue link not recorded');
  }
}
