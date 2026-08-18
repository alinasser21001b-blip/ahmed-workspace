import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { zipFunctions } from '@netlify/zip-it-and-ship-it';

/**
 * The deployment contract: does the function Netlify actually ships still load?
 *
 * Every check the pipeline had was green while production returned 502 to every
 * request, and that is not bad luck — none of them tested the deployed artifact.
 * Typecheck reads sources. Unit and integration tests import from `src` with the
 * whole workspace resolvable around them. The build proves `tsc` succeeds. The
 * thing that broke was none of those: it was what survives packaging, and it
 * broke in a way that only appears once the code has been copied somewhere that
 * its dependencies are not.
 *
 * So this runs the real bundler — `@netlify/zip-it-and-ship-it`, the package
 * Netlify itself uses — over the real function directory, unpacks the result,
 * and imports the handler out of the unpacked artifact in a process that has no
 * access to the repository's node_modules. If a dependency did not make it into
 * the zip, the import throws exactly as production did.
 *
 * Deliberately not a check for `zod`. `zod` was the first missing package in
 * alphabetical-import order and nothing more; a test that named it would have
 * gone green while `fastify` was still missing. The assertion is that the
 * artifact loads at all.
 */

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const notes = [];

function check(name, ok, detail = '') {
  const line = `${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`;
  process.stdout.write(`${line}\n`);
  if (!ok) failures.push(name);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// --- 1. package it the way Netlify does -------------------------------------

process.stdout.write('\nPackaging the function with Netlify\'s own bundler…\n');

if (!(await exists(join(root, 'netlify/functions/api.mjs')))) {
  process.stderr.write(
    '\n  ✗ netlify/functions/api.mjs does not exist. Run `node scripts/bundle-function.mjs` first.\n\n',
  );
  process.exit(1);
}

const workDir = await mkdtemp(join(tmpdir(), 'sos-function-package-'));
const zipDir = join(workDir, 'zip');
const unpacked = join(workDir, 'unpacked');

let packaged;
try {
  const results = await zipFunctions([join(root, 'netlify/functions')], zipDir, {
    basePath: root,
    repositoryRoot: root,
    // Mirrors netlify.toml. `includedFiles` is the only reason the migration
    // SQL travels at all — it is data, so nothing traces it.
    config: { '*': { includedFiles: ['apps/api/migrations/**'] } },
  });
  packaged = results[0];
} catch (error) {
  process.stderr.write(`\n  ✗ packaging failed: ${error.message}\n\n`);
  process.exit(1);
}

check('the function packages', Boolean(packaged), packaged ? `${packaged.name}, ${packaged.bundler}` : '');
notes.push(`bundler: ${packaged.bundler}`, `runtimeAPIVersion: ${packaged.runtimeAPIVersion}`);

await execFileAsync('unzip', ['-q', packaged.path, '-d', unpacked]);

// --- 2. the migration SQL has to be in there --------------------------------

const migrationsInArtifact = join(unpacked, 'apps/api/migrations');
const migrationFiles = (await exists(migrationsInArtifact))
  ? (await readdir(migrationsInArtifact)).filter((f) => f.endsWith('.sql'))
  : [];
const migrationFilesInRepo = (await readdir(join(root, 'apps/api/migrations'))).filter((f) =>
  f.endsWith('.sql'),
);

check(
  'the migration SQL is packaged',
  migrationFiles.length === migrationFilesInRepo.length && migrationFiles.length > 0,
  `${migrationFiles.length} of ${migrationFilesInRepo.length} files`,
);

// --- 3. the handler loads, out of the artifact, with nothing else around -----
//
// The subprocess runs from a temporary directory so that Node cannot walk up
// into the repository and resolve a dependency the artifact forgot. That walk
// is the whole reason this failure survived every local check.

const probe = `
  const { pathToFileURL } = require('node:url');
  (async () => {
    try {
      const mod = await import(pathToFileURL(process.argv[1]).href);
      const handler = mod.default;
      if (typeof handler !== 'function') throw new Error('no default export');
      const config = mod.config ?? null;
      process.stdout.write(JSON.stringify({ ok: true, hasConfig: Boolean(config), paths: config?.path ?? null }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, code: error.code ?? null, message: error.message }));
    }
  })();
`;

const handlerInArtifact = join(unpacked, 'netlify/functions/api.mjs');
let loadResult = { ok: false, message: 'probe did not run' };
try {
  const { stdout } = await execFileAsync('node', ['-e', probe, handlerInArtifact], {
    cwd: workDir,
    // No inherited resolution paths: the artifact stands on its own or it does not.
    env: { ...process.env, NODE_PATH: '' },
    maxBuffer: 10 * 1024 * 1024,
  });
  loadResult = JSON.parse(stdout);
} catch (error) {
  loadResult = { ok: false, message: error.message };
}

check(
  'the packaged handler imports',
  loadResult.ok === true,
  loadResult.ok ? '' : `${loadResult.code ?? 'error'}: ${loadResult.message}`,
);

if (loadResult.code === 'ERR_MODULE_NOT_FOUND') {
  process.stderr.write(
    '\n  A dependency did not survive packaging. This is the production failure:\n' +
      '  the artifact is copied away from the repository, so anything left as a\n' +
      `  bare import has nothing to resolve against.\n  ${loadResult.message}\n`,
  );
}

check(
  'the handler declares its routes',
  loadResult.ok === true && loadResult.hasConfig === true,
  loadResult.paths ? JSON.stringify(loadResult.paths) : '',
);

// --- 4. nothing has to be resolved when the module loads --------------------
//
// Only ESM import specifiers, because those are what `ERR_MODULE_NOT_FOUND`
// comes from: they are resolved when the module loads, before a line of the
// handler runs, and one missing package makes every route a 502.
//
// Runtime `require` is deliberately NOT asserted on here. `ajv` and
// `fast-json-stringify` compile validators and serialisers by generating source
// as a string, and that generated source requires their runtime helpers by
// path. No bundler can inline a specifier that does not exist until it is
// evaluated. Whether those paths are ever reached is a question about
// behaviour, not about packaging — so it is answered below by sending real
// requests through the artifact rather than by reading it.

const artifactSource = await readFile(handlerInArtifact, 'utf8');

const IMPORT_STATEMENT =
  /\b(?:import|export)\s*(?:[\s\S]{0,200}?\bfrom\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.-]+)*$/i;

