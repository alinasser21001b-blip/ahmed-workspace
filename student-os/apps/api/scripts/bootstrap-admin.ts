import { pathToFileURL } from 'node:url';
import { closePool, queryOne, withTransaction } from '../src/platform/db.js';

/**
 * Promotes an existing account to platform administrator.
 *
 * This writes directly to the database, and it is the one place in the system
 * that is allowed to. The reason is structural rather than convenient: only a
 * platform administrator may create a platform administrator, so the *first*
 * one cannot come through the API without leaving a self-service hole in it
 * forever. Bootstrapping is therefore an explicit operator action, performed
 * with database credentials, rather than a hidden default like "the first
 * account to sign up becomes an admin" — which is a backdoor with a friendly
 * name.
 *
 * It grants no academic authority. An administrator who also teaches gets
 * `instructor` through `PUT /v1/admin/users/:id/verification` like everyone
 * else, so the audit log records it.
 *
 *   pnpm --filter @sos/api admin:bootstrap someone@uob.edu.iq
 */

export interface BootstrapResult {
  userId: string;
  email: string;
  wasAlreadyAdmin: boolean;
}

export async function bootstrapPlatformAdmin(email: string): Promise<BootstrapResult> {
  const existing = await queryOne<{ id: string; email: string; role: string }>(
    `SELECT id, email, role FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
    [email],
  );
  if (!existing) throw new Error(`no account with email ${email}`);
  if (existing.role === 'admin') {
    return { userId: existing.id, email: existing.email, wasAlreadyAdmin: true };
  }

  await withTransaction(async (tx) => {
    await queryOne(
      `UPDATE users SET role = 'admin', updated_at = now() WHERE id = $1 RETURNING id`,
      [existing.id],
      tx,
    );
    /*
     * Audited like any other privileged change, with a null actor — because
     * there genuinely is no acting user, only whoever holds the database
     * credentials. Recording it as null is more honest than attributing it to
     * the promoted account, which did not perform it.
     */
    await queryOne(
      `INSERT INTO audit_log (actor_id, action, target_kind, target_id, before, after)
       VALUES (NULL, $1, 'user', $2, $3::jsonb, $4::jsonb) RETURNING id`,
      [
        'user.role.set',
        existing.id,
        JSON.stringify({ role: existing.role }),
        JSON.stringify({ role: 'admin', reason: 'out-of-band operator bootstrap' }),
      ],
      tx,
    );
  });

  return { userId: existing.id, email: existing.email, wasAlreadyAdmin: false };
}

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
