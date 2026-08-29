/**
 * Candidate review state machine.
 *
 * The review layer is described in Section 6 as "the safety boundary between
 * machine extraction and student-facing knowledge". A boundary that is enforced
 * by convention is not a boundary, so it is encoded as an explicit transition
 * table: every legal move is listed, and anything absent from the table is
 * rejected with INVALID_STATE_TRANSITION.
 *
 * The property that matters:
 *
 *     No path exists from PENDING to PUBLISHED that does not pass through a
 *     human decision (APPROVED, EDITED or MERGED).
 *
 * That is checkable by inspecting the table, and it is checked by a test that
 * walks the graph exhaustively rather than by trusting this comment.
 */

import type { CandidateId, CandidateState, ExtractionCandidate } from '../domain/types.ts';
import { EngineError } from '../domain/errors.ts';

export type ReviewAction = 'APPROVE' | 'EDIT' | 'REJECT' | 'MERGE' | 'PUBLISH' | 'REOPEN';

interface Transition {
  readonly from: CandidateState;
  readonly action: ReviewAction;
  readonly to: CandidateState;
  /** True when a human actor is required to perform this transition. */
  readonly requiresReviewer: boolean;
}

/**
 * The complete legal transition set.
 *
 * PUBLISH is the only machine-initiated transition, and its only legal sources
 * are the three states that a reviewer can produce. REOPEN exists so a mistaken
 * rejection is recoverable without a database edit.
 */
const TRANSITIONS: readonly Transition[] = [
  { from: 'PENDING', action: 'APPROVE', to: 'APPROVED', requiresReviewer: true },
  { from: 'PENDING', action: 'EDIT', to: 'EDITED', requiresReviewer: true },
  { from: 'PENDING', action: 'REJECT', to: 'REJECTED', requiresReviewer: true },
  { from: 'PENDING', action: 'MERGE', to: 'MERGED', requiresReviewer: true },

  { from: 'APPROVED', action: 'EDIT', to: 'EDITED', requiresReviewer: true },
  { from: 'APPROVED', action: 'REJECT', to: 'REJECTED', requiresReviewer: true },
  { from: 'APPROVED', action: 'MERGE', to: 'MERGED', requiresReviewer: true },
  { from: 'APPROVED', action: 'PUBLISH', to: 'PUBLISHED', requiresReviewer: false },

  { from: 'EDITED', action: 'APPROVE', to: 'APPROVED', requiresReviewer: true },
  { from: 'EDITED', action: 'EDIT', to: 'EDITED', requiresReviewer: true },
  { from: 'EDITED', action: 'REJECT', to: 'REJECTED', requiresReviewer: true },
  { from: 'EDITED', action: 'MERGE', to: 'MERGED', requiresReviewer: true },
  { from: 'EDITED', action: 'PUBLISH', to: 'PUBLISHED', requiresReviewer: false },

  { from: 'MERGED', action: 'REJECT', to: 'REJECTED', requiresReviewer: true },
  { from: 'MERGED', action: 'PUBLISH', to: 'PUBLISHED', requiresReviewer: false },

  { from: 'REJECTED', action: 'REOPEN', to: 'PENDING', requiresReviewer: true },
];

/** States from which knowledge may be materialized. */
export const PUBLISHABLE_STATES: readonly CandidateState[] = Object.freeze([
  'APPROVED',
  'EDITED',
  'MERGED',
]);

/** States whose content may reach a student. */
export const STUDENT_VISIBLE_STATES: readonly CandidateState[] = Object.freeze(['PUBLISHED']);

export function isStudentVisible(state: CandidateState): boolean {
  return STUDENT_VISIBLE_STATES.includes(state);
}

export function legalActions(from: CandidateState): ReviewAction[] {
  return TRANSITIONS.filter((t) => t.from === from).map((t) => t.action);
}

export function findTransition(from: CandidateState, action: ReviewAction): Transition | null {
  return TRANSITIONS.find((t) => t.from === from && t.action === action) ?? null;
}

export interface ReviewCommand {
  readonly action: ReviewAction;
  readonly reviewerId: string | null;
  readonly at: number;
  /** Required for EDIT. */
  readonly editedText?: string;
  /** Required for MERGE. */
  readonly mergeInto?: CandidateId;
  readonly note?: string;
}