/** Both spellings are the same module; `node:` is optional for every builtin. */
const isBuiltin = (name) =>
  builtinModules.includes(name) ||
  (name.startsWith('node:') && builtinModules.includes(name.slice('node:'.length)));

const bareImports = [
  ...new Set(
    [...artifactSource.matchAll(IMPORT_STATEMENT)]
      .map((m) => m[1] ?? m[2])
      .filter((name) => typeof name === 'string')
      .filter((name) => !name.startsWith('.') && !name.startsWith('/'))
      .filter((name) => PACKAGE_NAME.test(name))
      .filter((name) => !isBuiltin(name)),
  ),
];

check(
  'the artifact imports nothing it does not carry',
  bareImports.length === 0,
  bareImports.length ? bareImports.join(', ') : '',
);

// --- 5. a boot failure must not leak internals ------------------------------
//
// The public 502 that started this exposed stack frames, `/var/task` paths and
// package names. The reply is public; an exception message is not written for
// the public.

const leakProbe = `
  const { pathToFileURL } = require('node:url');
  (async () => {
    const mod = await import(pathToFileURL(process.argv[1]).href);
    const response = await mod.default(new Request('https://example.invalid/health/ready'));
    const body = await response.text();
    process.stdout.write(JSON.stringify({
      status: response.status,
      contentType: response.headers.get('content-type'),
      requestIdHeader: response.headers.get('x-request-id'),
      body,
    }));
  })().catch((error) => {
    process.stdout.write(JSON.stringify({ threw: error.message }));
  });
`;

