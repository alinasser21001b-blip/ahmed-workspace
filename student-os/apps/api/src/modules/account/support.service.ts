import type { SupportLinks } from '@sos/contracts';
import { getConfig } from '../../platform/config.js';

/**
 * Where the app sends someone who needs help, or the privacy policy.
 *
 * Guideline 1.5 ("Make sure your app and its Support URL include an easy way to
 * contact you; this is particularly important for apps that may be used in the
 * classroom") and Guideline 5.1.1(i) ("All apps must include a link to their
 * privacy policy in the App Store Connect metadata field AND within the app in
 * an easily accessible manner").
 *
 * These are configuration, not code, and they are served rather than bundled.
 * A privacy policy URL baked into a binary can only be corrected by shipping a
 * new build through App Review; served, it is a deploy. That matters because
 * Guideline 2.1 rejects placeholder URLs, so getting one wrong is not a small
 * mistake.
 *
 * Null is returned for anything unset, and the client draws nothing rather than
 * a dead control. What stops a build shipping in that state is
 * `pnpm appstore:check`, which fails when these are missing or still look like
 * placeholders — the check belongs at the release gate, not in a request
 * handler that would then 500 for every user because someone forgot a variable.
 */
export function links(): SupportLinks {
  const { env } = getConfig();
  return {
    supportUrl: env.SUPPORT_URL ?? null,
    privacyPolicyUrl: env.PRIVACY_POLICY_URL ?? null,
    termsUrl: env.TERMS_URL ?? null,
    supportEmail: env.SUPPORT_EMAIL ?? null,
  };
}
