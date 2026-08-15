import { getLogger } from './logger.js';

/**
 * Outbound email — the one integration point, currently unwired.
 *
 * `config.ts`'s environment schema has no SMTP host, no provider API key, no
 * "from" address — nothing. There has never been a way for this service to
 * send an email, and this file does not invent one. What it provides is the
 * single function a real provider gets wired into later, so that the day
 * someone adds `RESEND_API_KEY` to the environment, exactly one function body
 * changes and nothing that calls it does.
 *
 * `EXTERNAL_INFRASTRUCTURE_REQUIRED`: shipping password reset to production
 * needs this function replaced with a real provider call. Everything upstream
 * of it — the token lifecycle, the hashing, the expiry, the single-use
 * enforcement, the session revocation on redemption — is complete and tested
 * without it, because none of that depends on how the token reaches the user,
 * only on the token existing and being verifiable.
 *
 * Deliberately not attempted: writing the reset link to the server log as a
 * stand-in for email. That is not a smaller version of sending an email, it
 * is a credential leaked into every log aggregator with read access to this
 * service — worse than not delivering it at all. The warning below names the
 * gap; it does not paper over it.
 */

export interface PasswordResetDelivery {
  userId: string;
  /** The plaintext token. Exists only in memory, only for the duration of this call. */
  token: string;
}

export async function deliverPasswordResetEmail(input: PasswordResetDelivery): Promise<void> {
  getLogger().warn(
    { userId: input.userId },
    'EXTERNAL_INFRASTRUCTURE_REQUIRED: no email provider is configured; ' +
      'a password reset token was minted and could not be delivered to the user',
  );
}
