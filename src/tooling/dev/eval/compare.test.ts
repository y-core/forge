import { describe, expect, it } from "bun:test";

import { compareRounds } from "./compare";
import { calibrationRecord, metrics, roundFile, runRecord, taskResult } from "./round.fixture";
import type { RoundFile, TaskResult } from "./types";

function compare(after: TaskResult, options: { allowRespec?: boolean } = {}): ReturnType<typeof compareRounds> {
  return compareRounds(roundFile("before"), roundFile("after", { t: after }), options);
}

describe("compareRounds()", () => {
  it("passes when every figure is equal", () => {
    const comparison = compare(taskResult());
    expect(comparison.regressed).toBe(false);
    expect(comparison.lines.at(-1)).toBe("no regression");
  });

  it("passes when every figure is better", () => {
    const after = taskResult({
      runs: [runRecord({ author: metrics(500, 5) }), runRecord({ author: metrics(500, 5) }), runRecord({ author: metrics(500, 5) })],
    });
    expect(compare(after).regressed).toBe(false);
  });

  it("passes a cost rise within 15%", () => {
    const after = taskResult({ runs: [runRecord({ author: metrics(1100, 11) })] });
    expect(compare(after).regressed).toBe(false);
  });

  it.each<[string, TaskResult]>([
    ["the acceptance rate falls", taskResult({ runs: [runRecord(), runRecord(), runRecord({ accepted: false })] })],
    ["`through` rises", taskResult({ runs: [runRecord(), runRecord(), runRecord({ traps: { a: "through", b: "clean" } })] })],
    [
      "calibration recall falls",
      taskResult({ calibration: [calibrationRecord(), calibrationRecord(), calibrationRecord({ a: "caught", b: "through" })] }),
    ],
    ["median prompt tokens rise by more than 15%", taskResult({ runs: [runRecord({ author: metrics(1200) })] })],
    ["median tool calls rise by more than 15%", taskResult({ runs: [runRecord({ author: metrics(1000, 12) })] })],
    ["the spec changed", taskResult({ specHash: "spec-2" })],
  ])("regresses when %s", (_rule, after) => {
    const comparison = compare(after);
    expect(comparison.regressed).toBe(true);
    expect(comparison.lines.some((line) => line.endsWith("REGRESSED"))).toBe(true);
  });

  it("compares a respecced task under allowRespec, rather than failing it", () => {
    expect(compare(taskResult({ specHash: "spec-2" }), { allowRespec: true }).regressed).toBe(false);
    expect(compare(taskResult({ specHash: "spec-2", runs: [runRecord({ accepted: false })] }), { allowRespec: true }).regressed).toBe(true);
  });

  it("regresses when a task is missing from the later round, and not when one is new", () => {
    expect(compareRounds(roundFile("before"), roundFile("after", {})).regressed).toBe(true);
    const added = compareRounds(roundFile("before"), roundFile("after", { t: taskResult(), u: taskResult() }));
    expect(added.regressed).toBe(false);
    expect(added.lines).toContain("u: new in after, nothing to compare");
  });

  it("leaves an invalid record out of every figure, and names it", () => {
    const reason = "review session s-9 produced no assistant turn";
    const after = taskResult({
      runs: [
        runRecord(),
        runRecord(),
        runRecord({ invalid: reason, accepted: false, author: metrics(5000, 50), traps: { a: "unreviewed", b: "clean" } }),
      ],
      calibration: [calibrationRecord(), calibrationRecord(), calibrationRecord({ a: "unreviewed", b: "clean" }, reason)],
    });
    const comparison = compare(after);
    expect(comparison.regressed).toBe(false);
    expect(comparison.lines.filter((line) => line === `  left out of after: ${reason}`)).toHaveLength(2);
  });

  it("prints each figure's delta for the task", () => {
    const lines = compare(taskResult({ runs: [runRecord({ author: metrics(2000) })] })).lines;
    expect(lines).toContain("  median prompt tokens: 1000 → 2000 — REGRESSED");
    expect(lines).toContain("  acceptance: 100% → 100%");
  });

  it("prints the turns and token breakdown beside the cost rows, which never regress on their own", () => {
    const after = taskResult({
      runs: [runRecord({ author: { ...metrics(), assistantMessages: 3, tokens: { input: 250, cacheCreation: 300, cacheRead: 600, output: 90 } } })],
    });
    const comparison = compare(after);
    expect(comparison.lines).toEqual(
      expect.arrayContaining([
        "  median turns: 1 → 3",
        "  median cache-read tokens: 500 → 600",
        "  median cache-creation tokens: 250 → 300",
        "  median output tokens: 100 → 90",
      ]),
    );
    expect(comparison.regressed).toBe(false);
  });
});

function arm(name: string, codeMode: boolean, result: TaskResult, extra: Partial<RoundFile> = {}): RoundFile {
  return { ...roundFile(name, { t: result }), mode: "interactive", codeMode, claudeVersion: "2.1.400", ...extra };
}

function runsAt(promptTokens: number, overrides: Parameters<typeof runRecord>[0] = {}): TaskResult {
  return taskResult({ runs: [1, 2, 3].map((rep) => runRecord({ rep, author: metrics(promptTokens), ...overrides })) });
}

function verdictOf(before: RoundFile, after: RoundFile): string[] {
  const lines = compareRounds(before, after).lines;
  const start = lines.findIndex((line) => line.startsWith("Code Mode "));
  return start === -1 ? [] : lines.slice(start, -1);
}

