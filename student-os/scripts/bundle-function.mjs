import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * Produces the deployed API function as a self-contained file.
 *
 * WHY THIS EXISTS, precisely — the failure it fixes was silent in every local
 * check and fatal in production:
 *
 * Netlify packages v2 functions with nft (file tracing), NOT with esbuild.
 * `node_bundler = "esbuild"` in netlify.toml is accepted and then ignored for
 * them; the reproduction reported `bundler: nft` while the config asked for
 * esbuild. Tracing copies dependencies rather than inlining them, and it
 * resolves bare specifiers from the FUNCTION's directory. The adapter's own
 * code was inlined into `netlify/functions/api.mjs`, but every dependency the
 * API actually runs on — fastify, zod, pino, jose, @sos/contracts, @sos/core —
 * stayed a bare import resolvable only from `apps/api/node_modules`. So the
 * artifact shipped with exactly the three packages the repository root happens
 * to declare, and the first import Node reached threw:
 *
 *     Cannot find package 'zod' imported from /var/task/netlify/functions/api.mjs
 *
 * `zod` was not special. Adding it would have moved the error to `fastify`,
 * then `pino`, one deploy at a time.
 *
 * Bundling here instead of declaring dependencies somewhere is the choice that
 * cannot drift: the graph is derived from the real imports every build, so a
 * dependency added to the API tomorrow is included tomorrow, with nobody
 * remembering to list it. What ships is one file that imports nothing but Node
 * builtins, which is also the only shape a file tracer cannot get wrong.
 *
 * The migration SQL stays out of it deliberately — it is data, and it travels
 * through `included_files` in netlify.toml.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const ENTRY = join(root, 'netlify/api/handler.mts');
const OUT = join(root, 'netlify/functions/api.mjs');

/*
 * esbuild emits ESM, and several of the API's dependencies are CommonJS that
 * calls `require` for Node builtins at load time (`pg` reaches for `events`).
 * Without this, the output throws `Dynamic require of "events" is not
 * supported` on the first import — a failure that looks nothing like its cause.
 */
const BANNER =
  "import { createRequire as ___createRequire } from 'node:module';\n" +
  'const require = ___createRequire(import.meta.url);\n';

await rm(OUT, { force: true });
await mkdir(dirname(OUT), { recursive: true });

const result = await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: BANNER },
  // Nothing is external. That is the entire point: an artifact with no bare
  // imports has no resolution to fail.
  external: [],
  metafile: true,
  logLevel: 'warning',
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
process.stdout.write(
  `  packaged the API function: netlify/functions/api.mjs (${Math.round(bytes / 1024)} KB, ` +
    `${Object.keys(result.metafile.inputs).length} modules)\n`,
);
