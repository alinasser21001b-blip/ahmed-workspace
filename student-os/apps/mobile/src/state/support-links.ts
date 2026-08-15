import type { SupportLinks } from '@sos/contracts';
import { useEffect, useState } from 'react';
import { useSession } from './session';

/**
 * The support/privacy/terms URLs (Guidelines 1.5, 5.1.1(i)).
 *
 * Fetched once and cached module-level, not per-screen: several screens read
 * this (Settings, the delete-account confirmation, the onboarding footer) and
 * the values change on the order of "the operator updated a config var", not
 * per session.
 */
let cached: SupportLinks | null = null;

const EMPTY: SupportLinks = {
  supportUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  supportEmail: null,
};

export function useSupportLinks(): SupportLinks {
  const { api } = useSession();
  const [links, setLinks] = useState<SupportLinks>(cached ?? EMPTY);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    api
      .get<SupportLinks>('/v1/support/links', { auth: false })
      .then((result) => {
        cached = result;
        if (!cancelled) setLinks(result);
      })
      .catch(() => {
        /* Rows simply do not render. Never a broken link in a shipped build. */
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return links;
}
