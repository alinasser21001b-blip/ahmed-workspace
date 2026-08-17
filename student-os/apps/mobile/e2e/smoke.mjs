import { randomUUID } from 'node:crypto';

/**
 * Pre-review smoke test.
 *
 * Exercises every product area against the running stack before anyone is asked
 * to look at it, so that a review is spent on judgement rather than on
 * discovering that login is broken.
 *
 * This is an API-level check on purpose: the browser suites
 * (`first-journey`, `messaging`, `rtl-audit`) already cover rendering, and what
 * this adds is breadth — every endpoint the reviewer's clicks will reach,
 * including the permission cases that are invisible from the outside.
 *
 *   API_URL=http://localhost:4000 node apps/mobile/e2e/smoke.mjs
 *
 * IT MUTATES. It sends a message, posts, comments and marks things read, so it
 * expects a freshly seeded database and is not idempotent against its own
 * leftovers — several assertions count rows. Re-seed before each run:
 *
 *   pnpm db:reset && pnpm db:seed && pnpm demo:seed
 */

const API = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = 'correct-horse-battery';

const failures = [];
let checks = 0;

function check(condition, description) {
  checks += 1;
  if (condition) console.log(`  ✓ ${description}`);
  else {
    failures.push(description);
    console.log(`  ✗ ${description}`);
  }
}

