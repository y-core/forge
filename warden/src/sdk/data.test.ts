import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";

import { gateFixtureRoot } from "../../../src/tooling/gate/checks/gate.fixture";
import { openIndex } from "../index/open";
import { corpusSections, loadSteps, rulesInScope } from "./data";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = gateFixtureRoot(files, "warden-sdk-data-");
  roots.push(root);
  return root;
}

const FILES = {
  "docs/RULES.md": "## 1. Rules\n\n<!-- rule:forge-a --> Because `AGENT_GUIDE.md` §8 says so.\n\n## 2. More\n\nProse.\n",
  "config/rules.config.ts": `export default [{ id: "forge-a", statement: "Never do a.", detectors: [{ kind: "review" }] }];\n`,
};

describe("rulesInScope()", () => {
  it("holds the repository's rules and the canon's for its own kind only", () => {
    const libs = rulesInScope(fixture(FILES), "libs");
    expect(libs.ok && libs.data.some((rule) => rule.id === "forge-a")).toBe(true);
    expect(libs.ok && libs.data.every((rule) => rule.scope.includes("libs"))).toBe(true);
  });
});

describe("corpusSections()", () => {
  it("lists each section with its id, body and outbound relations", () => {
    const knowledge = openIndex(fixture(FILES), "libs", { path: ":memory:", canonVersion: "1.0.0" });
    knowledge.refresh();
    const sections = corpusSections(knowledge.db).filter((section) => section.path === "docs/RULES.md");
    knowledge.close();

    expect(sections.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "project:docs/RULES.md#1", title: "Rules" },
      { id: "project:docs/RULES.md#2", title: "More" },
    ]);
    expect(sections[0]?.body).toContain("Never do a.");
    expect(sections[0]?.relations).toContainEqual({ kind: "cites", to: "canon:AGENT_GUIDE.md#8" });
  });
});

describe("loadSteps()", () => {
  const TABLE = `export default { tiers: { static: [{ label: "lint", cmd: ["oxlint"], fix: ["oxlint", "--fix"] }], unit: [{ label: "test", cmd: ["bun", "test"], watches: ["src/**"] }] } };\n`;

  it("lists each declared row with its tier, whether it can fix, and its watches", async () => {
    expect(await loadSteps(fixture({ "config/steps.config.ts": TABLE }))).toEqual({
      ok: true,
      data: [
        { tier: "static", label: "lint", fixable: true },
        { tier: "unit", label: "test", fixable: false, watches: ["src/**"] },
      ],
    });
  });

  it("answers no rows where the repository has no step table, and names one that is not a table", async () => {
    expect(await loadSteps(fixture({}))).toEqual({ ok: true, data: [] });
    const result = await loadSteps(fixture({ "config/steps.config.ts": "export default 3;\n" }));
    expect(result).toEqual({ ok: false, error: "config/steps.config.ts does not default-export defineSteps({ tiers: { … } })" });
  });
});
