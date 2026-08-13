import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

/**
 * Screenshot capture for a product review.
 *
 * Drives the REAL running client against the REAL API and the REAL demo
 * database — the same bundle a browser would load. Nothing here renders a
 * component in isolation or stubs a response; if a screen is broken, the
 * screenshot shows it broken.
 *
 * Every screen is captured in Arabic (RTL, phone) and English (LTR, desktop),
 * because those are the two combinations where layout actually differs.
 *
 *   E2E_SHOT_DIR=/tmp/review node apps/mobile/e2e/capture.mjs
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:8081';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const SHOTS = process.env.E2E_SHOT_DIR ?? '/tmp/review-shots';
const PASSWORD = 'correct-horse-battery';

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const amjad = await api('/v1/auth/login', {
  method: 'POST',
  body: { email: 'amjad@uob.edu.iq', password: PASSWORD },
});
const token = amjad.tokens.accessToken;

// Every id comes from the running system, so a screenshot cannot point at
// something the product would not have produced.
const feed = await api('/v1/feed?scope=recent&limit=20', { token });
const postWithComments = feed.items.find((item) => item.commentCount > 0) ?? feed.items[0];

const groups = await api('/v1/groups?scope=mine&limit=20', { token });
const openGroup = groups.items.find((group) => group.joinPolicy === 'open') ?? groups.items[0];
const requestGroup = groups.items.find((group) => group.joinPolicy === 'request');

const conversations = await api('/v1/conversations?limit=20', { token });
const directChat = conversations.items.find((c) => c.kind === 'direct');
const groupChat = conversations.items.find((c) => c.kind === 'group');

const SCREENS = [
  { n: 1, name: 'home-feed', path: '/' },
  { n: 2, name: 'post-detail', path: `/post/${postWithComments.id}` },
  { n: 3, name: 'create-post', path: '/compose' },
  { n: 4, name: 'search', path: '/search' },
  { n: 5, name: 'groups', path: '/(tabs)/groups' },
  { n: 6, name: 'group-detail', path: `/group/${openGroup.id}` },
  { n: 6.5, name: 'group-detail-requests', path: `/group/${requestGroup.id}` },
  { n: 7, name: 'profile', path: '/profile/zainab' },
  { n: 8, name: 'chat-list', path: '/(tabs)/chat' },
  { n: 9, name: 'direct-conversation', path: `/chat/${directChat.id}` },
  { n: 10, name: 'group-conversation', path: `/chat/${groupChat.id}` },
  { n: 11, name: 'learn', path: '/(tabs)/learn' },
  { n: 12, name: 'create-group', path: '/group/new' },
];

const VARIANTS = [
  { key: 'ar-phone', locale: 'ar-IQ', width: 390, height: 844 },
  { key: 'en-desktop', locale: 'en-GB', width: 1440, height: 900 },
];

await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);

let captured = 0;
for (const variant of VARIANTS) {
  const context = await browser.newContext({
    viewport: { width: variant.width, height: variant.height },
    locale: variant.locale,
  });

  // A fresh session per context: refresh tokens rotate, and replaying one
  // across contexts is correctly treated as theft.
  const session = await api('/v1/auth/login', {
    method: 'POST',
    body: { email: 'amjad@uob.edu.iq', password: PASSWORD },
  });
  await context.addInitScript((tokens) => {
    if (!window.localStorage.getItem('sos.access')) {
      window.localStorage.setItem('sos.access', tokens.accessToken);
      window.localStorage.setItem('sos.refresh', tokens.refreshToken);
    }
  }, session.tokens);

  const page = await context.newPage();

  for (const screen of SCREENS) {
    await page.goto(`${WEB_URL}${screen.path}`);
    await page.waitForTimeout(1800);

    // The search screen is empty until something is typed; type a real query so
    // the screenshot shows results rather than a placeholder.
    if (screen.name === 'search') {
      const input = page.locator('input:visible').first();
      await input.fill(variant.locale.startsWith('ar') ? 'اليرقان' : 'nephrotic');
      await page.waitForTimeout(1800);
    }

    const file = `${SHOTS}/${String(screen.n).padStart(4, '0')}-${screen.name}-${variant.key}.png`;
    await page.screenshot({ path: file, fullPage: true });
    captured += 1;
    console.log(`  ${variant.key}  ${screen.name}`);
  }

  await context.close();
}

await browser.close();
console.log(`\n${captured} screenshots in ${SHOTS}`);
