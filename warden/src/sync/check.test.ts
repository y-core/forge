import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { check, checkAgents, checkTree } from "./check";

function tree(files: Record<string, string>, prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
  }
  return root;
}

describe("checkTree()", () => {
  it("reports nothing when the tree matches the corpus", () => {
    const from = tree({ "cc-dev.md": "dev" }, "warden-check-from-");
    const repo = tree({ ".claude/agents/cc-dev.md": "dev" }, "warden-check-repo-");

    expect(checkTree(repo, { tree: ".claude/agents", from })).toEqual([]);
  });

  it("names a missing, a modified and an extra file", () => {
    const from = tree({ "cc-dev.md": "dev", "cc-doc.md": "doc" }, "warden-check-drift-from-");
    const repo = tree({ ".claude/agents/cc-dev.md": "edited in place", ".claude/agents/cc-own.md": "local" }, "warden-check-drift-repo-");

    expect(checkTree(repo, { tree: ".claude/agents", from })).toEqual([
      { code: "modified", detail: ".claude/agents/cc-dev.md" },
      { code: "missing", detail: ".claude/agents/cc-doc.md" },
      { code: "extra", detail: ".claude/agents/cc-own.md" },
    ]);
  });
});

describe("checkAgents()", () => {
  it("reports nothing when every defined agent is named and every named agent is defined", () => {
    const repo = tree(
      { "CLAUDE.md": "delegate to cc-dev and cc-doc", ".claude/agents/cc-dev.md": "d", ".claude/agents/cc-doc.md": "d" },
      "warden-agents-ok-",
    );

    expect(checkAgents(repo)).toEqual([]);
  });

  it("names an agent CLAUDE.md names but nothing defines", () => {
    const repo = tree({ "CLAUDE.md": "delegate to cc-tester", ".claude/agents/cc-dev.md": "d" }, "warden-agents-undefined-");

    expect(checkAgents(repo)).toEqual([
      { code: "undefined", detail: "cc-tester — CLAUDE.md names it and .claude/agents does not define it" },
      { code: "unnamed", detail: "cc-dev — it is defined and CLAUDE.md never names it" },
    ]);
  });

  it("says so rather than passing when it measured nothing", () => {
    const repo = tree({ "CLAUDE.md": "no agent named here" }, "warden-agents-empty-");

    expect(checkAgents(repo)).toEqual([{ code: "absent", detail: "no agent is defined and none is named — this check measured nothing" }]);
  });
});

describe("check()", () => {
  it("runs every tree check and the agent reconciliation together", () => {
    const from = tree({ "cc-dev.md": "dev" }, "warden-check-all-from-");
    const repo = tree({ "CLAUDE.md": "delegate to cc-dev", ".claude/agents/cc-dev.md": "dev" }, "warden-check-all-repo-");

    expect(check(repo, [{ tree: ".claude/agents", from }])).toEqual([]);
  });
});
