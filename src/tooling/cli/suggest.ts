function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  // oxlint-disable-next-line unicorn/no-new-array -- a write-only scratch row of the distance matrix; every slot is assigned before it is read
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min((current[j - 1] as number) + 1, (previous[j] as number) + 1, substitution);
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length] as number;
}

/** The one candidate closest to `input`, or `undefined` when none is close enough. @public */
export function suggest(input: string, candidates: readonly string[]): string | undefined {
  const limit = Math.max(1, Math.floor(input.length / 3));
  const target = input.toLowerCase();

  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const d = distance(target, candidate.toLowerCase());
    if (d <= limit && d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }

  return best;
}