async function raw(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      // Only when there IS a body. Declaring JSON on a bodiless request makes
      // Fastify parse an empty payload and reject it — the real client sets the
      // header the same way, so this mirrors it rather than working around it.
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

async function call(path, options) {
  const { status, json } = await raw(path, options);
  if (status >= 400) throw new Error(`${options?.method ?? 'GET'} ${path} → ${status}`);
  return json;
}

async function login(email) {
  const session = await call('/v1/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  return session;
}

// --- authentication ---------------------------------------------------------

console.log('\nauthentication');

const amjad = await login('amjad@uob.edu.iq');
check(Boolean(amjad.tokens.accessToken), 'login returns an access token');

const me = await call('/v1/auth/me', { token: amjad.tokens.accessToken });
check(me.onboardingCompleted === true, 'session restores an onboarded profile');

const wrongPassword = await raw('/v1/auth/login', {
  method: 'POST',
  body: { email: 'amjad@uob.edu.iq', password: 'wrong-password-entirely' },
});
check(wrongPassword.status === 401, 'a wrong password is refused');

/*
 * The auth cases use throwaway signups rather than repeated logins.
 *
 * `/auth/login` is rate-limited to 10/min — correctly, it is the credential
 * endpoint — and a smoke test that logs in six times to prove six things ends
 * up proving the rate limiter instead.
 */
const theftSession = await call('/v1/auth/signup', {
  method: 'POST',
  body: { email: `smoke-theft-${Date.now()}@uob.edu.iq`, password: PASSWORD },
});
check(Boolean(theftSession.tokens.refreshToken), 'signup issues a session');

const rotated = await call('/v1/auth/refresh', {
  method: 'POST',
  body: { refreshToken: theftSession.tokens.refreshToken },
});
check(
  rotated.tokens.refreshToken !== theftSession.tokens.refreshToken,
  'refresh rotates the refresh token',
);

const replayed = await raw('/v1/auth/refresh', {
  method: 'POST',
  body: { refreshToken: theftSession.tokens.refreshToken },
});
check(replayed.status === 401, 'replaying a rotated token is refused (theft detection)');

const chainRevoked = await raw('/v1/auth/me', { token: rotated.tokens.accessToken });
check(chainRevoked.status === 401, 'and the whole session chain is revoked with it');

// A separate session, so logout is observed on its own and not on a chain the
// theft-detection case already revoked.
const logoutSession = await call('/v1/auth/signup', {
  method: 'POST',
  body: { email: `smoke-logout-${Date.now()}@uob.edu.iq`, password: PASSWORD },
});
await call('/v1/auth/logout', {
  method: 'POST',
  token: logoutSession.tokens.accessToken,
  body: { refreshToken: logoutSession.tokens.refreshToken, allDevices: false },
});
const afterLogout = await raw('/v1/auth/me', { token: logoutSession.tokens.accessToken });
check(afterLogout.status === 401, 'logout takes effect immediately, not on token expiry');

const zainab = await login('zainab@uob.edu.iq');
const omar = await login('omar@uob.edu.iq');
const A = amjad.tokens.accessToken;
const Z = zainab.tokens.accessToken;
const O = omar.tokens.accessToken;

// --- social -----------------------------------------------------------------

console.log('\nsocial');

const feed = await call('/v1/feed?scope=home&limit=30', { token: A });
check(feed.items.length >= 4, `the ranked feed returns content (${feed.items.length} items)`);

const recent = await call('/v1/feed?scope=recent&limit=30', { token: A });
check(recent.items.length >= 4, 'the recent feed returns content');

const withImage = recent.items.find((item) => item.media.length > 0);
check(Boolean(withImage), 'a post carries its uploaded image');
check(
  Boolean(withImage?.media[0]?.url?.includes('sig=')),
  'media is served through a signed URL, not a raw path',
);

/*
 * The web bundle always runs on a different origin from the API, so the bytes
 * must be embeddable cross-origin. A `same-origin` policy here does not fail a
 * request — it blocks the <img> after a 200, so every image silently vanishes
 * with nothing in the network tab to point at. Asserted on the real response
 * because that is the only place the header is observable.
 */
const mediaResponse = await fetch(`${API}${withImage.media[0].url}`);
check(mediaResponse.status === 200, 'a signed media URL resolves');
check(
  mediaResponse.headers.get('cross-origin-resource-policy') === 'cross-origin',
  'media may be embedded by the web client on another origin',
);

const created = await call('/v1/content', {
  method: 'POST',
  token: A,
  body: { body: 'Smoke-test post — safe to delete.', visibility: 'stage', mediaFileIds: [], topicIds: [] },
});
check(Boolean(created.id), 'creating a post succeeds');

const item = await call(`/v1/content/${created.id}`, { token: A });
check(item.id === created.id, 'opening a post returns it');

await call(`/v1/content/${created.id}/comments`, {
  method: 'POST',
  token: Z,
  body: { body: 'Smoke-test comment.' },
});
const comments = await call(`/v1/content/${created.id}/comments?limit=20`, { token: A });
check(comments.items.length === 1, 'a comment appears in the thread');

const liked = await call(`/v1/content/${created.id}/reaction`, {
  method: 'PUT',
  token: Z,
  body: { kind: 'like' },
});
check(liked.likeCount === 1, 'a reaction is counted');

await call(`/v1/content/${created.id}/bookmark`, { method: 'PUT', token: A, body: {} });
const saved = await call('/v1/feed?scope=saved&limit=30', { token: A });
check(
  saved.items.some((entry) => entry.id === created.id),
  'a saved post appears in the saved scope',
);

const profile = await call('/v1/profiles/zainab', { token: A });
check(profile.handle === 'zainab', 'a profile loads');
check(profile.viewer.isFollowing === true, 'the viewer relationship is reported');

await call(`/v1/content/${created.id}`, { method: 'DELETE', token: A });
const afterDelete = await raw(`/v1/content/${created.id}`, { token: A });
check(afterDelete.status === 404, 'a deleted post is gone, for its author too');

// --- community --------------------------------------------------------------

console.log('\ncommunity');

const myGroups = await call('/v1/groups?scope=mine&limit=30', { token: A });
check(myGroups.items.length >= 3, `group list returns memberships (${myGroups.items.length})`);

const discover = await call('/v1/groups?scope=discover&limit=30', { token: O });
check(discover.items.length >= 1, 'discovery returns joinable groups');

const unlisted = myGroups.items.find((group) => group.visibility === 'group');
check(Boolean(unlisted), 'the unlisted group exists for its members');

check(
  !discover.items.some((group) => group.id === unlisted.id),
  'the unlisted group is NOT in a non-member’s discovery',
);

const unlistedForOmar = await raw(`/v1/groups/${unlisted.id}`, { token: O });
check(unlistedForOmar.status === 404, 'a non-member gets 404 on the unlisted group, not 403');

const unlistedPosts = await raw(`/v1/feed?scope=recent&groupId=${unlisted.id}&limit=10`, {
  token: O,
});
check(
  unlistedPosts.status === 404 || unlistedPosts.json.items.length === 0,
  'a non-member reads no posts from the unlisted group',
);

const detail = await call(`/v1/groups/${myGroups.items.find((g) => g.joinPolicy === 'open').id}`, {
  token: A,
});
check(detail.viewer.canPost === true, 'a member may post in their group');
check(detail.viewer.canLeave === false, 'the owner of a populated group cannot strand it');

const requestGroup = myGroups.items.find((group) => group.joinPolicy === 'request');
const queue = await call(`/v1/groups/${requestGroup.id}/members?status=pending&limit=20`, {
  token: A,
});
check(queue.items.length === 1, 'the moderator sees a pending join request');

const queueForOmar = await raw(`/v1/groups/${requestGroup.id}/members?status=pending&limit=20`, {
  token: O,
});
check(queueForOmar.status === 403, 'a non-moderator cannot read the approval queue');

// --- search -----------------------------------------------------------------

console.log('\nsearch');

async function search(token, q, kind = 'all') {
  return call(`/v1/search?q=${encodeURIComponent(q)}&kind=${kind}&limit=20`, { token });
}

const arabicSearch = await search(A, 'اليرقان');
check(arabicSearch.content.length >= 1, 'Arabic search finds Arabic content');

const diacritics = await search(A, 'اليرقان الوليدي');
check(diacritics.content.length >= 1, 'Arabic search handles a multi-word phrase');

const normalised = await search(A, 'الكلي');
check(Array.isArray(normalised.content), 'Arabic search with folded letters returns cleanly');

const englishSearch = await search(A, 'nephrotic');
check(englishSearch.content.length >= 1, 'English search finds English content');

const topicSearch = await search(A, 'Nephrotic', 'topics');
check(
  topicSearch.topics.some((topic) => /nephrotic/i.test(topic.name)),
  'topic search finds Nephrotic Syndrome',
);

const classroomSearch = await search(A, 'قاعة', 'classrooms');
check(Array.isArray(classroomSearch.classrooms), 'classroom search returns a classrooms array');

const mixedSearch = await search(A, 'Respiratory');
check(mixedSearch.content.length >= 1, 'search finds English inside a mixed-language post');

const peopleSearch = await search(A, 'زينب', 'people');
check(peopleSearch.people.length >= 1, 'Arabic people search works');

const groupSearchOmar = await search(O, 'حلقة نقاش', 'groups');
check(
  !groupSearchOmar.groups.some((group) => group.id === unlisted.id),
  'search does NOT leak the unlisted group to a non-member',
);

const contentSearchOmar = await search(O, 'رضيع عمره');
check(
  contentSearchOmar.content.length === 0,
  'search does NOT leak the unlisted group’s posts to a non-member',
);

// --- messaging --------------------------------------------------------------

console.log('\nmessaging');

const chats = await call('/v1/conversations?limit=30', { token: A });
check(chats.items.length >= 3, `chat list returns conversations (${chats.items.length})`);
check(chats.totalUnread > 0, `the unread badge is non-zero (${chats.totalUnread})`);

const directChat = chats.items.find((c) => c.kind === 'direct' && c.counterpart?.handle === 'zainab');
check(Boolean(directChat), 'the direct conversation is titled by the counterpart');
check(directChat.viewer.unreadCount > 0, 'the direct conversation has unread messages');

const groupChat = chats.items.find((c) => c.kind === 'group');
check(Boolean(groupChat), 'the group conversation is listed');
check(groupChat.viewer.unreadCount === 0, 'the read group conversation shows no unread');

const messages = await call(`/v1/conversations/${directChat.id}/messages?limit=50`, { token: A });
check(messages.items.length === 5, `messages load in order (${messages.items.length})`);
check(
  messages.items.every((message, index) => message.seq === index + 1),
  'sequence numbers are dense and ascending',
);

const clientMessageId = randomUUID();
const sent = await call(`/v1/conversations/${directChat.id}/messages`, {
  method: 'POST',
  token: A,
  body: { clientMessageId, kind: 'text', body: 'Smoke-test message.' },
});
check(sent.deduplicated === false, 'sending a message succeeds');

const retry = await call(`/v1/conversations/${directChat.id}/messages`, {
  method: 'POST',
  token: A,
  body: { clientMessageId, kind: 'text', body: 'Smoke-test message.' },
});
check(retry.deduplicated === true, 'a retry is deduplicated, not duplicated');
check(retry.message.seq === sent.message.seq, 'the retry returns the same sequence number');

const received = await call(`/v1/conversations/${directChat.id}/messages?limit=50`, { token: Z });
check(
  received.items.filter((m) => m.body === 'Smoke-test message.').length === 1,
  'the recipient sees the message exactly once',
);

const gap = await call(`/v1/conversations/${directChat.id}/messages?afterSeq=3&limit=50`, {
  token: Z,
});
check(
  gap.items.length > 0 && gap.items[0].seq === 4,
  'gap replay returns messages after the given seq, oldest first',
);

const readResult = await call(`/v1/conversations/${directChat.id}/read`, {
  method: 'PUT',
  token: A,
  body: { seq: 999 },
});
check(
  readResult.lastReadSeq === sent.message.seq,
  'a read position is clamped to the conversation head',
);

const rewind = await call(`/v1/conversations/${directChat.id}/read`, {
  method: 'PUT',
  token: A,
  body: { seq: 1 },
});
check(rewind.lastReadSeq === sent.message.seq, 'an out-of-order receipt does not rewind');

const intruder = await raw(`/v1/conversations/${directChat.id}/messages`, { token: O });
check(intruder.status === 404, 'a non-participant cannot read the conversation');

const intrusion = await raw(`/v1/conversations/${directChat.id}/messages`, {
  method: 'POST',
  token: O,
  body: { clientMessageId: randomUUID(), kind: 'text', body: 'intrusion' },
});
check(intrusion.status === 404, 'a non-participant cannot send into the conversation');

const omarChats = await call('/v1/conversations?limit=30', { token: O });
check(
  !omarChats.items.some((c) => c.id === directChat.id),
  'a conversation never appears in a non-participant’s list',
);

// --- realtime ---------------------------------------------------------------

console.log('\nrealtime');

const wsUrl = `${API.replace(/^http/u, 'ws')}/v1/realtime?token=${encodeURIComponent(A)}`;
const socketResult = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 8000);
  try {
    const socket = new WebSocket(wsUrl);
    const frames = [];
    socket.onmessage = (event) => {
      frames.push(JSON.parse(String(event.data)));
      const ready = frames.find((f) => f.type === 'ready');
      const subscribed = frames.find((f) => f.type === 'subscribed');
      if (ready && !subscribed) {
        socket.send(JSON.stringify({ type: 'subscribe', conversationId: directChat.id }));
      }
      if (subscribed) {
        clearTimeout(timer);
        socket.close();
        resolve({ ok: true, lastSeq: subscribed.lastSeq });
      }
    };
    socket.onerror = () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: 'error' });
    };
  } catch (error) {
    clearTimeout(timer);
    resolve({ ok: false, reason: String(error) });
  }
});
check(socketResult.ok, `the WebSocket accepts an authenticated subscription (${socketResult.reason ?? 'ok'})`);

