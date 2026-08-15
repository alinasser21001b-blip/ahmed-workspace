import type { ErrorEnvelope } from '@sos/contracts';
import * as world from './fixtures';

/**
 * The fixture transport.
 *
 * A drop-in `fetch` for preview builds. It never opens a socket: every request
 * the app makes resolves against the in-memory world in `fixtures.ts`, so a
 * destructive action in the preview can, by construction, destroy nothing.
 *
 * Honesty rules, matching the production limitations this preview must not
 * paper over:
 *
 *  - Messaging is HTTP send/read only. Nothing here emits realtime frames,
 *    simulates typing, or pretends to live-deliver — the deployed host cannot
 *    hold a WebSocket open, and neither does this.
 *  - Search returns only the result classes the real contract supports
 *    (people, content, groups, communities). Topic and classroom search have
 *    no endpoint in production and none here.
 *  - Push notifications do not exist in production and are not simulated.
 *  - Image upload is refused with a clear message rather than faked.
 *
 * Latency: a small constant delay so loading states render the way they will
 * against a real network, instead of flashing.
 */

const DELAY_MS = 120;

const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, DELAY_MS));

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function error(status: number, code: ErrorEnvelope['error']['code'], message: string): Response {
  const envelope: ErrorEnvelope = { error: { code, message, requestId: 'preview-fixture' } };
  return json(envelope, status);
}

function notFound(what: string): Response {
  return error(404, 'NOT_FOUND', `${what} was not found in the preview dataset.`);
}

type Body = Record<string, unknown>;

function parseBody(init?: RequestInit): Body {
  if (!init?.body || typeof init.body !== 'string') return {};
  try {
    return JSON.parse(init.body) as Body;
  } catch {
    return {};
  }
}

/**
 * Route the request. Exported for tests; `fixtureFetch` is the fetch-shaped
 * wrapper the ApiClient consumes.
 */