/**
 * Applies a review command, returning the new candidate.
 *
 * Pure: takes and returns a value, performs no I/O. The caller persists the
 * result inside its own transaction, which keeps the state machine testable
 * without a database and keeps persistence policy out of the domain.
 */
export function applyReview(
  candidate: ExtractionCandidate,
  command: ReviewCommand,
): ExtractionCandidate {
  const transition = findTransition(candidate.state, command.action);
  if (transition === null) {
    throw new EngineError(
      'INVALID_STATE_TRANSITION',
      `Cannot ${command.action} a candidate in state ${candidate.state}`,
      {
        candidateId: candidate.id,
        from: candidate.state,
        action: command.action,
        legalActions: legalActions(candidate.state),
      },
    );
  }

  if (transition.requiresReviewer && (command.reviewerId === null || command.reviewerId === '')) {
    throw new EngineError(
      'UNREVIEWED_CANDIDATE',
      `Action ${command.action} requires an identified reviewer`,
      { candidateId: candidate.id, action: command.action },
    );
  }

  if (command.action === 'EDIT') {
    const edited = command.editedText?.trim() ?? '';
    if (edited.length === 0) {
      throw new EngineError('INVALID_STATE_TRANSITION', 'EDIT requires non-empty editedText', {
        candidateId: candidate.id,
      });
    }
    return {
      ...candidate,
      state: transition.to,
      editedText: edited,
      reviewedBy: command.reviewerId,
      reviewedAt: command.at,
      reviewNote: command.note ?? candidate.reviewNote,
    };
  }

  if (command.action === 'MERGE') {
    if (command.mergeInto === undefined) {
      throw new EngineError('INVALID_STATE_TRANSITION', 'MERGE requires a target candidate', {
        candidateId: candidate.id,
      });
    }
    if (command.mergeInto === candidate.id) {
      throw new EngineError('INVALID_STATE_TRANSITION', 'A candidate cannot be merged into itself', {
        candidateId: candidate.id,
      });
    }
    return {
      ...candidate,
      state: transition.to,
      mergedIntoCandidateId: command.mergeInto,
      reviewedBy: command.reviewerId,
      reviewedAt: command.at,
      reviewNote: command.note ?? candidate.reviewNote,
    };
  }

  if (command.action === 'REOPEN') {
    return {
      ...candidate,
      state: transition.to,
      mergedIntoCandidateId: null,
      reviewedBy: command.reviewerId,
      reviewedAt: command.at,
      reviewNote: command.note ?? candidate.reviewNote,
    };
  }

  return {
    ...candidate,
    state: transition.to,
    reviewedBy: command.reviewerId ?? candidate.reviewedBy,
    reviewedAt: command.at,
    reviewNote: command.note ?? candidate.reviewNote,
  };
}

/** The text that publication should use: reviewer edit wins over engine proposal. */
export function effectiveText(candidate: ExtractionCandidate): string {
  return candidate.editedText ?? candidate.proposedText;
}

/**
 * Proves the safety property by exhaustive graph search rather than assertion.
 *
 * Returns every path from PENDING to PUBLISHED. A path that contains no
 * reviewer-required transition is a hole in the boundary; the test asserts
 * there are none.
 */
export function pathsToPublished(): ReviewAction[][] {
  const paths: ReviewAction[][] = [];
  const walk = (state: CandidateState, actions: ReviewAction[], depth: number): void => {
    if (depth > 8) return;
    if (state === 'PUBLISHED') {
      paths.push([...actions]);
      return;
    }
    for (const transition of TRANSITIONS) {
      if (transition.from !== state) continue;
      // Avoid cycling on self-transitions such as EDITED -> EDIT -> EDITED.
      if (transition.to === state) continue;
      walk(transition.to, [...actions, transition.action], depth + 1);
    }
  };
  walk('PENDING', [], 0);
  return paths;
}

/** Actions that only a human may perform. Used by the exhaustive safety test. */
export const REVIEWER_ACTIONS: readonly ReviewAction[] = Object.freeze([
  'APPROVE',
  'EDIT',
  'REJECT',
  'MERGE',
  'REOPEN',
]);