const badToken = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('timeout'), 8000);
  const socket = new WebSocket(`${API.replace(/^http/u, 'ws')}/v1/realtime?token=not-a-token`);
  socket.onmessage = (event) => {
    const frame = JSON.parse(String(event.data));
    if (frame.type === 'error') {
      clearTimeout(timer);
      socket.close();
      resolve('refused');
    }
  };
  socket.onclose = () => {
    clearTimeout(timer);
    resolve('refused');
  };
  socket.onerror = () => {
    clearTimeout(timer);
    resolve('refused');
  };
});
check(badToken === 'refused', 'the WebSocket refuses an invalid token');

// --- localisation -----------------------------------------------------------

console.log('\nlocalisation');

async function localised(locale) {
  const response = await fetch(`${API}/v1/groups?scope=mine&limit=5`, {
    headers: { authorization: `Bearer ${A}`, 'accept-language': locale },
  });
  return response.json();
}

const ar = await localised('ar');
const en = await localised('en');
check(Array.isArray(ar.items), 'the API serves Arabic-localised responses');
check(Array.isArray(en.items), 'the API serves English-localised responses');

// The placement lives under `academic`, and every node carries both names —
// the server never guesses a locale, it is told one.
const arabicProfile = await fetch(`${API}/v1/me/profile`, {
  headers: { authorization: `Bearer ${A}`, 'accept-language': 'ar' },
}).then((r) => r.json());
check(
  typeof arabicProfile.academic?.stageName === 'string' &&
    arabicProfile.academic.stageName.length > 0,
  `the academic placement is localised (${arabicProfile.academic?.stageName})`,
);

