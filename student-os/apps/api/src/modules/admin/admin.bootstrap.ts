import { queryOne, withTransaction } from '../../platform/db.js';
import * as authRepo from '../auth/auth.repository.js';
import { hashPassword } from '../auth/password.js';

/**
 * The first platform administrator.
 *
 * Only a platform administrator may create a platform administrator, so the
 * first one cannot come through the API without leaving a self-service hole in
 * it forever. Making it an operator action instead is the whole point — and the
 * operator is identified by holding the deployment's credentials, whether those
 * are a database connection string on a laptop or a configured secret on a host.
 *
 * What this is NOT, and must never become: "the first account to sign up
 * becomes an admin". That is a backdoor with a friendly name — unnamed,
 * unauthenticated, and winnable by whoever is fastest. Everything here names a
 * specific address in advance and requires a secret to be supplied alongside it.
 *
 * Lives in `src` rather than `scripts` because it has three callers that must
 * not drift: the `admin:bootstrap` CLI, the demo seed, and a deployment host
 * with no shell to run either from.
 */

export interface BootstrapResult {
  userId: string;
  email: string;
  wasAlreadyAdmin: boolean;
}

/**
 * Promotes an existing account.
 *
 * Grants no academic authority: an administrator who also teaches gets
 * `instructor` through `PUT /v1/admin/users/:id/verification` like everyone
 * else, so the audit log records who granted it and when.
 */
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
     * there genuinely is no acting user, only whoever holds the credentials.
     * Recording it as null is more honest than attributing it to the promoted
     * account, which did not perform it.
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

/** Rejected below rather than at the call site, so every caller gets the rule. */
const MIN_BOOTSTRAP_PASSWORD_LENGTH = 12;

export interface EnsureBootstrapAdminInput {
  email: string;
  password: string;
  locale?: 'ar' | 'en';
}

/**
 * Makes sure the named account exists and is an administrator.
 *
 * For a host that has no shell: a fresh deployment starts with an empty
 * database and therefore with nobody who can administer it, and there is no
 * `psql` to fix that from. The deployment's own configuration names the address
 * and supplies the password, which is the same authority as holding the
 * database credentials — just expressed in the only place this kind of host
 * has.
 *
 * Idempotent in both halves: an existing account is promoted rather than
 * recreated, and an existing administrator is left entirely alone. It never
 * touches the password of an account it did not create — otherwise every
 * restart would silently reset a password its owner had since changed.
 */
export async function ensureBootstrapAdmin(
  input: EnsureBootstrapAdminInput,
): Promise<BootstrapResult & { created: boolean }> {
  const email = input.email.trim();
  if (!email.includes('@')) throw new Error('bootstrap admin email is not an address');
  if (input.password.length < MIN_BOOTSTRAP_PASSWORD_LENGTH) {
    throw new Error(
      `bootstrap admin password must be at least ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters`,
    );
  }

  const existing = await authRepo.findUserByEmail(email);

  if (!existing) {
    // `insertUser` is the one place an account is created, here as in signup;
    // what signup adds on top is a session, which nothing needs yet.
    await authRepo.insertUser({
      email,
      passwordHash: await hashPassword(input.password),
      locale: input.locale ?? 'ar',
    });
    return { ...(await bootstrapPlatformAdmin(email)), created: true };
  }

  return { ...(await bootstrapPlatformAdmin(email)), created: false };
}
