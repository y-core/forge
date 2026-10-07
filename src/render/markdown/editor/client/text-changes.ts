import type { TextChange } from "./types";

const MAX_LINE_EDITS = 1000;

interface LineHunk {
  readonly fromA: number;
  readonly toA: number;
  readonly fromB: number;
  readonly toB: number;
}

function splitLines(text: string): string[] {
  const parts = text.split("\n");
  return parts.map((part, index) => (index < parts.length - 1 ? `${part}\n` : part));
}

function lineOffsets(lines: readonly string[]): number[] {
  const offsets = [0];
  for (const line of lines) offsets.push((offsets.at(-1) ?? 0) + line.length);
  return offsets;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function trimmedChange(before: string, from: number, to: number, insert: string): TextChange | undefined {
  const removed = before.slice(from, to);
  const shorter = Math.min(removed.length, insert.length);
  let head = 0;
  while (head < shorter && removed.charCodeAt(head) === insert.charCodeAt(head)) head += 1;
  if (head > 0 && isHighSurrogate(removed.charCodeAt(head - 1))) head -= 1;
  let tail = 0;
  while (tail < shorter - head && removed.charCodeAt(removed.length - 1 - tail) === insert.charCodeAt(insert.length - 1 - tail)) tail += 1;
  if (tail > 0 && isLowSurrogate(removed.charCodeAt(removed.length - tail))) tail -= 1;
  if (removed.length === head + tail && insert.length === head + tail) return undefined;
  return { from: from + head, to: to - tail, insert: insert.slice(head, insert.length - tail) };
}

function backtrack(trace: readonly Int32Array[], fromA: number, fromB: number, toA: number, toB: number): LineHunk[] {
  const hunks: LineHunk[] = [];
  let x = toA - fromA;
  let y = toB - fromB;
  for (let d = trace.length - 1; d > 0; d -= 1) {
    const previous = trace[d] as Int32Array;
    const at = (k: number): number => previous[k + d] as number;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const last = hunks.at(-1);
    const step = { fromA: fromA + prevX, toA: fromA + (down ? prevX : prevX + 1), fromB: fromB + prevY, toB: fromB + (down ? prevY + 1 : prevY) };
    if (last !== undefined && last.fromA === step.toA && last.fromB === step.toB)
      hunks[hunks.length - 1] = { ...step, toA: last.toA, toB: last.toB };
    else hunks.push(step);
    x = prevX;
    y = prevY;
  }
  return hunks.reverse();
}

// Myers' O(ND) shortest edit script, bounded so a wholesale rewrite costs one hunk rather than a quadratic search.
function lineHunks(a: readonly string[], b: readonly string[], fromA: number, fromB: number, toA: number, toB: number): LineHunk[] {
  const n = toA - fromA;
  const m = toB - fromB;
  const max = Math.min(n + m, MAX_LINE_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))
          ? (v[offset + k + 1] as number)
          : (v[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[fromA + x] === b[fromB + y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, fromA, fromB, toA, toB);
    }
  }
  return [{ fromA, toA, fromB, toB }];
}

/** Answers the changes, in order and against `before`, that turn it into `after`, matched line by line and trimmed to the characters that differ. @internal */
export function textChanges(before: string, after: string): TextChange[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let fromA = 0;
  let fromB = 0;
  while (fromA < a.length && fromB < b.length && a[fromA] === b[fromB]) {
    fromA += 1;
    fromB += 1;
  }
  let toA = a.length;
  let toB = b.length;
  while (toA > fromA && toB > fromB && a[toA - 1] === b[toB - 1]) {
    toA -= 1;
    toB -= 1;
  }
  const offsetsA = lineOffsets(a);
  const offsetsB = lineOffsets(b);
  const changes: TextChange[] = [];
  for (const hunk of lineHunks(a, b, fromA, fromB, toA, toB)) {
    const insert = after.slice(offsetsB[hunk.fromB], offsetsB[hunk.toB]);
    const change = trimmedChange(before, offsetsA[hunk.fromA] as number, offsetsA[hunk.toA] as number, insert);
    if (change !== undefined) changes.push(change);
  }
  return changes;
}