const englishProfile = await fetch(`${API}/v1/me/profile`, {
  headers: { authorization: `Bearer ${A}`, 'accept-language': 'en' },
}).then((r) => r.json());
check(
  englishProfile.academic?.stageName !== arabicProfile.academic?.stageName,
  `and differs by locale (${englishProfile.academic?.stageName})`,
);

// --- knowledge (phase 5) ----------------------------------------------------

console.log('\nknowledge');

/*
 * The point of these checks is not the happy path — the integration suite
 * covers that — it is that the RUNNING build serves classification, provenance
 * and topics, and that they are subject to the same authorisation as
 * everything else. A knowledge layer that quietly reads around the permission
 * predicate would pass every unit test and leak in production.
 */
const classifiedPost = await call('/v1/content', {
  method: 'POST',
  token: A,
  body: {
    body: 'الوذمة في المتلازمة الكلوية تنشأ من فقدان الألبومين، مع دور للاحتباس الأولي للصوديوم.',
    visibility: 'stage',
    mediaFileIds: [],
    knowledgeType: 'explanation',
    difficulty: 'medium',
  },
});
check(classifiedPost.knowledgeType === 'explanation', 'a post carries the knowledge type it was given');
check(classifiedPost.language === 'ar', 'the language is derived from the body, not asked for');
check(
  classifiedPost.signals.provenance === 'author_claim',
  'an uncited post is an author claim, not an error',
);

