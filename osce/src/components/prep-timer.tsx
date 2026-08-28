'use client';

import { useEffect, useState } from 'react';
import { formatTimer } from '@/domain/text/arabic';
import { remainingSeconds } from '@/lib/ids';

export function PrepTimer({
  endsAt,
  onElapsed,
}: {
  endsAt: string;
  onElapsed: () => void;
}) {
  const [remaining, setRemaining] = useState(() => remainingSeconds(endsAt));

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const next = remainingSeconds(endsAt);
      setRemaining(next);
      if (next <= 0) {
        onElapsed();
        return;
      }
      frame = window.setTimeout(tick, 250);
    };
    tick();
    return () => window.clearTimeout(frame);
  }, [endsAt, onElapsed]);

  return (
    <p className={`timer${remaining <= 30 ? ' warn' : ''}`} aria-live="polite" aria-atomic="true">
      {formatTimer(remaining)}
    </p>
  );
}
