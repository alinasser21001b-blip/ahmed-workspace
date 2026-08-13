import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

/**
 * E2E: two students, two browsers, one conversation.
 *
 * The Phase 4 exit criterion, as a test rather than a claim:
 *
 *   A sends → B receives it live, without reloading
 *   B replies → A receives it live
 *   B's connection drops mid-conversation
 *   A keeps sending
 *   B reconnects → the gap arrives, in order, with no duplicates
 *   A double-taps Send → one message, not two
 *
 * Two real browser contexts, one real API, one real database. The interruption
 * is a real one: the page goes offline at the network layer, which closes the
 * socket exactly as a lift or a lecture theatre would.
 *
 * Run:
 *   pnpm --filter @sos/api db:reset && pnpm --filter @sos/api db:seed
 *   pnpm dev:api &
 *   pnpm --filter @sos/mobile export:web && npx serve apps/mobile/dist -l 8081 --single &
 *   node apps/mobile/e2e/messaging.mjs
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:8081';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const SHOTS = process.env.E2E_SHOT_DIR ?? null;

const failures = [];
function check(condition, description) {
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    failures.push(description);
    console.log(`  ✗ ${description}`);
  }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// --- two onboarded students -------------------------------------------------

console.log('preparing two students in one cohort…');

const [university] = await api('/v1/academic/universities');
const [college] = await api(`/v1/academic/colleges?universityId=${university.id}`);
const [program] = await api(`/v1/academic/programs?collegeId=${college.id}`);
const stages = await api(`/v1/academic/stages?programId=${program.id}`);
const [year] = await api(`/v1/academic/academic-years?universityId=${university.id}`);

let stage = null;
let courses = [];
for (const candidate of stages) {
  const found = await api(`/v1/academic/courses?stageId=${candidate.id}`);
  if (found.length > 0) {
    stage = candidate;
    courses = found;
    break;
  }
}
if (!stage) throw new Error('no stage carries courses — is the seed applied?');
const topics = await api(`/v1/academic/topics?courseId=${courses[0].id}`);

const PASSWORD = 'correct-horse-battery';

async function student(prefix, displayName) {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const email = `${prefix}-${stamp}@uob.edu.iq`;
  const session = await api('/v1/auth/signup', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  const handle = `${prefix}_${stamp}`.slice(0, 30);
  await api('/v1/me/onboarding', {
    method: 'POST',
    token: session.tokens.accessToken,
    body: {
      handle,
      displayName,
      universityId: university.id,
      collegeId: college.id,
      programId: program.id,
      stageId: stage.id,
      academicYearId: year.id,
      interestTopicIds: [topics[0].id],
    },
  });
  return { email, handle, session, displayName };
}

const alice = await student('alice', 'أحمد الناصر');
const bob = await student('bob', 'زينب الحسيني');

const conversation = await api('/v1/conversations', {
  method: 'POST',
  token: alice.session.tokens.accessToken,
  body: { recipientHandle: bob.handle },
});
console.log(`  conversation ${conversation.id}\n`);

// --- two browsers -----------------------------------------------------------

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
if (SHOTS) await mkdir(SHOTS, { recursive: true });

async function openAs(person, label) {
  const context = await browser.newContext({
    viewport: { width: 420, height: 900 },
    locale: 'ar-IQ',
  });
  const errors = [];
  await context.addInitScript((tokens) => {
    window.localStorage.setItem('sos.access', tokens.accessToken);
    window.localStorage.setItem('sos.refresh', tokens.refreshToken);
  }, person.session.tokens);

  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(`${WEB_URL}/chat/${conversation.id}`);
  await page.waitForTimeout(2500);
  return { context, page, errors, label };
}

const A = await openAs(alice, 'alice');
const B = await openAs(bob, 'bob');

async function shot(name) {
  if (!SHOTS) return;
  await A.page.screenshot({ path: `${SHOTS}/messaging-${name}-alice.png`, fullPage: true });
  await B.page.screenshot({ path: `${SHOTS}/messaging-${name}-bob.png`, fullPage: true });
}

async function type(who, text) {
  const input = who.page.locator('textarea:visible, input:visible').first();
  await input.fill(text);
}

async function pressSend(who) {
  await who.page.getByLabel('إرسال').click();
}

async function bodies(who) {
  return who.page.evaluate(() =>
    Array.from(document.querySelectorAll('div'))
      .filter((el) => el.children.length === 0)
      .map((el) => (el.textContent ?? '').trim())
      .filter(Boolean),
  );
}

async function waitForText(who, text, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await bodies(who)).some((line) => line.includes(text))) return true;
    if (Date.now() > deadline) return false;
    await who.page.waitForTimeout(250);
  }
}

console.log('step 1 — a message arrives live, without a reload');

await type(A, 'مرحباً، هل راجعت المحاضرة؟');
await pressSend(A);
check(await waitForText(A, 'هل راجعت المحاضرة'), 'the sender sees their own message immediately');
check(await waitForText(B, 'هل راجعت المحاضرة'), 'the recipient receives it over the socket');
await shot('01-first');

console.log('step 2 — the reply comes back the same way');

await type(B, 'نعم، أنهيت النصف الأول.');
await pressSend(B);
check(await waitForText(A, 'أنهيت النصف الأول'), 'the reply arrives live for the first sender');

console.log('step 3 — the connection drops mid-conversation');

await B.context.setOffline(true);
await B.page.waitForTimeout(1200);

await type(A, 'رسالة أولى أثناء انقطاع الاتصال');
await pressSend(A);
await A.page.waitForTimeout(400);
await type(A, 'رسالة ثانية أثناء انقطاع الاتصال');
await pressSend(A);
await A.page.waitForTimeout(600);

check(
  !(await bodies(B)).some((line) => line.includes('رسالة أولى أثناء انقطاع')),
  'an offline client does not receive messages sent while it was away',
);
await shot('02-offline');

console.log('step 4 — reconnecting replays exactly the gap');

await B.context.setOffline(false);
// The client backs off before retrying; give it room to reconnect and resync.
await B.page.waitForTimeout(6000);

check(await waitForText(B, 'رسالة أولى أثناء انقطاع', 15000), 'the first missed message arrives');
check(await waitForText(B, 'رسالة ثانية أثناء انقطاع', 15000), 'the second missed message arrives');

const bobLines = await bodies(B);
const firstCount = bobLines.filter((line) => line.includes('رسالة أولى أثناء انقطاع')).length;
check(firstCount === 1, `the replayed message appears exactly once (saw ${firstCount})`);

const order = await B.page.evaluate(() => {
  const lines = Array.from(document.querySelectorAll('div'))
    .filter((el) => el.children.length === 0)
    .map((el) => (el.textContent ?? '').trim());
  return {
    first: lines.findIndex((line) => line.includes('رسالة أولى أثناء انقطاع')),
    second: lines.findIndex((line) => line.includes('رسالة ثانية أثناء انقطاع')),
  };
});
check(
  order.first !== -1 && order.second !== -1 && order.first < order.second,
  'the replayed messages are in the order they were sent',
);
await shot('03-resynced');

console.log('step 5 — a double tap on Send produces one message');

await type(A, 'ضغطة مزدوجة');
const sendButton = A.page.getByLabel('إرسال');
await sendButton.click();
await sendButton.click({ force: true }).catch(() => {});
await A.page.waitForTimeout(2500);

const doubleTap = await api(
  `/v1/conversations/${conversation.id}/messages?limit=100`,
  { token: alice.session.tokens.accessToken },
);
const duplicates = doubleTap.items.filter((m) => m.body === 'ضغطة مزدوجة').length;
check(duplicates === 1, `a double tap produced exactly one message (saw ${duplicates})`);

console.log('step 6 — the server is the ordering, and nothing was lost');

const stored = await api(`/v1/conversations/${conversation.id}/messages?limit=100`, {
  token: bob.session.tokens.accessToken,
});
const seqs = stored.items.map((m) => m.seq);
const dense = seqs.every((seq, index) => seq === index + 1);
check(dense, `sequence numbers are dense and gapless (${seqs.join(',')})`);
check(new Set(seqs).size === seqs.length, 'no sequence number is repeated');
check(stored.items.length === 5, `every message survived (${stored.items.length} of 5)`);

console.log('step 7 — read state');

const bobView = await api(`/v1/conversations/${conversation.id}`, {
  token: bob.session.tokens.accessToken,
});
check(
  bobView.viewer.unreadCount === 0,
  `the open thread has no unread messages (saw ${bobView.viewer.unreadCount})`,
);

const consoleErrors = [...A.errors, ...B.errors];
check(consoleErrors.length === 0, `no uncaught JS errors (saw ${consoleErrors.length}${consoleErrors.length ? `: ${consoleErrors[0].slice(0, 120)}` : ''})`);

await shot('04-final');
await browser.close();

if (failures.length > 0) {
  console.log(`\nFAILED — ${failures.length} check(s):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log('\ntwo-user messaging journey passed');
