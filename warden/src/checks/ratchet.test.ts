import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { gateFixtureRoot } from "../../../src/tooling/gate/checks/gate.fixture";
import type { CheckResult } from "../../../src/tooling/gate/types";
import type { RegisteredRule, RuleDetector } from "../rules/types";
import { ratchetStep } from "../steps";
import { checkRatchet, type RatchetBaseline, tightenRatchet } from "./ratchet";

const REPO = resolve(import.meta.dir, "../../..");

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function rule(id: string, detector: RuleDetector): RegisteredRule {
  return {
    id,
    statement: "Never do a.",
    detectors: [detector],
    origin: "repo",
    scope: ["libs"],
    rationale: { corpus: "project", path: "docs/RULES.md", section: "1", line: 3, chunk: "project:docs/RULES.md#1" },
    declaredIn: "config/rules.config.ts",
  };
}

const LINTED = rule("forge-a", { kind: "lint", key: "forge/a" });
const REVIEWED = rule("forge-b", { kind: "review" });

const BASELINE: RatchetBaseline = { rules: { total: 2, reviewOnly: 1 }, words: { "docs/A.md": 3, "docs/B.md": 5 } };

function fixture(files: Record<string, string>): string {
  const root = gateFixtureRoot(files, "warden-ratchet-");
  roots.push(root);
  return root;
}

function run(baseline: unknown, rules: readonly RegisteredRule[] = [LINTED, REVIEWED], extra: Record<string, string> = {}): CheckResult {
  const files = { "docs/A.md": "Three words here.\n", "docs/B.md": "Five words of prose here.\n", ...extra };
  const root = fixture(
    baseline === undefined ? files : { ...files, "config/rules-baseline.json": typeof baseline === "string" ? baseline : JSON.stringify(baseline) },
  );
  return checkRatchet({ root, rules, documents: Object.keys(files) });
}

function messages(result: CheckResult): string[] {
  return result.findings.map((finding) => `${finding.file ?? "-"}: ${finding.message}`);
}

describe("checkRatchet()", () => {
  it("passes a tree that matches its baseline", () => {
    const result = run(BASELINE);

    expect(messages(result)).toEqual([]);
    expect(result.summary).toBe("2 rules, 50.0% (1/2) review-only; 2 documents within budget");
  });

  it("passes a document below its budget, naming the slack the fixer would take", () => {
    const result = run({ ...BASELINE, words: { ...BASELINE.words, "docs/B.md": 9 } });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("4 words of slack in 1");
  });

  it("fails with no baseline", () => {
    expect(messages(run(undefined))).toEqual(["config/rules-baseline.json: no ratchet baseline — run the `warden:ratchet` fixer to write one"]);
  });

  it("fails on a baseline that is not one", () => {
    expect(run("{ not json").ok).toBe(false);
    expect(messages(run({ rules: { total: 1 }, words: {} }))[0]).toContain("could not be read as a ratchet baseline");
  });

  it("fails where the review-only share rose", () => {
    const result = run(BASELINE, [LINTED, REVIEWED, rule("forge-c", { kind: "review" })]);

    expect(messages(result)).toEqual([
      "config/rules-baseline.json: the review-only share rose to 66.7% (2/3), above the baseline's 50.0% (1/2) — give a rule a detector",
    ]);
  });

  it("holds a share that fell, even as review-only rules were added", () => {
    const rules = [LINTED, LINTED, LINTED, REVIEWED, rule("forge-c", { kind: "review" })];

    expect(run(BASELINE, rules).ok).toBe(true);
  });

  it("fails a document over its budget", () => {
    expect(messages(run({ ...BASELINE, words: { ...BASELINE.words, "docs/B.md": 4 } }))).toEqual([
      "docs/B.md: holds 5 words, over its budget of 4",
    ]);
  });

  it("fails a document with no budget", () => {
    expect(messages(run(BASELINE, undefined, { "docs/C.md": "New.\n" }))).toEqual(["docs/C.md: has no word budget in config/rules-baseline.json"]);
  });

  it("fails a budget for a document that no longer exists", () => {
    expect(messages(run({ ...BASELINE, words: { ...BASELINE.words, "docs/GONE.md": 10 } }))).toEqual([
      "config/rules-baseline.json: budgets `docs/GONE.md`, which is no longer an owned document",
    ]);
  });
});

