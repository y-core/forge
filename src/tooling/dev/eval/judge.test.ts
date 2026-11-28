import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hasTool } from "../../cli/proc";
import type { SpawnOptions, SpawnOutcome } from "../../cli/types";
import { worktreeChanges } from "../../cli/worktree";
import { addedLines, runAcceptance, runTrap } from "./judge";
import { loadTask } from "./spec";
import { removeAll, SAMPLE_FILES, sampleSpec, writeTaskDir } from "./task.fixture";
import type { EvalTask, EvalTrap } from "./types";

const roots: string[] = [];
afterAll(() => removeAll(roots));

function emulateRg(args: string[], input: string): SpawnOutcome {
  const pattern = new RegExp(args[args.indexOf("-e") + 1] ?? "");
  const hits = input
    .split("\n")
    .slice(0, -1)
    .flatMap((line, index) => (pattern.test(line) ? [`${index + 1}:${line}`] : []));
  return hits.length === 0 ? { status: 1, stdout: "" } : { status: 0, stdout: hits.join("\n") + "\n" };
}

const spawn = mock((command: string, args: string[], options: SpawnOptions): SpawnOutcome => {
  if (command === "rg") return emulateRg(args, options.input ?? "");
  return { status: 0 };
});

const BASE = "b".repeat(40);

const DIFF = [
  "diff --git a/src/sample/mod.ts b/src/sample/mod.ts",
  "index 1111111..2222222 100644",
  "--- a/src/sample/mod.ts",
  "+++ b/src/sample/mod.ts",
  "@@ -1,4 +1,5 @@",
  ' import { readFileSync } from "node:fs";',
  '-import { join } from "node:path";',
  '+import { statSync } from "node:fs";',
  "+export const a = 1;",
  " ",
  " export const b = 2;",
  "@@ -20,2 +21,3 @@ export function c() {",
  "   return 3;",
  '+  // from "node:os"',
  " }",
  "diff --git a/docs/X.md b/docs/X.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/docs/X.md",
  "@@ -0,0 +1 @@",
  '+import from "node:fs"',
  "diff --git a/src/sample/gone.ts b/src/sample/gone.ts",
  "deleted file mode 100644",
  "--- a/src/sample/gone.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  '-import "node:vm";',
  "",
].join("\n");

function task(): EvalTask {
  const { root, dir } = writeTaskDir(sampleSpec(), SAMPLE_FILES);
  roots.push(root);
  return loadTask(dir);
}

