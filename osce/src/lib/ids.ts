export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function nowIso(clock: () => Date = () => new Date()): string {
  return clock().toISOString();
}

export function pickRandom<T>(items: readonly T[], random: () => number = Math.random): T {
  if (items.length === 0) {
    throw new Error('Cannot pick from an empty collection.');
  }
  const index = Math.floor(random() * items.length);
  return items[index] as T;
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const current = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = current;
  }
  return copy;
}

export function remainingSeconds(endsAtIso: string, nowMs = Date.now()): number {
  const ends = Date.parse(endsAtIso);
  if (Number.isNaN(ends)) return 0;
  return Math.max(0, Math.ceil((ends - nowMs) / 1000));
}
