import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { seed, seedFiles } from "./seed";

function tree(files: Record<string, string>, prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
  }
  return root;
}

describe("seedFiles()", () => {
  it("selects the CLAUDE.md seed by kind and shares the other two", () => {
    expect(seedFiles("/warden/claude", "apps")).toEqual([
      { file: "CLAUDE.md", from: "/warden/claude/seed/CLAUDE.apps.md" },
      { file: "AGENTS.md", from: "/warden/claude/seed/AGENTS.md" },
      { file: ".claude/settings.local.json", from: "/warden/claude/seed/settings.local.json" },
    ]);
  });
});

describe("seed()", () => {
  it("writes an absent file and never touches one that exists", () => {
    const source = tree({ "CLAUDE.md": "corpus", "AGENTS.md": "corpus" }, "warden-seed-from-");
    const repo = tree({ "CLAUDE.md": "the repository's own" }, "warden-seed-repo-");

    const results = seed(repo, [
      { file: "CLAUDE.md", from: join(source, "CLAUDE.md") },
      { file: "AGENTS.md", from: join(source, "AGENTS.md") },
    ]);

    expect(results).toEqual([
      { file: "CLAUDE.md", outcome: "kept" },
      { file: "AGENTS.md", outcome: "seeded" },
    ]);
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf-8")).toBe("the repository's own");
    expect(readFileSync(join(repo, "AGENTS.md"), "utf-8")).toBe("corpus");
  });

  it("creates the parent directory of a nested seed", () => {
    const source = tree({ "settings.local.json": "{}" }, "warden-seed-nested-from-");
    const repo = mkdtempSync(join(tmpdir(), "warden-seed-nested-repo-"));

    seed(repo, [{ file: ".claude/settings.local.json", from: join(source, "settings.local.json") }]);

    expect(readFileSync(join(repo, ".claude/settings.local.json"), "utf-8")).toBe("{}");
  });

  it("reports nothing for a seed the installed corpus does not carry", () => {
    const repo = mkdtempSync(join(tmpdir(), "warden-seed-missing-"));

    expect(seed(repo, [{ file: "AGENTS.md", from: join(tmpdir(), "warden-absent-seed") }])).toEqual([]);
  });
});