let leak = { threw: 'probe did not run' };
try {
  const { stdout } = await execFileAsync('node', ['-e', leakProbe, handlerInArtifact], {
    cwd: workDir,
    env: {
      ...process.env,
      NODE_PATH: '',
      NODE_ENV: 'production',
      // Unroutable on purpose: boot must fail, so that what a failed boot says
      // to the public is what gets inspected.
      DATABASE_URL: 'postgres://probe:hunter2@10.255.255.1:5432/nothing',
      JWT_SECRET: 'a-secret-that-is-at-least-thirty-two-characters-long',
      MEDIA_URL_SECRET: 'another-secret-that-is-at-least-thirty-two-chars',
      STORAGE_DRIVER: 'external',
      LOG_LEVEL: 'silent',
      BOOTSTRAP_ADMIN_EMAIL: '',
      BOOTSTRAP_ADMIN_PASSWORD: '',
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  leak = JSON.parse(stdout);
} catch (error) {
  leak = { threw: error.message };
}

check('a failed boot answers with JSON', leak.contentType?.includes('application/json') === true, leak.contentType ?? String(leak.threw));
check('a failed boot answers 503', leak.status === 503, String(leak.status ?? leak.threw));

// Substrings that must never reach a caller. Each one is a thing the previous
// public error actually carried, or a secret this probe deliberately supplied.
const FORBIDDEN = [
  ['a stack frame', /\bat\s+\S+\s+\(/],
  ['a filesystem path', /\/var\/task|\/home\/|\/Users\//],
  ['a connection string', /postgres(?:ql)?:\/\//i],
  ['the database password', /hunter2/],
  ['a JWT secret', /a-secret-that-is-at-least/],
  ['an internal module name', /node_modules|ERR_MODULE_NOT_FOUND|ECONNREFUSED|ETIMEDOUT/],
];

const body = String(leak.body ?? '');
for (const [label, pattern] of FORBIDDEN) {
  check(`the public error hides ${label}`, !pattern.test(body), pattern.test(body) ? body.slice(0, 160) : '');
}

check(
  'the public error carries a correlation id',
  typeof leak.requestIdHeader === 'string' && leak.requestIdHeader.length > 0,
  leak.requestIdHeader ?? 'missing',
);

// --- 5b. NODE_ENV is not left to chance -------------------------------------
//
// Nothing in netlify.toml, the build script, or (until now) the handler
// itself ever set NODE_ENV for the deployed function — every real cold start
// ran with it unset, which the config schema defaults to 'development'. Two
// safety checks in `apps/api`'s config key on NODE_ENV === 'production'
// (refusing STORAGE_DRIVER=local, requiring MEDIA_URL_SECRET), and with the
// default in effect neither ever fired — MEDIA_URL_SECRET quietly fell back
// to reusing JWT_SECRET on the real deployment, unnoticed, because every
// check elsewhere in this file supplies NODE_ENV: 'production' itself and so
// never exercised the condition a real deploy is actually in.
//
// The fix lives in `handler.mts`'s boot(): `process.env.NODE_ENV ??=
// 'production'`. This probe is the one place that must NOT also set
// NODE_ENV — deliberately omitting it (and STORAGE_DRIVER, and
// MEDIA_URL_SECRET, matching the live site's actual env-var shape) is what
// makes this a real test of the fallback rather than a restatement of the
// other probes above.
//
// The public response redacts why boot failed — correctly, that is what
// section 5 above asserts — so the proof has to come from the server's own
// `console.error('[boot] the API failed to start', error)`, on stderr. That
// is a plain console call, not routed through the pino logger, so it is
// NOT silenced by LOG_LEVEL — this probe leaves LOG_LEVEL unset entirely so
// nothing suppresses it. With STORAGE_DRIVER left at its 'local' default,
// config.ts refuses to boot for exactly one reason ("STORAGE_DRIVER=local
// is not permitted in production") ONLY when it believes it is in
// production — so that string appearing on stderr is the fallback working,
// and its absence (boot succeeding, or failing some other way) means it is
// not.

const { NODE_ENV: _ambientNodeEnv, LOG_LEVEL: _ambientLogLevel, ...envWithoutNodeEnv } =
  process.env;
void _ambientNodeEnv;
void _ambientLogLevel;

const nodeEnvProbe = `
  const { pathToFileURL } = require('node:url');
  (async () => {
    const mod = await import(pathToFileURL(process.argv[1]).href);
    const response = await mod.default(new Request('https://example.invalid/health/ready'));
    const body = await response.text();
    process.stdout.write(JSON.stringify({ status: response.status, body }));
  })().catch((error) => {
    process.stdout.write(JSON.stringify({ threw: error.message }));
  });
`;

let nodeEnvDefault = { threw: 'probe did not run' };
let nodeEnvStderr = '';
try {
  const { stdout, stderr } = await execFileAsync('node', ['-e', nodeEnvProbe, handlerInArtifact], {
    cwd: workDir,
    env: {
      ...envWithoutNodeEnv,
      NODE_PATH: '',
      // Deliberately absent: NODE_ENV, STORAGE_DRIVER, MEDIA_URL_SECRET,
      // LOG_LEVEL — the exact set of variables the live site does not
      // currently set (LOG_LEVEL excluded so the diagnostic isn't silenced).
      DATABASE_URL: 'postgres://probe:hunter2@10.255.255.1:5432/nothing',
      JWT_SECRET: 'a-secret-that-is-at-least-thirty-two-characters-long',
      BOOTSTRAP_ADMIN_EMAIL: '',
      BOOTSTRAP_ADMIN_PASSWORD: '',
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  nodeEnvDefault = JSON.parse(stdout);
  nodeEnvStderr = stderr;
} catch (error) {
  nodeEnvDefault = { threw: error.message };
}

check(
  'with NODE_ENV unset, the handler still defaults it to production',
  nodeEnvDefault.status === 503 &&
    nodeEnvStderr.includes('STORAGE_DRIVER=local is not permitted in production'),
  `${JSON.stringify(nodeEnvDefault).slice(0, 200)} · stderr: ${nodeEnvStderr.slice(0, 200)}`,
);

// --- 6. real requests, through the artifact, against a real database --------
//
// The strongest thing this file can assert, and the only one that covers what a
// static read cannot: that the packaged function serves. Generated `require`
// paths inside ajv and fast-json-stringify, a serialiser that was never
// constructed, a plugin that fails on first use — none of those show up in the
// module graph, and all of them show up here.
//
// Skipped rather than failed when no database is offered, so the contract still
// runs on a laptop; CI always offers one.

const liveDatabaseUrl = process.env.VERIFY_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

if (!liveDatabaseUrl) {
  process.stdout.write(
    '\n  · live request checks skipped (set VERIFY_DATABASE_URL to run them)\n',
  );
} else {
  const requestProbe = `
    const { pathToFileURL } = require('node:url');
    (async () => {
      const mod = await import(pathToFileURL(process.argv[1]).href);
      const call = async (method, path, body) => {
        const init = { method };
        if (body !== undefined) {
          init.body = JSON.stringify(body);
          init.headers = { 'content-type': 'application/json' };
        }
        const response = await mod.default(new Request('https://example.invalid' + path, init));
        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          body: (await response.text()).slice(0, 400),
        };
      };
      const ready = await call('GET', '/health/ready');
      const badLogin = await call('POST', '/v1/auth/login', {
        email: 'definitely-not-a-real-account@uob.edu.iq',
        password: 'definitely-not-the-password',
      });
      const missing = await call('GET', '/v1/there-is-no-such-route');
      process.stdout.write(JSON.stringify({ ready, badLogin, missing }));
    })().catch((error) => {
      process.stdout.write(JSON.stringify({ threw: error.message }));
    });
  `;

  let live = { threw: 'probe did not run' };
  try {
    const { stdout } = await execFileAsync('node', ['-e', requestProbe, handlerInArtifact], {
      cwd: workDir,
      env: {
        ...process.env,
        NODE_PATH: '',
        NODE_ENV: 'production',
        DATABASE_URL: liveDatabaseUrl,
        JWT_SECRET: 'a-secret-that-is-at-least-thirty-two-characters-long',
        MEDIA_URL_SECRET: 'another-secret-that-is-at-least-thirty-two-chars',
        STORAGE_DRIVER: 'external',
        LOG_LEVEL: 'silent',
        BOOTSTRAP_ADMIN_EMAIL: '',
        BOOTSTRAP_ADMIN_PASSWORD: '',
      },
      maxBuffer: 10 * 1024 * 1024,
    });
    live = JSON.parse(stdout);
  } catch (error) {
    live = { threw: error.message };
  }

  if (live.threw) {
    check('the packaged function serves requests', false, live.threw);
  } else {
    check(
      'GET /health/ready is 200 and reports readiness',
      live.ready.status === 200 && /"status":"ready"/.test(live.ready.body),
      `${live.ready.status} ${live.ready.body.slice(0, 90)}`,
    );
    check(
      'a rejected login is 4xx JSON, not 502 and not HTML',
      live.badLogin.status >= 400 &&
        live.badLogin.status < 500 &&
        live.badLogin.contentType?.includes('application/json') === true,
      `${live.badLogin.status} ${live.badLogin.contentType}`,
    );
    check(
      'an unknown route is 404 JSON',
      live.missing.status === 404 && live.missing.contentType?.includes('application/json') === true,
      `${live.missing.status} ${live.missing.contentType}`,
    );
    check(
      'a rejected login leaks no stack frame',
      !/\bat\s+\S+\s+\(/.test(live.badLogin.body),
      '',
    );
  }
}

await rm(workDir, { recursive: true, force: true });

process.stdout.write(`\n  ${notes.join('  ·  ')}\n`);

if (failures.length > 0) {
  process.stderr.write(`\n✗ deployment contract failed: ${failures.join('; ')}\n\n`);
  process.exit(1);
}

process.stdout.write('\n✓ the packaged function loads and fails safely\n\n');
