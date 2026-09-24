import { describe, expect, it } from "bun:test";

import { canonicaliseRow } from "./artifact";
import { emptyComparison, finishComparison, formatDivergence, MAX_DIVERGENCES, mergeRowPage } from "./compare";
import type { CanonicalRow } from "./types";

function capture(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

const COLUMNS = ["seq", "lane"];

function events(list: readonly (readonly [number, string])[]): CanonicalRow[] {
  return list.map(([seq, lane]) => canonicaliseRow(COLUMNS, "seq", { seq, lane }));
}

const BOTH_EXHAUSTED = { source: true, target: true } as const;
const NEITHER_EXHAUSTED = { source: false, target: false } as const;

describe("emptyComparison()", () => {
  it("starts with nothing seen, nothing pending and neither side exhausted", () => {
    expect(emptyComparison()).toEqual({
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
    });
  });
});

describe("mergeRowPage()", () => {
  it("reports nothing for two identical pages", () => {
    const page = events([
      [1, "todo"],
      [2, "doing"],
    ]);
    const comparison = finishComparison("events", mergeRowPage(emptyComparison(), page, page, BOTH_EXHAUSTED));

    expect(comparison).toEqual({ table: "events", divergent: 0, divergences: [], truncated: false, sourceRows: 2, targetRows: 2 });
  });

  it("reports one row only in the source and leaves the rows after it alone", () => {
    const source = events([
      [1, "todo"],
      [2, "doing"],
      [3, "done"],
    ]);
    const target = events([
      [1, "todo"],
      [3, "done"],
    ]);
    const comparison = finishComparison("events", mergeRowPage(emptyComparison(), source, target, BOTH_EXHAUSTED));

    expect(comparison.divergences).toEqual([{ kind: "only-in-source", key: "I:2" }]);
    expect(comparison.divergent).toBe(1);
  });

  it("reports one row only in the target", () => {
    const source = events([
      [1, "todo"],
      [3, "done"],
    ]);
    const target = events([
      [1, "todo"],
      [2, "doing"],
      [3, "done"],
    ]);
    const comparison = finishComparison("events", mergeRowPage(emptyComparison(), source, target, BOTH_EXHAUSTED));

    expect(comparison.divergences).toEqual([{ kind: "only-in-target", key: "I:2" }]);
  });

  it("names the column that moved rather than printing two whole rows", () => {
    const comparison = finishComparison("events", mergeRowPage(emptyComparison(), events([[1, "todo"]]), events([[1, "doing"]]), BOTH_EXHAUSTED));

    expect(comparison.divergences).toEqual([{ kind: "value", key: "I:1", column: "lane", source: "S:4:todo", target: "S:5:doing" }]);
  });

  it("reports every column that moved on one row, in column-name order", () => {
    const columns = ["seq", "actor", "lane"];
    const source = [canonicaliseRow(columns, "seq", { seq: 1, actor: "a", lane: "todo" })];
    const target = [canonicaliseRow(columns, "seq", { seq: 1, actor: "b", lane: "doing" })];
    const comparison = finishComparison("events", mergeRowPage(emptyComparison(), source, target, BOTH_EXHAUSTED));

    expect(comparison.divergences).toEqual([
      { kind: "value", key: "I:1", column: "actor", source: "S:1:a", target: "S:1:b" },
      { kind: "value", key: "I:1", column: "lane", source: "S:4:todo", target: "S:5:doing" },
    ]);
  });

  it("reports a duplicate key on either side and still matches the rest", () => {
    const source = events([
      [1, "todo"],
      [1, "todo"],
      [2, "doing"],
    ]);
    const target = events([
      [1, "todo"],
      [2, "doing"],
    ]);
    const left = finishComparison("events", mergeRowPage(emptyComparison(), source, target, BOTH_EXHAUSTED));
    const right = finishComparison(
      "events",
      mergeRowPage(
        emptyComparison(),
        events([[1, "todo"]]),
        events([
          [1, "todo"],
          [1, "todo"],
        ]),
        BOTH_EXHAUSTED,
      ),
    );

    expect(left.divergences).toEqual([{ kind: "duplicate-key", key: "I:1", side: "source" }]);
    expect(right.divergences).toEqual([{ kind: "duplicate-key", key: "I:1", side: "target" }]);
  });

  it("throws on unsorted input rather than reporting a clean diff", () => {
    const source = events([
      [2, "doing"],
      [1, "todo"],
    ]);
    const target = events([
      [10, "doing"],
      [9, "todo"],
    ]);

    expect((capture(() => mergeRowPage(emptyComparison(), source, [], NEITHER_EXHAUSTED)) as Error).message).toBe(
      "source rows are not ordered by the key: I:1 follows I:2",
    );
    expect((capture(() => mergeRowPage(emptyComparison(), [], target, NEITHER_EXHAUSTED)) as Error).message).toBe(
      "target rows are not ordered by the key: I:9 follows I:10",
    );
  });

  it("throws when a later page reopens a key an earlier page already passed", () => {
    const first = mergeRowPage(emptyComparison(), events([[5, "todo"]]), events([[5, "todo"]]), NEITHER_EXHAUSTED);

    expect((capture(() => mergeRowPage(first, events([[4, "todo"]]), [], NEITHER_EXHAUSTED)) as Error).message).toBe(
      "source rows are not ordered by the key: I:4 follows I:5",
    );
  });

  it("holds a row it cannot yet judge and matches it against a later page from the other side", () => {
    const first = mergeRowPage(
      emptyComparison(),
      events([
        [1, "todo"],
        [2, "doing"],
      ]),
      events([[1, "todo"]]),
      NEITHER_EXHAUSTED,
    );

    expect(first.divergences).toEqual([]);
    expect(first.pendingSource.map((row) => row.key)).toEqual(["I:2"]);

    const comparison = finishComparison("events", mergeRowPage(first, [], events([[2, "doing"]]), BOTH_EXHAUSTED));

    expect(comparison.divergent).toBe(0);
    expect(comparison.sourceRows).toBe(2);
    expect(comparison.targetRows).toBe(2);
  });

  it("caps the evidence at MAX_DIVERGENCES while the count stays exact", () => {
    const source = events(Array.from({ length: 25 }, (_, index) => [index + 1, "todo"] as const));
    const comparison = finishComparison("events", mergeRowPage(emptyComparison(), source, [], BOTH_EXHAUSTED));

    expect(comparison.divergent).toBe(25);
    expect(comparison.divergences.length).toBe(MAX_DIVERGENCES);
    expect(comparison.truncated).toBe(true);
    expect(comparison.divergences.map((divergence) => divergence.key)).toEqual(Array.from({ length: 20 }, (_, index) => `I:${index + 1}`));
  });

  it("keeps MAX_DIVERGENCES at 20, since the cap is part of what a report promises", () => {
    expect(MAX_DIVERGENCES).toBe(20);
  });

  it("flushes a tail only once the other side reports exhaustion", () => {
    const source = events([
      [1, "todo"],
      [2, "doing"],
    ]);
    const held = mergeRowPage(emptyComparison(), source, events([[1, "todo"]]), { source: true, target: false });
    const flushed = mergeRowPage(emptyComparison(), source, events([[1, "todo"]]), { source: false, target: true });

    expect(held.divergences).toEqual([]);
    expect(held.pendingSource.map((row) => row.key)).toEqual(["I:2"]);
    expect(flushed.divergences).toEqual([{ kind: "only-in-source", key: "I:2" }]);
    expect(flushed.pendingSource).toEqual([]);
  });
});

describe("finishComparison()", () => {
  it("returns a clean verdict for an empty comparison", () => {
    expect(finishComparison("projects", emptyComparison())).toEqual({
      table: "projects",
      divergent: 0,
      divergences: [],
      truncated: false,
      sourceRows: 0,
      targetRows: 0,
    });
  });

  it("counts every unjudged row in the refusal, because neither side reported exhaustion", () => {
    const state = mergeRowPage(
      emptyComparison(),
      events([
        [1, "todo"],
        [2, "doing"],
        [3, "done"],
      ]),
      events([[1, "todo"]]),
      NEITHER_EXHAUSTED,
    );

    expect((capture(() => finishComparison("events", state)) as Error).message).toBe(
      "events: 2 rows were never judged — neither side reported exhaustion",
    );
  });
});

describe("formatDivergence()", () => {
  it("formats each kind, with both sides at full width", () => {
    expect(formatDivergence({ kind: "only-in-source", key: "S:14:feat-260806-04" }, 40)).toBe(
      "− S:14:feat-260806-04 is in the source and not in the target",
    );
    expect(formatDivergence({ kind: "only-in-target", key: "S:14:feat-260806-04" }, 40)).toBe(
      "+ S:14:feat-260806-04 is in the target and not in the source",
    );
    expect(formatDivergence({ kind: "duplicate-key", key: "I:124", side: "target" }, 40)).toBe("! I:124 appears twice in the target");
    expect(formatDivergence({ kind: "value", key: "S:14:feat-260806-04", column: "lane", source: "S:4:todo", target: "S:5:doing" }, 40)).toBe(
      "≠ S:14:feat-260806-04 lane: S:4:todo → S:5:doing",
    );
  });

  it("clips every value past the width, and leaves one exactly at it alone", () => {
    expect(formatDivergence({ kind: "value", key: "S:14:feat-260806-04", column: "lane", source: "S:4:todo", target: "S:5:doing" }, 8)).toBe(
      "≠ S:14:fe… lane: S:4:todo → S:5:doi…",
    );
    expect(formatDivergence({ kind: "only-in-source", key: "S:14:feat-260806-04" }, 6)).toBe("− S:14:… is in the source and not in the target");
  });
});
