import type {
  AuthSession,
  ConversationPage,
  LearnOverview,
  MarkReadResponse,
  MessagePage,
  PracticeAnswerResult,
  PracticeSession,
  Profile,
  Relationship,
  SearchResults,
  SendMessageResponse,
  TopicDetail,
} from '@sos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { resetWorld } from '../fixtures';
import { route } from '../fixture-transport';

/**
 * Drives the complete student journey through the fixture transport, the same
 * sequence the preview acceptance test walks in a browser:
 *
 *   auth → learn → topic → practice (with the before/after evidence delta and
 *   the idempotent-retry contract) → messages (HTTP semantics only) → search →
 *   profile → block/unblock → report → delete account.
 *
 * Everything is asserted through the typed `route` responses, so a fixture
 * that drifts from the contract fails here before it ever reaches a screen.
 */

const q = (params: Record<string, string> = {}): URLSearchParams => new URLSearchParams(params);

async function call<T>(
  method: string,
  path: string,
  body: Record<string, unknown> = {},
  query: URLSearchParams = q(),
): Promise<{ status: number; payload: T }> {
  const response = route(method, path, query, body);
  const text = await response.text();
  return { status: response.status, payload: (text ? JSON.parse(text) : undefined) as T };
}

afterEach(() => {
  resetWorld();
});

describe('fixture transport — the core learning loop', () => {
  it('signs in and reports an onboarded account', async () => {
    const { payload } = await call<AuthSession>('POST', '/v1/auth/login', {
      email: 'anyone@example.com',
      password: 'anything',
    });
    expect(payload.user.onboardingCompleted).toBe(true);
    expect(payload.tokens.accessToken).toContain('not-a-real-credential');
  });

  it('routes a fresh signup into onboarding, and onboarding completes it', async () => {
    const signup = await call<AuthSession>('POST', '/v1/auth/signup', {});
    expect(signup.payload.user.onboardingCompleted).toBe(false);

    await call('POST', '/v1/me/onboarding', {
      handle: 'new.student',
      displayName: 'New Student',
      universityId: 'u1',
      collegeId: 'c1',
      programId: 'p1',
      stageId: 's2',
    });
    const me = await call<Profile>('GET', '/v1/me/profile');
    expect(me.payload.onboardingCompleted).toBe(true);
    expect(me.payload.handle).toBe('new.student');
  });

  it('carries the before/after evidence transition through a practice answer', async () => {
    const before = await call<LearnOverview>('GET', '/v1/learn');
    const focusBefore = before.payload.focusTopics.find((topic) => topic.id === 't-acid-base');
    expect(focusBefore?.questionsSeen).toBe(6);

    const session = await call<PracticeSession>('POST', '/v1/topics/t-acid-base/practice');
    expect(session.payload.progress.questionsSeen).toBe(6);
    expect(session.payload.progress.questionsCorrect).toBe(4);
    expect(session.payload.questions.every((question) => !question.answered)).toBe(true);

    // Answer q1 correctly: 4/6 → 5/7.
    const result = await call<PracticeAnswerResult>(
      'POST',
      `/v1/practice/attempts/${session.payload.attemptId}/answers`,
      { questionId: 'q1', selectedOptionIds: ['q1a'] },
    );
    expect(result.payload.isCorrect).toBe(true);
    expect(result.payload.progress?.questionsSeen).toBe(7);
    expect(result.payload.progress?.questionsCorrect).toBe(5);

    // The Learn refetch — the loop's whole point — must show the new evidence.
    const after = await call<LearnOverview>('GET', '/v1/learn');
    const focusAfter = after.payload.focusTopics.find((topic) => topic.id === 't-acid-base');
    expect(focusAfter?.questionsSeen).toBe(7);

    // And the topic reading surface agrees.
    const topic = await call<TopicDetail>('GET', '/v1/topics/t-acid-base');
    expect(topic.payload.viewer.questionsSeen).toBe(7);
    expect(topic.payload.viewer.questionsCorrect).toBe(5);
  });

  it('treats a replayed submit as idempotent, never counting evidence twice', async () => {
    const session = await call<PracticeSession>('POST', '/v1/topics/t-acid-base/practice');
    const submit = (): Promise<{ status: number; payload: PracticeAnswerResult }> =>
      call('POST', `/v1/practice/attempts/${session.payload.attemptId}/answers`, {
        questionId: 'q2',
        selectedOptionIds: ['q2b'],
      });

    const first = await submit();
    expect(first.payload.isCorrect).toBe(false);
    expect(first.payload.alreadyAnswered).toBe(false);

    const replay = await submit();
    expect(replay.payload.alreadyAnswered).toBe(true);
    expect(replay.payload.progress?.questionsSeen).toBe(first.payload.progress?.questionsSeen);
  });

  it('resumes an attempt at the first unanswered question', async () => {
    const first = await call<PracticeSession>('POST', '/v1/topics/t-acid-base/practice');
    await call('POST', `/v1/practice/attempts/${first.payload.attemptId}/answers`, {
      questionId: 'q1',
      selectedOptionIds: ['q1a'],
    });

    const resumed = await call<PracticeSession>('POST', '/v1/topics/t-acid-base/practice');
    expect(resumed.payload.attemptId).toBe(first.payload.attemptId);
    expect(resumed.payload.questions.find((question) => question.id === 'q1')?.answered).toBe(true);
    expect(resumed.payload.questions.find((question) => question.id === 'q2')?.answered).toBe(false);
  });

  it('grades a half-right multi-select strictly, and q4 has no explanation to invent', async () => {
    const session = await call<PracticeSession>('POST', '/v1/topics/t-acid-base/practice');
    const half = await call<PracticeAnswerResult>(
      'POST',
      `/v1/practice/attempts/${session.payload.attemptId}/answers`,
      { questionId: 'q3', selectedOptionIds: ['q3a', 'q3b'] },
    );
    expect(half.payload.isCorrect).toBe(false);
    expect(half.payload.correctOptionIds).toEqual(['q3a', 'q3b', 'q3d']);

    const noExplanation = await call<PracticeAnswerResult>(
      'POST',
      `/v1/practice/attempts/${session.payload.attemptId}/answers`,
      { questionId: 'q4', selectedOptionIds: ['q4t'] },
    );
    expect(noExplanation.payload.isCorrect).toBe(true);
    expect(noExplanation.payload.explanation).toBeNull();
  });
});

