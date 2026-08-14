/**
 * The live status matrix for a deployed site.
 *
 *   node scripts/smoke-deployment.mjs https://deploy-preview-11--steady-longma-2cd2b7.netlify.app
 *
 * Everything else in this repository can be checked where the code is. This
 * cannot: it asks the deployment questions only the deployment can answer, and
 * it exists because the environment that builds this project cannot reach
 * netlify.app at all. Whoever can open the site can run this, and the output is
 * the evidence.
 *
 * It asserts the shape of the answers, not just that answers arrived. A 502 and
 * an HTML error page are the two failures this deployment has actually shipped,
 * so both are named rather than lumped into "not 200".
 */

const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!base) {
  process.stderr.write('\nusage: node scripts/smoke-deployment.mjs <site-url>\n\n');
  process.exit(1);
}

const failures = [];
const rows = [];

async function probe(label, path, init = {}) {
  const url = `${base}${path}`;
  try {
    const response = await fetch(url, { redirect: 'manual', ...init });
    const body = await response.text();
    return {
      label,
      path,
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      requestId: response.headers.get('x-request-id') ?? '',
      body,
    };
  } catch (error) {
    return { label, path, status: 0, contentType: '', requestId: '', body: String(error) };
  }
}

function expect(name, ok, detail) {
  rows.push({ name, ok, detail });
  if (!ok) failures.push(name);
}

const root = await probe('the page', '/');
expect('GET / is 200', root.status === 200, String(root.status));
expect('GET / serves HTML', root.contentType.includes('text/html'), root.contentType);

const ready = await probe('readiness', '/health/ready');
expect('GET /health/ready is 200', ready.status === 200, String(ready.status));
expect(
  'GET /health/ready is JSON',
  ready.contentType.includes('application/json'),
  ready.contentType || '(none)',
);
expect(
  'GET /health/ready reports ready',
  /"status"\s*:\s*"ready"/.test(ready.body),
  ready.body.slice(0, 120),
);

const login = await probe('rejected login', '/v1/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'definitely-not-a-real-account@uob.edu.iq',
    password: 'definitely-not-the-password',
  }),
});
expect(
  'a rejected login is 4xx, not 5xx',
  login.status >= 400 && login.status < 500,
  String(login.status),
);
expect(
  'a rejected login is JSON, not HTML',
  login.contentType.includes('application/json'),
  login.contentType || '(none)',
);

// The two failures this deployment has actually shipped to users, named so a
// regression reads as itself rather than as "something went wrong".
const allBodies = [root, ready, login];
expect(
  'no ERR_MODULE_NOT_FOUND anywhere',
  !allBodies.some((r) => /ERR_MODULE_NOT_FOUND|Cannot find package/.test(r.body)),
  '',
);
expect(
  'no stack frame is public',
  !allBodies.some((r) => /\bat\s+\S+\s+\(/.test(r.body) && !r.contentType.includes('text/html')),
  '',
);
expect(
  'no internal path is public',
  !allBodies.some((r) => /\/var\/task/.test(r.body)),
  '',
);

process.stdout.write(`\n  ${base}\n\n`);
for (const r of [root, ready, login]) {
  process.stdout.write(
    `  ${String(r.status).padEnd(4)} ${r.path.padEnd(18)} ${r.contentType.split(';')[0] || '-'}\n`,
  );
}
process.stdout.write('\n');
for (const { name, ok, detail } of rows) {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}\n`);
}

if (failures.length > 0) {
  // A 503 with the API's own envelope means the function loaded and something
  // behind it did not — a different fault from the module error, and worth
  // saying so rather than leaving the reader to guess which one they have.
  if (ready.status === 503 && ready.contentType.includes('application/json')) {
    process.stdout.write(
      `\n  The function is loading; boot is failing behind it.\n` +
        `  Correlation id: ${ready.requestId || '(none)'} — look it up in the function log.\n`,
    );
  }
  process.stderr.write(`\n✗ ${failures.length} check(s) failed\n\n`);
  process.exit(1);
}

process.stdout.write('\n✓ the deployment is healthy\n\n');