describe("tightenRatchet()", () => {
  const words = new Map([
    ["docs/A.md", 2],
    ["docs/B.md", 8],
    ["docs/C.md", 4],
  ]);

  it("lowers a budget, never raises one, adds a new document and drops a deleted one", () => {
    const baseline = { ...BASELINE, words: { ...BASELINE.words, "docs/GONE.md": 1 } };
    const tightened = tightenRatchet(baseline, [LINTED, REVIEWED], words);

    expect(tightened).toEqual({
      ok: true,
      data: { rules: { total: 2, reviewOnly: 1 }, words: { "docs/A.md": 2, "docs/B.md": 5, "docs/C.md": 4 } },
    });
  });

  it("records the rule counts where the share fell", () => {
    const tightened = tightenRatchet(BASELINE, [LINTED, LINTED, REVIEWED], words);

    expect(tightened.ok && tightened.data.rules).toEqual({ total: 3, reviewOnly: 1 });
  });

  it("errs where the share rose, recording nothing", () => {
    const tightened = tightenRatchet(BASELINE, [REVIEWED], words);

    expect(tightened.ok).toBe(false);
    expect(!tightened.ok && tightened.error).toContain("only tightens");
  });

  it("seeds a baseline from the current counts where there is none", () => {
    expect(tightenRatchet(undefined, [REVIEWED], new Map([["docs/A.md", 3]]))).toEqual({
      ok: true,
      data: { rules: { total: 1, reviewOnly: 1 }, words: { "docs/A.md": 3 } },
    });
  });
});

describe("ratchetStep()", () => {
  const files = {
    "canon/shared/AGENT_GUIDE.md": "Canon prose.\n",
    "docs/RULES.md": ["## 1. Rules", "", "<!-- rule:forge-a --> Because tokens theme.", ""].join("\n"),
    "config/rules.config.ts": `export default [{ id: "forge-a", statement: "Never do a.", detectors: [{ kind: "review" }] }];\n`,
  };

  function step(root: string): ReturnType<typeof ratchetStep> {
    return ratchetStep({
      root,
      kind: "libs",
      trees: ["shared", "libs", "apps"],
      canonRoot: join(root, "canon"),
      canonRulesRoot: join(root, "rules"),
    });
  }

  it("is labelled warden:ratchet and carries a fixer", () => {
    const built = step("/nowhere/forge-no-such-root");

    expect(built.label).toBe("warden:ratchet");
    expect(built.fix).toBeDefined();
  });

  it("writes a baseline its own check then passes", async () => {
    const root = fixture(files);
    const built = step(root);

    expect((await built.run("unit")).ok).toBe(false);
    await built.fix?.();

    const written = readFileSync(join(root, "config/rules-baseline.json"), "utf-8");
    expect(JSON.parse(written)).toEqual({ rules: { total: 1, reviewOnly: 1 }, words: { "canon/shared/AGENT_GUIDE.md": 2, "docs/RULES.md": 5 } });
    expect((await built.run("unit")).ok).toBe(true);
  });

  it("writes the baseline in the layout the repository's formatter leaves unchanged", async () => {
    const oxfmt = JSON.parse(readFileSync(join(REPO, ".oxfmtrc.json"), "utf-8")) as Record<string, unknown>;
    const { sortTailwindcss: _tailwind, ignorePatterns: _ignored, ...layout } = oxfmt;
    const root = fixture({ ...files, ".oxfmtrc.json": JSON.stringify(layout) });
    await step(root).fix?.();

    const check = spawnSync("bun", ["fmt", "--no-script", "--check", "config/rules-baseline.json"], { cwd: root, encoding: "utf-8" });
    expect(check.status).toBe(0);
    expect(readFileSync(join(root, "config/rules-baseline.json"), "utf-8")).toBe(
      '{ "rules": { "total": 1, "reviewOnly": 1 }, "words": { "canon/shared/AGENT_GUIDE.md": 2, "docs/RULES.md": 5 } }\n',
    );
  });

  it("throws from its fixer where the share rose, leaving the baseline as it was", async () => {
    const baseline = JSON.stringify({ rules: { total: 1, reviewOnly: 0 }, words: {} });
    const root = fixture({ ...files, "config/rules-baseline.json": baseline });

    expect(() => step(root).fix?.()).toThrow("only tightens");
    expect(readFileSync(join(root, "config/rules-baseline.json"), "utf-8")).toBe(baseline);
  });
});