describe('fixture transport — messaging, HTTP semantics only', () => {
  it('sends, deduplicates by clientMessageId, and marks read', async () => {
    const send = (): Promise<{ status: number; payload: SendMessageResponse }> =>
      call('POST', '/v1/conversations/conv-1/messages', {
        clientMessageId: 'client-retry-1',
        body: 'تمام، سأقرأ الفصل السابع الليلة.',
      });

    const first = await send();
    expect(first.payload.deduplicated).toBe(false);
    expect(first.payload.message.seq).toBe(4);

    const retry = await send();
    expect(retry.payload.deduplicated).toBe(true);
    expect(retry.payload.message.seq).toBe(4);

    const messages = await call<MessagePage>('GET', '/v1/conversations/conv-1/messages');
    expect(messages.payload.items).toHaveLength(4);

    const read = await call<MarkReadResponse>('POST', '/v1/conversations/conv-1/read', { seq: 99 });
    expect(read.payload.lastReadSeq).toBe(4); // clamped to the head
    expect(read.payload.unreadCount).toBe(0);

    const list = await call<ConversationPage>('GET', '/v1/conversations', {}, q({ limit: '30' }));
    expect(list.payload.totalUnread).toBe(0);
  });
});

describe('fixture transport — search, relationships, compliance', () => {
  it('search exposes only the contract-supported result classes', async () => {
    const results = await call<SearchResults>('GET', '/v1/search', {}, q({ q: 'الفسلجة' }));
    expect(Object.keys(results.payload).sort()).toEqual([
      'communities',
      'content',
      'groups',
      'people',
      'query',
    ]);
    expect(results.payload.groups).toHaveLength(1);
  });

  it('block and unblock mutate only fixture state, and the block list follows', async () => {
    await call<Relationship>('POST', '/v1/profiles/layla.hassan/block');
    const blocked = await call<{ profile: { handle: string } }[]>('GET', '/v1/me/blocks');
    expect(blocked.payload.map((entry) => entry.profile.handle)).toEqual(['layla.hassan']);

    const profile = await call<Profile>('GET', '/v1/profiles/layla.hassan');
    expect(profile.payload.viewer?.isBlocked).toBe(true);
    expect(profile.payload.viewer?.isFollowing).toBe(false);

    await call<Relationship>('DELETE', '/v1/profiles/layla.hassan/block');
    const after = await call<{ profile: { handle: string } }[]>('GET', '/v1/me/blocks');
    expect(after.payload).toHaveLength(0);
  });

  it('refuses account deletion without the typed confirmation, then deletes with it', async () => {
    const refused = await call('DELETE', '/v1/me/account', { password: 'x', confirmation: 'no' });
    expect(refused.status).toBe(400);

    const deleted = await call<{ sessionsRevoked: number }>('DELETE', '/v1/me/account', {
      password: 'x',
      confirmation: 'DELETE',
    });
    expect(deleted.status).toBe(200);
    expect(deleted.payload.sessionsRevoked).toBe(1);
  });

  it('acknowledges a report without touching anything real', async () => {
    const ack = await call<{ status: string }>('POST', '/v1/reports', {
      targetType: 'content',
      targetId: 'post-3',
      reason: 'misinformation',
    });
    expect(ack.status).toBe(201);
    expect(ack.payload.status).toBe('open');
  });

  it('refuses image upload with a clear message instead of faking it', async () => {
    const upload = await call<{ error: { message: string } }>('POST', '/v1/files');
    expect(upload.status).toBe(400);
    expect(upload.payload.error.message).toContain('disabled in the preview');
  });

  it('answers unknown routes with a NOT_FOUND envelope, not a crash', async () => {
    const missing = await call<{ error: { code: string } }>('GET', '/v1/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.payload.error.code).toBe('NOT_FOUND');
  });
});
