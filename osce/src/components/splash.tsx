'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/app/providers';
import { t } from '@/i18n/copy';

const DURATION_MS = 1700;

export function Splash({ onDone }: { onDone: () => void }) {
  const { locale } = useLocale();
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hold = reduced ? 400 : DURATION_MS;
    const exitAt = window.setTimeout(() => setExiting(true), hold - 280);
    const doneAt = window.setTimeout(onDone, hold);
    return () => {
      window.clearTimeout(exitAt);
      window.clearTimeout(doneAt);
    };
  }, [onDone]);

  return (
    <div className={`splash${exiting ? ' exit' : ''}`} role="img" aria-label="OSCE">
      <div className="splash-inner">
        <p className="wordmark">OSCE</p>
        <div className="splash-rule" />
        <p>{t(locale).tagline}</p>
      </div>
    </div>
  );
}