export function route(method: string, path: string, query: URLSearchParams, body: Body): Response {
  // --- auth -----------------------------------------------------------------

  if (path === '/v1/auth/login' && method === 'POST') {
    // Any credentials sign in to the preview account. There is nothing to
    // protect: the world is invented and local to this tab.
    return json(world.makeAuthSession());
  }
  if (path === '/v1/auth/signup' && method === 'POST') {
    // A fresh signup goes through onboarding, so that flow is reviewable too.
    world.account.onboardingCompleted = false;
    return json(world.makeAuthSession());
  }
  if (path === '/v1/auth/me' && method === 'GET') {
    if (world.account.deleted) return error(401, 'UNAUTHENTICATED', 'This account was deleted.');
    return json(world.makeAuthUser());
  }
  if (path === '/v1/auth/refresh' && method === 'POST') {
    return json(world.makeAuthSession());
  }
  if (path === '/v1/auth/logout' && method === 'POST') {
    return noContent();
  }
  if (path === '/v1/auth/forgot-password' && method === 'POST') {
    return json({
      message: 'If an account exists for that address, a reset link or code is on its way.',
    });
  }
  if (path === '/v1/auth/reset-password' && method === 'POST') {
    return json(world.makeAuthSession());
  }

  // --- academic hierarchy (onboarding) ---------------------------------------

  if (path === '/v1/academic/universities') return json(world.universities);
  if (path === '/v1/academic/colleges') return json(world.colleges);
  if (path === '/v1/academic/programs') return json(world.programs);
  if (path === '/v1/academic/stages') return json(world.stages);
  if (path === '/v1/academic/courses') return json(world.courses);
  if (path === '/v1/academic/topics') return json(world.academicTopics);

  if (path === '/v1/handles/available') {
    const handle = query.get('handle') ?? '';
    return json({ handle, available: handle !== world.layla.handle });
  }

  // --- me -------------------------------------------------------------------

  if (path === '/v1/me/profile' && method === 'GET') return json(world.makeMyProfile());
  if (path === '/v1/me/onboarding' && method === 'POST') {
    world.completeOnboarding(
      typeof body.handle === 'string' ? body.handle : 'preview.student',
      typeof body.displayName === 'string' ? body.displayName : 'Preview Student',
    );
    return json(world.makeMyProfile());
  }
  if (path === '/v1/me/blocks' && method === 'GET') return json(world.blockedAccounts());
  if (path === '/v1/me/account' && method === 'DELETE') {
    if (body.confirmation !== 'DELETE') {
      return error(400, 'VALIDATION_ERROR', 'Type DELETE to confirm.');
    }
    const summary = world.deleteAccount();
    // The preview world resets after a short beat, so the reviewer can run the
    // whole lifecycle again without reloading. The response they see is the
    // one above.
    setTimeout(() => world.resetWorld(), 2000);
    return json(summary);
  }
  if (path === '/v1/support/links') return json(world.supportLinks);

  // --- learn / topic / practice ----------------------------------------------

  if (path === '/v1/learn') return json(world.makeLearnOverview());

  {
    const topic = path.match(/^\/v1\/topics\/([^/]+)$/);
    if (topic?.[1]) {
      const detail = world.makeTopicDetail(topic[1]);
      return detail ? json(detail) : notFound('That topic');
    }
    const knowledge = path.match(/^\/v1\/topics\/([^/]+)\/knowledge$/);
    if (knowledge) {
      return json(world.makeFeedPage({}));
    }
    const practice = path.match(/^\/v1\/topics\/([^/]+)\/practice$/);
    if (practice?.[1] && method === 'POST') {
      const session = world.startPractice(practice[1]);
      return session ? json(session) : notFound('Practice for this topic');
    }
    const answers = path.match(/^\/v1\/practice\/attempts\/([^/]+)\/answers$/);
    if (answers?.[1] && method === 'POST') {
      const result = world.submitAnswer(
        answers[1],
        typeof body.questionId === 'string' ? body.questionId : '',
        Array.isArray(body.selectedOptionIds) ? (body.selectedOptionIds as string[]) : [],
      );
      return result ? json(result) : notFound('That attempt');
    }
  }

  // --- feed / content ---------------------------------------------------------

  if (path === '/v1/feed') {
    return json(
      world.makeFeedPage({
        authorHandle: query.get('authorHandle') ?? undefined,
        groupId: query.get('groupId') ?? undefined,
      }),
    );
  }
  if (path === '/v1/content' && method === 'POST') {
    const created = world.createPost(
      typeof body.body === 'string' ? body.body : '',
      typeof body.knowledgeType === 'string'
        ? (body.knowledgeType as ReturnType<typeof world.createPost>['knowledgeType'])
        : null,
    );
    return json(created, 201);
  }

  {
    const content = path.match(/^\/v1\/content\/([^/]+)(?:\/([a-z]+))?$/);
    if (content?.[1]) {
      const [, id, sub] = content;
      const item = world.contentById(id);
      if (!item && sub !== 'view') return notFound('That post');
      if (!sub) return json(item);
      if (sub === 'comments' && method === 'GET') return json(world.commentsFor(id));
      if (sub === 'comments' && method === 'POST') {
        return json(world.addComment(id, typeof body.body === 'string' ? body.body : ''), 201);
      }
      if (sub === 'sources') return json(world.sourcesFor(id));
      if (sub === 'corrections') return json(world.correctionsFor(id));
      if (sub === 'view') return noContent();
      if (sub === 'reaction' && item) {
        const next = item.viewer.reaction ? null : 'like';
        item.viewer = { ...item.viewer, reaction: next };
        item.counts = { ...item.counts, likes: item.counts.likes + (next ? 1 : -1) };
        return json({ reaction: next, likeCount: item.counts.likes });
      }
      if (sub === 'bookmark' && item) {
        const next = !item.viewer.hasBookmarked;
        item.viewer = { ...item.viewer, hasBookmarked: next };
        item.counts = { ...item.counts, bookmarks: item.counts.bookmarks + (next ? 1 : -1) };
        return json({ hasBookmarked: next, bookmarkCount: item.counts.bookmarks });
      }
    }
  }

  // --- groups -----------------------------------------------------------------

  if (path === '/v1/groups' && method === 'GET') return json({ items: [world.studyGroup] });
  if (path === '/v1/groups' && method === 'POST') {
    return error(
      403,
      'FORBIDDEN',
      'Creating groups is disabled in the preview so the shared dataset stays readable.',
    );
  }
  {
    const group = path.match(/^\/v1\/groups\/([^/]+)(?:\/(members|membership))?/);
    if (group?.[1]) {
      if (group[1] !== world.studyGroup.id) return notFound('That group');
      if (!group[2]) return json(world.studyGroup);
      if (group[2] === 'members') return json({ items: world.groupMembers(), nextCursor: null });
      if (group[2] === 'membership') return json({ status: 'active', group: world.studyGroup });
    }
  }

  // --- classrooms -------------------------------------------------------------

  if (path === '/v1/classrooms' && method === 'GET') {
    const { joinCode: _joinCode, ...summary } = world.classroom;
    return json({ items: [summary] });
  }
  if (path === '/v1/classrooms' && method === 'POST') {
    return error(403, 'FORBIDDEN', 'Only verified instructors can open a classroom.');
  }
  if (path === '/v1/classrooms/lookup') return notFound('A classroom with that join code');
  {
    const room = path.match(/^\/v1\/classrooms\/([^/]+)(?:\/(lectures|members|membership))?$/);
    if (room?.[1]) {
      if (room[1] !== world.classroom.id) return notFound('That classroom');
      if (!room[2]) return json(world.classroom);
      if (room[2] === 'lectures') return json({ items: world.lectures });
      if (room[2] === 'members') return json({ items: world.classroomMembers() });
      if (room[2] === 'membership') return method === 'DELETE' ? noContent() : json(world.classroom);
    }
    const lecture = path.match(/^\/v1\/lectures\/([^/]+)(?:\/(discussion|materials|progress))?$/);
    if (lecture?.[1]) {
      const detail = world.lectureDetail(lecture[1]);
      if (!detail) return notFound('That lecture');
      if (!lecture[2]) return json(detail);
      if (lecture[2] === 'discussion' && method === 'GET') return json({ items: [], nextCursor: null });
      if (lecture[2] === 'discussion' && method === 'POST') {
        return json(world.createPost(typeof body.body === 'string' ? body.body : '', null), 201);
      }
      if (lecture[2] === 'materials') {
        return error(403, 'FORBIDDEN', 'Only teaching staff can add materials.');
      }
      if (lecture[2] === 'progress') {
        world.markLectureProgress(lecture[1], typeof body.percent === 'number' ? body.percent : 0);
        return noContent();
      }
    }
  }

  // --- conversations ----------------------------------------------------------

  if (path === '/v1/conversations' && method === 'GET') return json(world.listConversations());
  {
    const conversation = path.match(/^\/v1\/conversations\/([^/]+)(?:\/(messages|read))?$/);
    if (conversation?.[1]) {
      const [, id, sub] = conversation;
      if (!sub) {
        const found = world.conversationById(id);
        return found ? json(found) : notFound('That conversation');
      }
      if (sub === 'messages' && method === 'GET') return json(world.listMessages(id));
      if (sub === 'messages' && method === 'POST') {
        const sent = world.sendMessage(
          id,
          typeof body.clientMessageId === 'string' ? body.clientMessageId : `no-client-id-${path}`,
          typeof body.body === 'string' ? body.body : '',
        );
        return sent ? json(sent, 201) : notFound('That conversation');
      }
      if (sub === 'read' && method === 'POST') {
        const read = world.markRead(id, typeof body.seq === 'number' ? body.seq : 0);
        return read ? json(read) : notFound('That conversation');
      }
    }
  }

  // --- profiles / relationships ----------------------------------------------

  {
    const profile = path.match(/^\/v1\/profiles\/([^/]+)(?:\/(relationship|follow|block))?$/);
    if (profile?.[1]) {
      const [, handle, sub] = profile;
      if (!sub) {
        const found = world.profileByHandle(handle);
        return found ? json(found) : notFound('That profile');
      }
      if (sub === 'relationship') {
        const found = world.relationshipFor(handle);
        return found ? json(found) : notFound('That profile');
      }
      if (sub === 'follow') {
        world.setFollowing(handle, method !== 'DELETE');
        return json(world.relationshipFor(handle));
      }
      if (sub === 'block') {
        world.setBlocked(handle, method !== 'DELETE');
        return json(world.relationshipFor(handle));
      }
    }
  }

  // --- search / reports / files ----------------------------------------------

  if (path === '/v1/search') return json(world.search(query.get('q') ?? ''));

  if (path === '/v1/reports' && method === 'POST') {
    return json({ id: world.nextId('report'), status: 'open', createdAt: world.at(250) }, 201);
  }

  if (path === '/v1/files' && method === 'POST') {
    return error(
      400,
      'VALIDATION_ERROR',
      'Image upload is disabled in the preview. Everything else about composing works.',
    );
  }

  if (path === '/v1/ping') return noContent();

  return notFound(`${method} ${path}`);
}

/**
 * The fetch-shaped entry point.
 *
 * Only same-origin API calls exist in the app, so every URL that reaches here
 * is parsed for its path and query and answered from the world.
 */
export const fixtureFetch: typeof fetch = async (input, init) => {
  await wait();
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    'http://preview.local',
  );
  const method = (init?.method ?? 'GET').toUpperCase();
  return route(method, url.pathname, url.searchParams, parseBody(init));
};