describe("compareRounds() across session modes", () => {
  it("refuses a headless round against an interactive one, naming the flag", () => {
    expect(() => compareRounds(roundFile("before"), { ...roundFile("after"), mode: "interactive" })).toThrow(
      /before ran in print mode and after in interactive mode[\s\S]*--allow-mixed-mode/,
    );
  });

  it("compares them under allowMixedMode, and says so in the header", () => {
    const comparison = compareRounds(roundFile("before"), { ...roundFile("after"), mode: "interactive" }, { allowMixedMode: true });
    expect(comparison.lines[0]).toContain("(print → interactive, compared under --allow-mixed-mode)");
  });

  it("reads a round recorded before rounds carried a mode as headless", () => {
    expect(compareRounds(roundFile("before"), { ...roundFile("after"), mode: "print" }).regressed).toBe(false);
  });
});

describe("compareRounds() billed tokens", () => {
  it("weighs input 1, cache creation 1.25, cache read 0.1 and output 5", () => {
    expect(compare(taskResult()).lines).toContain("  median billed tokens: 1113 → 1113");
  });

  it("regresses when median billed tokens rise by more than 15%", () => {
    const after = taskResult({
      runs: [runRecord({ author: { ...metrics(), tokens: { input: 250, cacheCreation: 250, cacheRead: 500, output: 140 } } })],
    });
    const comparison = compare(after);
    expect(comparison.lines).toContain("  median billed tokens: 1113 → 1313 — REGRESSED");
    expect(comparison.regressed).toBe(true);
  });
});

describe("compareRounds() Code Mode verdict", () => {
  it("says GO when Code Mode saves at least 15% of billed tokens and loses nothing", () => {
    expect(verdictOf(arm("off", false, runsAt(1000)), arm("on", true, runsAt(500)))).toEqual([
      "Code Mode GO: billed-token saving 27.5% (off off → on on)",
    ]);
  });

  it("finds the off arm whichever round it is", () => {
    expect(verdictOf(arm("on", true, runsAt(500)), arm("off", false, runsAt(1000)))[0]).toBe(
      "Code Mode GO: billed-token saving 27.5% (off off → on on)",
    );
  });

  it("says NO-GO when the saving is under 15%, and to rerun when it is within 5 points of it", () => {
    const [line, ...problems] = verdictOf(arm("off", false, runsAt(1000)), arm("on", true, runsAt(800)));
    expect(line).toBe("Code Mode NO-GO: billed-token saving 11.0% (off off → on on) — within 5 points of 15%, so rerun before deciding");
    expect(problems).toEqual(["  billed-token saving 11% is under 15%"]);
  });

  it("says GO with a rerun note when the saving clears 15% by less than 5 points", () => {
    expect(verdictOf(arm("off", false, runsAt(1000)), arm("on", true, runsAt(700)))).toEqual([
      "Code Mode GO: billed-token saving 16.5% (off off → on on) — within 5 points of 15%, so rerun before deciding",
    ]);
  });

  it("says NO-GO without a rerun note when the saving is far from 15%", () => {
    const [line] = verdictOf(arm("off", false, runsAt(1000)), arm("on", true, runsAt(1000)));
    expect(line).toBe("Code Mode NO-GO: billed-token saving 0.0% (off off → on on)");
  });

  it.each<[string, TaskResult, string]>([
    ["acceptance falls", runsAt(500, { accepted: false }), "  t: acceptance fell from 100% to 0%"],
    ["through per run rises", runsAt(500, { traps: { a: "through", b: "clean" } }), "  t: through per run rose from 0.00 to 1.00"],
    [
      "calibration recall falls",
      { ...runsAt(500), calibration: [calibrationRecord({ a: "caught", b: "through" })] },
      "  t: calibration recall fell from 100% to 50%",
    ],
    [
      "two of three on-arm runs are invalid",
      taskResult({ runs: [runRecord({ author: metrics(500) }), runRecord({ invalid: "x" }), runRecord({ invalid: "y" })] }),
      "  t: 2 of 3 runs invalid with Code Mode on",
    ],
  ])("says NO-GO when %s, despite the saving", (_rule, on, problem) => {
    const lines = verdictOf(arm("off", false, runsAt(1000)), arm("on", true, on));
    expect(lines[0]).toStartWith("Code Mode NO-GO:");
    expect(lines).toContain(problem);
  });

  it("allows one invalid run of three per arm", () => {
    const on = taskResult({ runs: [runRecord({ author: metrics(500) }), runRecord({ author: metrics(500) }), runRecord({ invalid: "x" })] });
    expect(verdictOf(arm("off", false, runsAt(1000)), arm("on", true, on))[0]).toStartWith("Code Mode GO:");
  });

  it("says NO-GO when the rounds ran at different forge commits", () => {
    const lines = verdictOf(arm("off", false, runsAt(1000)), arm("on", true, runsAt(500), { forgeSha: "b".repeat(40) }));
    expect(lines).toEqual(["Code Mode NO-GO: billed-token saving 27.5% (off off → on on)", "  the rounds ran at different forge commits"]);
  });

  it("prints no verdict when Code Mode is the same in both rounds, or the claude versions differ", () => {
    expect(verdictOf(arm("a", true, runsAt(1000)), arm("b", true, runsAt(500)))).toEqual([]);
    expect(verdictOf(arm("off", false, runsAt(1000)), arm("on", true, runsAt(500), { claudeVersion: "2.1.401" }))).toEqual([]);
    const { claudeVersion: _unrecorded, ...unversioned } = arm("off", false, runsAt(1000));
    expect(verdictOf(unversioned, arm("on", true, runsAt(500)))).toEqual([]);
  });

  it("keeps the regression verdict as the last line", () => {
    expect(compareRounds(arm("off", false, runsAt(1000)), arm("on", true, runsAt(500))).lines.at(-1)).toBe("no regression");
  });
});
