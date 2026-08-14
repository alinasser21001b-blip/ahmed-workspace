import { pathToFileURL } from 'node:url';
import { bootstrapPlatformAdmin } from '../src/modules/admin/admin.bootstrap.js';
import { closePool } from '../src/platform/db.js';

/**
 * `pnpm --filter @sos/api admin:bootstrap someone@uob.edu.iq`
 *
 * A thin wrapper. The rule about who may become an administrator, and why the
 * first one cannot come through the API, lives in
 * `src/modules/admin/admin.bootstrap.ts` — where a deployment host can reach it
 * too.
 */

export { bootstrapPlatformAdmin } from '../src/modules/admin/admin.bootstrap.js';
export type { BootstrapResult } from '../src/modules/admin/admin.bootstrap.js';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    process.stderr.write('usage: admin:bootstrap <email>\n');
    process.exit(1);
  }
  const result = await bootstrapPlatformAdmin(email);
  process.stdout.write(
    result.wasAlreadyAdmin
      ? `${result.email} is already a platform administrator\n`
      : `${result.email} is now a platform administrator\n`,
  );
  await closePool();
}

// Only when invoked as a CLI. `seed-demo` imports the function instead, so the
// two cannot drift on what "make an administrator" means.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
