// The second file that reaches Node rather than Web APIs. Why that is legal, and what it costs the
// barrel and a consumer's type program: `docs/TEST_RUNNERS.md` §7h.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { err, ok, toError } from "../result/result";
import type { Result } from "../result/types";

/** How many differing lines a report renders before it truncates; `diff` is never truncated. */
const DEFAULT_LIMIT = 20;

/** What a comparison is allowed to do about a fixture that is absent or out of date. @public */
export interface SnapshotOptions {
  /** Rewrites the fixture from `actual` rather than comparing against it. */
  update?: boolean | undefined;
  /** Forbids every write, so an absent fixture fails instead of regenerating green. */
  ci?: boolean | undefined;
  /** Differing lines the report renders before truncating; `DEFAULT_LIMIT` where unset. */
  limit?: number | undefined;
}

/** A fixture the actual text now agrees with, and whether agreeing meant writing it. @public */
export interface SnapshotMatch {
  path: string;
  state: "matched" | "created" | "updated";
}

/** One line the fixture and the actual text disagree on; `null` is the side with no line there. @public */
export interface SnapshotDiffLine {
  line: number;
  expected: string | null;
  actual: string | null;
}

/** Why the actual text and the fixture do not agree, and what a reviewer is shown about it. @public */
export interface SnapshotMismatch {
  reason: "mismatch" | "missing" | "unreadable" | "unwritable";
  path: string;
  /** Every differing line, whatever `limit` the report was rendered at; empty off the mismatch path. */
  diff: readonly SnapshotDiffLine[];
  /** The rendered, line-numbered failure text, which is what goes in front of a reviewer. */
  report: string;
  cause?: Error | undefined;
}

/** What a comparison answers: never a throw, so a broken checkout is data like anything else. @public */
export type SnapshotOutcome = Result<SnapshotMatch, SnapshotMismatch>;

// A raw positional compare cascades — one line inserted at the top reports every following line as
// changed — and first-divergence-only turns one fix into five runs. This is the cheap 80% of an LCS.
function diffLines(expected: readonly string[], actual: readonly string[]): SnapshotDiffLine[] {
  let head = 0;
  while (head < expected.length && head < actual.length && expected[head] === actual[head]) head += 1;
  let tail = 0;
  while (tail < expected.length - head && tail < actual.length - head && expected.at(-1 - tail) === actual.at(-1 - tail)) tail += 1;
  // Each side is sliced to its own band before it is paired, so the shorter one pads with `null` —
  // which is what makes an insertion read as two added lines rather than as two rewritten ones.
  const left = expected.slice(head, expected.length - tail);
  const right = actual.slice(head, actual.length - tail);
  const out: SnapshotDiffLine[] = [];
  for (let at = 0; at < Math.max(left.length, right.length); at += 1) {
    out.push({ line: head + at + 1, expected: left[at] ?? null, actual: right[at] ?? null });
  }
  return out;
}

// A trailing space, a tab for spaces and a stray `\r` are what "files differ" is most useless about,
// and quoting makes each visible for two characters. Comparison is byte-exact and already past.
function render(path: string, expected: readonly string[], actual: readonly string[], diff: readonly SnapshotDiffLine[], limit: number): string {
  const shown = diff.slice(0, Math.max(limit, 0));
  const lines = shown.flatMap((line) => [
    ...(line.expected === null ? [] : [`  ${line.line} - ${JSON.stringify(line.expected)}`]),
    ...(line.actual === null ? [] : [`  ${line.line} + ${JSON.stringify(line.actual)}`]),
  ]);
  // Both counts, not just the differing total: an insertion next to a change pairs positionally and
  // reads as a rewrite, and each file's own length is what discloses that to a reviewer.
  const header = `${path}: ${diff.length} differing lines — fixture ${expected.length}, actual ${actual.length}`;
  const more = diff.length > shown.length ? [`  … ${diff.length - shown.length} more`] : [];
  return [header, ...lines, ...more].join("\n");
}

function mismatch(path: string, reason: SnapshotMismatch["reason"], report: string, cause?: Error): SnapshotOutcome {
  return err({ reason, path, diff: [], report, ...(cause === undefined ? {} : { cause }) });
}

// Git does not track an empty directory, so on the run that creates a new suite's first fixture the
// parent may not exist — and an `ENOENT` there would fail exactly when the write branch is needed.
function write(actual: string, path: string, state: SnapshotMatch["state"]): SnapshotOutcome {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, actual, "utf-8");
    return ok({ path, state });
  } catch (thrown) {
    const cause = toError(thrown);
    return mismatch(path, "unwritable", `${path}: the fixture could not be written — ${cause.message}`, cause);
  }
}

/** Compares text against a committed fixture, writing it where there is none to compare with. @public */
export async function matchTextSnapshot(actual: string, path: string, options: SnapshotOptions = {}): Promise<SnapshotOutcome> {
  // Async from the front door rather than from the day something needs it, for the reason the render
  // path is: adding work that has to await here later is then not a signature break on a consumer.
  await Promise.resolve();
  // `ci` overrides `update`, so a CI run carrying `update` from a stale script rewrites nothing.
  const writing = options.ci !== true && options.update === true;
  if (!existsSync(path)) {
    if (options.ci === true) return mismatch(path, "missing", `${path}: no fixture, and a CI run may not write one`);
    return write(actual, path, "created");
  }
  let expected: string;
  try {
    expected = readFileSync(path, "utf-8");
  } catch (thrown) {
    const cause = toError(thrown);
    return mismatch(path, "unreadable", `${path}: the fixture could not be read — ${cause.message}`, cause);
  }
  if (expected === actual) return ok({ path, state: "matched" });
  if (writing) return write(actual, path, "updated");
  const diff = diffLines(expected.split("\n"), actual.split("\n"));
  return err({
    reason: "mismatch",
    path,
    diff,
    report: render(path, expected.split("\n"), actual.split("\n"), diff, options.limit ?? DEFAULT_LIMIT),
  });
}
