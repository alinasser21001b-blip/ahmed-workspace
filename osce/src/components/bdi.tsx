'use client';

import type { ReactNode } from 'react';

export function Bdi({ children }: { children: ReactNode }) {
  return <bdi className="latin-run">{children}</bdi>;
}