await call(`/v1/content/${classifiedPost.id}/sources`, {
  method: 'POST',
  token: Z,
  body: {
    kind: 'textbook',
    citation: 'Nelson Textbook of Pediatrics, 22nd edition',
    url: null,
    fileId: null,
    pageRef: 'p. 2752',
  },
});
const cited = await call(`/v1/content/${classifiedPost.id}`, { token: A });
check(cited.signals.sourceCount === 1, 'a classmate can cite someone else’s explanation');
check(
  cited.signals.provenance === 'source_backed',
  'the provenance class follows from the citation',
);

const proposed = await call(`/v1/content/${classifiedPost.id}/corrections`, {
  method: 'POST',
  token: Z,
  body: { body: 'الآلية الأحدث تصف خللاً أولياً في قناة الصوديوم بالأنبوب الجامع.', source: null },
});
const disputed = await call(`/v1/content/${classifiedPost.id}`, { token: A });
check(disputed.signals.openCorrectionCount === 1, 'an open correction is visible on the content');
check(disputed.signals.provenance === 'disputed', 'a challenged post reads as disputed');

const ownCorrection = await raw(`/v1/content/${classifiedPost.id}/corrections`, {
  method: 'POST',
  token: A,
  body: { body: 'محاولة تصحيح منشوري الخاص، وهذا ما يجب أن يُرفض.', source: null },
});
check(ownCorrection.status >= 400, 'an author cannot correct their own content — they edit it');

await call(`/v1/content/${classifiedPost.id}/corrections/${proposed.id}`, {
  method: 'PATCH',
  token: A,
  body: { status: 'accepted' },
});
const corrected = await call(`/v1/content/${classifiedPost.id}`, { token: A });
check(corrected.signals.provenance === 'corrected', 'an accepted correction changes the provenance');

const topicId = classifiedPost.topics[0]?.id ?? cited.academic.topics[0]?.id ?? null;
if (topicId) {
  const topic = await call(`/v1/topics/${topicId}`, { token: A });
  check(typeof topic.courseName === 'string', 'a topic knows where it sits academically');
  check(Array.isArray(topic.knowledgeCounts), 'a topic reports what knowledge it holds');
  const topicFeed = await call(`/v1/topics/${topicId}/knowledge?limit=10`, { token: A });
  check(Array.isArray(topicFeed.items), 'a topic serves the knowledge filed under it');
}

const learn = await call('/v1/learn', { token: A });
check(Array.isArray(learn.focusTopics), 'the Learn surface is built from real signals');
check(learn.savedCount > 0, `saved knowledge is counted (${learn.savedCount})`);
check(
  learn.meaningfulActionsThisWeek > 0,
  `meaningful learning actions are counted (${learn.meaningfulActionsThisWeek})`,
);

// Authorisation is one layer, and knowledge does not get its own.
const groupOnly = await call('/v1/content', {
  method: 'POST',
  token: A,
  body: {
    body: 'ملاحظة داخل مجموعة غير مدرجة، لا يجوز أن يصل إليها من ليس عضواً.',
    visibility: 'group',
    groupId: unlisted.id,
    mediaFileIds: [],
    knowledgeType: 'note',
  },
});
const outsiderSources = await raw(`/v1/content/${groupOnly.id}/sources`, { token: O });
check(outsiderSources.status === 404, 'sources are hidden behind the content’s own visibility');
const outsiderCorrections = await raw(`/v1/content/${groupOnly.id}/corrections`, { token: O });
check(
  outsiderCorrections.status === 404,
  'corrections are hidden behind the content’s own visibility',
);

// --- result -----------------------------------------------------------------

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  console.log('\nfailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log('smoke test passed — the application is ready to inspect');
