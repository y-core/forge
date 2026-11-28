import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";

import { gateFixtureRoot } from "../../../src/tooling/gate/checks/gate.fixture";
import { check, corpus, rules, steps } from "./mod";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const root = gateFixtureRoot(
  {
    "docs/RULES.md": "## 1. Rules\n\n<!-- rule:forge-no-todo --> Because.\n",
    "config/rules.config.ts": `export default [{ id: "forge-no-todo", statement: "Never leave a TODO.", detectors: [{ kind: "rg", pattern: "TODO", paths: ["src/"], level: "fail" }] }];\n`,
    "src/a.ts": "// TODO later\n",
  },
  "warden-sdk-",
);
roots.push(root);

describe("the warden SDK", () => {
  it("reads the rules in scope", () => {
    const result = rules({ root, kind: "libs" });
    expect(result.ok && result.data.find((rule) => rule.id === "forge-no-todo")?.statement).toBe("Never leave a TODO.");
  });

  it("sweeps the tree with the register's patterns", () => {
    const result = check({ root, kind: "libs", level: "fail" });
    expect(result.ok && result.data.findings).toEqual([
      { rule: "forge-no-todo", level: "fail", file: "src/a.ts", line: 1, match: "// TODO later" },
    ]);
  });

  it("reads the corpus sections and the step rows", async () => {
    expect(corpus({ root, kind: "libs" }).some((section) => section.id === "project:docs/RULES.md#1")).toBe(true);
    expect(await steps({ root })).toEqual({ ok: true, data: [] });
  });
});
