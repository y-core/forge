import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { gateFixtureRoot } from "../../../src/tooling/gate/checks/gate.fixture";
import { loadRuleSources, registerTrees, ruleDocuments } from "./load";

const DEFINE = resolve(import.meta.dir, "define.ts");

const ENTRY = `{ id: "forge-x", statement: "Never do x.", detectors: [{ kind: "review" }] }`;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = gateFixtureRoot(files, "warden-rules-load-");
  roots.push(root);
  return root;
}

describe("registerTrees()", () => {
  it("takes every tree where the canon is authored inside the repository", () => {
    expect(registerTrees("/repo", "libs", "/repo/warden/canon")).toEqual(["shared", "libs", "apps"]);
  });

  it("takes shared and the repository's own tree where the canon is installed under it", () => {
    expect(registerTrees("/app", "apps", "/app/node_modules/@y-core/forge/warden/canon")).toEqual(["shared", "apps"]);
  });

  it("takes shared and the repository's own tree where the canon lies outside it", () => {
    expect(registerTrees("/app", "libs", "/elsewhere/warden/canon")).toEqual(["shared", "libs"]);
  });
});

describe("ruleDocuments()", () => {
  const root = fixture({
    "canon/shared/AGENT_GUIDE.md": "# a\n",
    "canon/libs/CODE_RULES.md": "# b\n",
    "canon/apps/APP_ARCHITECTURE.md": "# c\n",
    "docs/NAMESPACES.md": "# d\n",
  });

  it("reads the canon documents of exactly the trees named, then the repository's own", () => {
    const docs = ruleDocuments(root, "libs", ["shared", "apps"], join(root, "canon"));

    expect(docs.map((doc) => `${doc.corpus}:${doc.tree ?? "-"}:${doc.path}`)).toEqual([
      "canon:shared:AGENT_GUIDE.md",
      "canon:apps:APP_ARCHITECTURE.md",
      "project:-:docs/NAMESPACES.md",
    ]);
  });
});

describe("loadRuleSources()", () => {
  it("declares nothing where neither config/rules.config.ts nor a canon rule file exists", () => {
    const root = fixture({});

    expect(loadRuleSources({ root, trees: ["shared", "libs"], canonRulesRoot: join(root, "rules") })).toEqual({ ok: true, data: [] });
  });

  it("reads config/rules.config.ts as the repository's own source", () => {
    const root = fixture({ "config/rules.config.ts": `export default [${ENTRY}];\n` });

    const loaded = loadRuleSources({ root, trees: ["shared"], canonRulesRoot: join(root, "rules") });

    expect(loaded).toEqual({
      ok: true,
      data: [
        { origin: "repo", file: "config/rules.config.ts", entries: [{ id: "forge-x", statement: "Never do x.", detectors: [{ kind: "review" }] }] },
      ],
    });
  });

  it("finds each canon rule file by walking the trees named, importing what it imports, and skips a test beside it", () => {
    const entry = `import { defineRules } from ${JSON.stringify(DEFINE)};\nexport default defineRules([${ENTRY.replace("forge-x", "libs-testing-x")}]);\n`;
    const root = fixture({
      "rules/libs/TESTING.ts": entry,
      "rules/libs/TESTING.test.ts": "throw new Error('never loaded');\n",
      "rules/apps/TESTING.ts": "throw new Error('apps is not read');\n",
    });

    const loaded = loadRuleSources({ root, trees: ["shared", "libs"], canonRulesRoot: join(root, "rules") });

    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.data.map(({ origin, file, tree, doc }) => ({ origin, file, tree, doc }))).toEqual([
      { origin: "canon", file: "rules/libs/TESTING.ts", tree: "libs", doc: "TESTING.md" },
    ]);
    expect(loaded.data[0]?.entries.map((rule) => rule.id)).toEqual(["libs-testing-x"]);
  });

  it("refuses a default export that is not an array, naming the file", () => {
    const root = fixture({ "config/rules.config.ts": `export default { rules: [] };\n` });

    expect(loadRuleSources({ root, trees: [], canonRulesRoot: join(root, "rules") })).toEqual({
      ok: false,
      error: "config/rules.config.ts: the default export is not an array of rule entries — export `defineRules([...])`",
    });
  });

  it("refuses a rule file that throws on load, naming the file and the error", () => {
    const root = fixture({ "rules/shared/AGENT_GUIDE.ts": "throw new Error('boom');\n" });

    expect(loadRuleSources({ root, trees: ["shared"], canonRulesRoot: join(root, "rules") })).toEqual({
      ok: false,
      error: "rules/shared/AGENT_GUIDE.ts: could not be loaded — boom",
    });
  });
});
