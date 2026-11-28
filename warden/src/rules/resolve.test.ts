import { describe, expect, it } from "bun:test";

import { buildRegister } from "./resolve";
import type { RuleEntry, RuleMarkerSite, RuleSource } from "./types";

function entry(id: string): RuleEntry {
  return { id, statement: `Never break ${id}.`, detectors: [{ kind: "review" }] };
}

function repo(...ids: string[]): RuleSource {
  return { origin: "repo", file: "config/rules.config.ts", entries: ids.map(entry) };
}

function canon(tree: "shared" | "libs" | "apps", doc: string, ...ids: string[]): RuleSource {
  return { origin: "canon", file: `warden/src/rules/canon/${tree}/${doc.replace(".md", ".ts")}`, tree, doc, entries: ids.map(entry) };
}

function projectSite(id: string, overrides: Partial<RuleMarkerSite> = {}): RuleMarkerSite {
  return { id, corpus: "project", path: "docs/RULES.md", file: "docs/RULES.md", line: 7, section: "2b", opensBlock: true, block: "", ...overrides };
}

function canonSite(id: string, tree: "shared" | "libs" | "apps", path: string): RuleMarkerSite {
  return { id, corpus: "canon", tree, path, file: `warden/canon/${tree}/${path}`, line: 12, section: "5a", opensBlock: true, block: "" };
}

describe("buildRegister() — a rule that joins", () => {
  it("carries the statement, detectors and origin, with a rationale whose chunk knowledge_read serves", () => {
    const { rules, problems } = buildRegister([repo("forge-x")], [projectSite("forge-x")], "libs");

    expect(problems).toEqual([]);
    expect(rules).toEqual([
      {
        id: "forge-x",
        statement: "Never break forge-x.",
        detectors: [{ kind: "review" }],
        origin: "repo",
        scope: ["libs"],
        rationale: { corpus: "project", path: "docs/RULES.md", section: "2b", line: 7, chunk: "project:docs/RULES.md#2b" },
        declaredIn: "config/rules.config.ts",
      },
    ]);
  });

  const scopes = [
    { name: "a shared canon rule binds both trees", tree: "shared", doc: "AGENT_GUIDE.md", scope: ["libs", "apps"] },
    { name: "a libs canon rule binds libs", tree: "libs", doc: "TESTING.md", scope: ["libs"] },
    { name: "an apps canon rule binds apps", tree: "apps", doc: "TESTING.md", scope: ["apps"] },
  ] as const;
  for (const { name, tree, doc, scope } of scopes) {
    it(name, () => {
      const { rules } = buildRegister([canon(tree, doc, "rule-x")], [canonSite("rule-x", tree, doc)], "libs");

      expect(rules[0]?.scope).toEqual(scope);
      expect(rules[0]?.rationale).toEqual({ corpus: "canon", tree, path: doc, section: "5a", line: 12, chunk: `canon:${doc}#5a` });
    });
  }

  it("binds a repository's own rule to the repository's kind", () => {
    expect(buildRegister([repo("app-x")], [projectSite("app-x")], "apps").rules[0]?.scope).toEqual(["apps"]);
  });
});

describe("buildRegister() — problems", () => {
  it("reports an entry no marker names, against its rule file", () => {
    expect(buildRegister([repo("forge-x")], [], "libs").problems).toEqual([{ kind: "no-marker", id: "forge-x", file: "config/rules.config.ts" }]);
  });

  it("reports a marker no entry declares, at the marker", () => {
    expect(buildRegister([], [projectSite("forge-x")], "libs").problems).toEqual([
      { kind: "no-entry", id: "forge-x", file: "docs/RULES.md", line: 7 },
    ]);
  });

  it("reports a second entry for one id, naming the first file", () => {
    const { problems } = buildRegister([repo("forge-x"), canon("shared", "AGENT_GUIDE.md", "forge-x")], [projectSite("forge-x")], "libs");

    expect(problems).toEqual([
      { kind: "duplicate-entry", id: "forge-x", file: "warden/src/rules/canon/shared/AGENT_GUIDE.ts", other: "config/rules.config.ts" },
    ]);
  });

  it("reports a second marker for one id, naming the first", () => {
    const { problems } = buildRegister([repo("forge-x")], [projectSite("forge-x"), projectSite("forge-x", { line: 30 })], "libs");

    expect(problems).toEqual([{ kind: "duplicate-marker", id: "forge-x", file: "docs/RULES.md", line: 30, other: "docs/RULES.md:7" }]);
  });

  it("reports a canon entry marked in a repository document", () => {
    const { rules, problems } = buildRegister([canon("libs", "TESTING.md", "libs-testing-x")], [projectSite("libs-testing-x")], "libs");

    expect(rules).toEqual([]);
    expect(problems).toEqual([
      { kind: "origin-mismatch", id: "libs-testing-x", file: "docs/RULES.md", line: 7, other: "warden/src/rules/canon/libs/TESTING.ts" },
    ]);
  });

  it("reports a canon entry marked in a canon document other than the one its file mirrors", () => {
    const { problems } = buildRegister(
      [canon("libs", "TESTING.md", "libs-testing-x")],
      [canonSite("libs-testing-x", "apps", "TESTING.md")],
      "libs",
    );

    expect(problems.map((problem) => problem.kind)).toEqual(["origin-mismatch"]);
  });

  it("reports a repository entry marked in a canon document", () => {
    const { problems } = buildRegister([repo("forge-x")], [canonSite("forge-x", "shared", "AGENT_GUIDE.md")], "libs");

    expect(problems).toEqual([
      { kind: "origin-mismatch", id: "forge-x", file: "warden/canon/shared/AGENT_GUIDE.md", line: 12, other: "config/rules.config.ts" },
    ]);
  });

  it("reports a marker under no numbered section", () => {
    const { rules, problems } = buildRegister([repo("forge-x")], [projectSite("forge-x", { section: undefined })], "libs");

    expect(rules).toEqual([]);
    expect(problems).toEqual([{ kind: "no-section", id: "forge-x", file: "docs/RULES.md", line: 7 }]);
  });
});