function realGit(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function trapOf(t: EvalTask, id: string): EvalTrap {
  const trap = t.traps.find((candidate) => candidate.id === id);
  if (trap === undefined) throw new Error(`no trap ${id}`);
  return trap;
}

function tree(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-eval-tree-"));
  roots.push(dir);
  return dir;
}

beforeEach(() => {
  spawn.mockClear();
});

describe("addedLines()", () => {
  it("returns each added line with its file and its line number in the new file", () => {
    expect(addedLines(DIFF)).toEqual([
      { file: "src/sample/mod.ts", line: 2, text: 'import { statSync } from "node:fs";' },
      { file: "src/sample/mod.ts", line: 3, text: "export const a = 1;" },
      { file: "src/sample/mod.ts", line: 22, text: '  // from "node:os"' },
      { file: "docs/X.md", line: 1, text: 'import from "node:fs"' },
    ]);
  });

  it("reads a `+++` line inside a hunk as an added line, not a file header", () => {
    const diff = ["--- a/a.ts", "+++ b/a.ts", "@@ -1 +1,2 @@", " x", "+++ b/b.ts", ""].join("\n");
    expect(addedLines(diff)).toEqual([{ file: "a.ts", line: 2, text: "++ b/b.ts" }]);
  });
});

describe("runTrap() with an rg detector", () => {
  it("fires on an added line under its paths, and never on a context or removed line", () => {
    const t = task();
    const firing = runTrap(t, trapOf(t, "node-import"), tree(), { base: BASE, diff: DIFF }, spawn);
    expect(firing.fires).toBe(true);
    expect(firing.hits.map((hit) => hit.line)).toEqual([2, 22]);
  });

  it("does not fire when the pattern is only on a context or removed line", () => {
    const t = task();
    const diff = DIFF.replace('+import { statSync } from "node:fs";', ' import { statSync } from "fs";').replace(
      '+  // from "node:os"',
      "+  // os",
    );
    const firing = runTrap(t, trapOf(t, "node-import"), tree(), { base: BASE, diff }, spawn);
    expect(firing).toEqual({ fires: false, hits: [] });
  });

  it("ignores an added line outside its paths", () => {
    const t = task();
    const trap: EvalTrap = { id: "x", rules: ["r"], detector: { kind: "rg", pattern: "node:", paths: ["docs"] } };
    expect(runTrap(t, trap, tree(), { base: BASE, diff: DIFF }, spawn).hits).toEqual([
      { file: "docs/X.md", line: 1, text: 'import from "node:fs"' },
    ]);
  });

  it("passes -P only for a pcre pattern", () => {
    const t = task();
    const plain = trapOf(t, "node-import");
    runTrap(t, plain, tree(), { base: BASE, diff: DIFF }, spawn);
    expect(spawn.mock.calls[0]?.[1]).not.toContain("-P");
    if (plain.detector.kind !== "rg") throw new Error("not an rg trap");
    runTrap(t, { ...plain, detector: { ...plain.detector, pcre: true } }, tree(), { base: BASE, diff: DIFF }, spawn);
    expect(spawn.mock.calls[1]?.[1]).toContain("-P");
  });

  it("throws on an rg error, so a broken pattern never reads as a clean run", () => {
    const t = task();
    const failing = mock((): SpawnOutcome => ({ status: 2, stderr: "regex parse error" }));
    expect(() => runTrap(t, trapOf(t, "node-import"), tree(), { base: BASE, diff: DIFF }, failing)).toThrow(/regex parse error/);
  });

  it.skipIf(!hasTool("rg"))("matches with the real rg, exactly as with the emulation", () => {
    const t = task();
    expect(runTrap(t, trapOf(t, "node-import"), tree(), { base: BASE, diff: DIFF }).hits.map((hit) => hit.line)).toEqual([2, 22]);
  });
});

describe("runTrap() with a step or test detector", () => {
  it("runs the named gate step with HEAD at the run's base, fires on a non-zero exit, and puts HEAD back", () => {
    const t = task();
    const root = tree();
    const head = "h".repeat(40);
    const failing = mock((command: string, args: string[], _options: SpawnOptions): SpawnOutcome => {
      if (command === "git") return { status: 0, stdout: args[0] === "rev-parse" ? `${head}\n` : "" };
      return { status: 1 };
    });
    expect(runTrap(t, trapOf(t, "co-location"), root, { base: BASE, diff: DIFF }, failing).fires).toBe(true);
    expect(failing.mock.calls.map(([command, args]) => [command, ...args])).toEqual([
      ["git", "rev-parse", "HEAD"],
      ["git", "reset", "-q", "--soft", BASE],
      ["bun", "run", "verify", "--only", "validate-co-location"],
      ["git", "reset", "-q", "--soft", head],
    ]);
    expect(failing.mock.calls.every(([, , options]) => options.cwd === root)).toBe(true);
    expect(runTrap(t, trapOf(t, "co-location"), root, { base: BASE, diff: DIFF }, spawn).fires).toBe(false);
  });

  it("judges a change-scoped row on the run's whole change, not on the nothing a committed tree has pending", () => {
    const t = task();
    const root = tree();
    const commit = (file: string): string => {
      writeFileSync(join(root, file), "SELECT 1;\n", "utf-8");
      realGit(root, ["add", "-A"]);
      realGit(root, ["-c", "user.name=t", "-c", "user.email=t@localhost", "-c", "commit.gpgsign=false", "commit", "-q", "-m", file]);
      return realGit(root, ["rev-parse", "HEAD"]).trim();
    };
    realGit(root, ["init", "-q"]);
    const base = commit("0001_base.sql");
    const lintsPending = mock((command: string, args: string[], options: SpawnOptions): SpawnOutcome => {
      if (command === "git") return spawnSync(command, args, { ...options, encoding: "utf-8" });
      const pending = worktreeChanges(options.cwd ?? "") ?? [];
      return { status: pending.length === 0 || pending.includes("0003_bad.sql") ? 1 : 0 };
    });
    const trap = trapOf(t, "co-location");

    const clean = commit("0002_good.sql");
    expect(runTrap(t, trap, root, { base, diff: "" }, lintsPending).fires).toBe(false);
    expect(realGit(root, ["rev-parse", "HEAD"]).trim()).toBe(clean);

    commit("0003_bad.sql");
    expect(runTrap(t, trap, root, { base: clean, diff: "" }, lintsPending).fires).toBe(true);
    expect(realGit(root, ["status", "--porcelain"])).toBe("");
  });

  it("copies the test in from accept/, runs it, and removes it again", () => {
    const t = task();
    const root = tree();
    const target = join(root, "src", "sample", "refusal.accept.test.ts");
    let presentDuringRun = false;
    const failing = mock((_command: string, _args: string[], _options: SpawnOptions): SpawnOutcome => {
      presentDuringRun = existsSync(target);
      return { status: 1 };
    });
    expect(runTrap(t, trapOf(t, "refusal-shape"), root, { base: BASE, diff: DIFF }, failing).fires).toBe(true);
    expect(failing.mock.calls[0]?.slice(0, 2)).toEqual(["bun", ["test", "./src/sample/refusal.accept.test.ts"]]);
    expect(presentDuringRun).toBe(true);
    expect(existsSync(target)).toBe(false);
  });
});

describe("runAcceptance()", () => {
  it("passes when the acceptance tests pass, and restores a file of the author's it displaced", () => {
    const t = task();
    const root = tree();
    const target = join(root, "src", "sample", "sample.accept.test.ts");
    mkdirSync(join(root, "src", "sample"), { recursive: true });
    writeFileSync(target, "the author's own\n", "utf-8");
    expect(runAcceptance(t, root, spawn)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("the author's own\n");
  });

  it("fails when any acceptance test fails", () => {
    expect(
      runAcceptance(
        task(),
        tree(),
        mock((): SpawnOutcome => ({ status: 1 })),
      ),
    ).toBe(false);
  });
});
