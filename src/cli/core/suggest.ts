/**
 * Levenshtein distance, two rows at a time.
 *
 * Hand-written because the obvious reference imports `fastest-levenshtein`, which forge cannot
 * add, and because that reference's substring fast path makes a one-letter typo match every
 * candidate containing it — a suggestion that names four commands is not a suggestion.
 */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
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

/**
 * The one candidate closest to `input`, or `undefined` when none is close enough.
 *
 * The threshold scales with the input: one edit is always forgiven, and a third of the length
 * beyond that. Returns a single name rather than a list, because a line that offers three
 * alternatives has not narrowed anything down.
 * @public
 */
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
