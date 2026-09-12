import { compareKeys } from "./artifact";
import type { CanonicalRow, CompareState, Divergence, TableComparison } from "./types";

/** How many divergences are kept as evidence; the cap bounds the evidence and never the count. @internal */
export const MAX_DIVERGENCES = 20;

/** A comparison with nothing seen, nothing pending and neither side exhausted. @internal */
export function emptyComparison(): CompareState {
  return {
    divergent: 0,
    divergences: [],
    sourceRows: 0,
    targetRows: 0,
    pendingSource: [],
    pendingTarget: [],
    lastSourceKey: null,
    lastTargetKey: null,
    sourceExhausted: false,
    targetExhausted: false,
  };
}

function absorb(
  side: "source" | "target",
  page: readonly CanonicalRow[],
  lastKey: string | null,
  found: Divergence[],
): { readonly rows: CanonicalRow[]; readonly lastKey: string | null } {
  const rows: CanonicalRow[] = [];
  let previous = lastKey;
  for (const row of page) {
    if (previous !== null) {
      const order = compareKeys(previous, row.key);
      // A key going backwards means the read was not ordered by the key, and comparing two
      // differently-ordered reads produces a silently clean diff — the one failure to refuse.
      if (order > 0) throw new Error(`${side} rows are not ordered by the key: ${row.key} follows ${previous}`);
      if (order === 0) {
        found.push({ kind: "duplicate-key", key: row.key, side });
        continue;
      }
    }
    rows.push(row);
    previous = row.key;
  }
  return { rows, lastKey: previous };
}

/** Merges one page from each side into the running comparison as a merge-join on the key, never a positional zip. @internal */
export function mergeRowPage(
  state: CompareState,
  source: readonly CanonicalRow[],
  target: readonly CanonicalRow[],
  exhausted: { readonly source: boolean; readonly target: boolean },
): CompareState {
  const found: Divergence[] = [];
  const absorbedSource = absorb("source", source, state.lastSourceKey, found);
  const absorbedTarget = absorb("target", target, state.lastTargetKey, found);

  const left = [...state.pendingSource, ...absorbedSource.rows];
  const right = [...state.pendingTarget, ...absorbedTarget.rows];
  const sourceExhausted = state.sourceExhausted || exhausted.source;
  const targetExhausted = state.targetExhausted || exhausted.target;

  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const a = left[i];
    const b = right[j];
    if (a === undefined || b === undefined) break;
    const order = compareKeys(a.key, b.key);
    if (order === 0) {
      if (a.canonical !== b.canonical) {
        for (const column of [...new Set([...Object.keys(a.cells), ...Object.keys(b.cells)])].sort()) {
          const from = a.cells[column] ?? "«absent»";
          const to = b.cells[column] ?? "«absent»";
          if (from !== to) found.push({ kind: "value", key: a.key, column, source: from, target: to });
        }
      }
      i += 1;
      j += 1;
    } else if (order < 0) {
      found.push({ kind: "only-in-source", key: a.key });
      i += 1;
    } else {
      found.push({ kind: "only-in-target", key: b.key });
      j += 1;
    }
  }
  if (targetExhausted) {
    for (; i < left.length; i += 1) {
      const a = left[i];
      if (a !== undefined) found.push({ kind: "only-in-source", key: a.key });
    }
  }
  if (sourceExhausted) {
    for (; j < right.length; j += 1) {
      const b = right[j];
      if (b !== undefined) found.push({ kind: "only-in-target", key: b.key });
    }
  }

  const room = Math.max(0, MAX_DIVERGENCES - state.divergences.length);
  return {
    divergent: state.divergent + found.length,
    divergences: [...state.divergences, ...found.slice(0, room)],
    sourceRows: state.sourceRows + source.length,
    targetRows: state.targetRows + target.length,
    pendingSource: left.slice(i),
    pendingTarget: right.slice(j),
    lastSourceKey: absorbedSource.lastKey,
    lastTargetKey: absorbedTarget.lastKey,
    sourceExhausted,
    targetExhausted,
  };
}

/** The verdict once both sides are exhausted; rows still pending mean a caller stopped reading early. @internal */
export function finishComparison(table: string, state: CompareState): TableComparison {
  if (state.pendingSource.length > 0 || state.pendingTarget.length > 0) {
    throw new Error(
      `${table}: ${state.pendingSource.length + state.pendingTarget.length} rows were never judged — neither side reported exhaustion`,
    );
  }
  return {
    table,
    divergent: state.divergent,
    divergences: state.divergences,
    truncated: state.divergent > state.divergences.length,
    sourceRows: state.sourceRows,
    targetRows: state.targetRows,
  };
}

/** One divergence for a terminal — the only place a canonical value is ever shortened. @internal */
export function formatDivergence(divergence: Divergence, maxValueWidth: number): string {
  const clip = (value: string) => (value.length <= maxValueWidth ? value : `${value.slice(0, Math.max(0, maxValueWidth - 1))}…`);
  switch (divergence.kind) {
    case "only-in-source":
      return `− ${clip(divergence.key)} is in the source and not in the target`;
    case "only-in-target":
      return `+ ${clip(divergence.key)} is in the target and not in the source`;
    case "duplicate-key":
      return `! ${clip(divergence.key)} appears twice in the ${divergence.side}`;
    default:
      return `≠ ${clip(divergence.key)} ${divergence.column}: ${clip(divergence.source)} → ${clip(divergence.target)}`;
  }
}
