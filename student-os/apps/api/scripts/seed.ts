import { seedAcademicHierarchy } from '../src/modules/academic/academic.seed.js';
import { closePool } from '../src/platform/db.js';

/**
 * `pnpm db:seed` — the academic hierarchy.
 *
 * A thin wrapper. The seed itself lives in `src/modules/academic/academic.seed.ts`
 * so that a deployment host, which has no shell and no `tsx`, can call the same
 * code path this command does.
 */

seedAcademicHierarchy()
  .then(async () => {
    process.stdout.write('seeded University of Baghdad → College of Medicine → Stage 5\n');
    await closePool();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`seed failed: ${(error as Error).message}\n`);
    await closePool().catch(() => {});
    process.exit(1);
  });
