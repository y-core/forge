import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { seed, seedFiles } from "./seed";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tree(files: Record<string, string>, prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
  }
  return root;
}

describe("seedFiles()", () => {
  it("selects the CLAUDE.md seed by kind and shares AGENTS.md — settings.json is synced, never seeded", () => {
    expect(seedFiles("/warden/claude", "apps")).toEqual([
      { file: "CLAUDE.md", from: "/warden/claude/seed/CLAUDE.apps.md" },
      { file: "AGENTS.md", from: "/warden/claude/seed/AGENTS.md" },
    ]);
  });
});

describe("seed()", () => {
  it("writes an absent file and never touches one that exists", () => {
    const source = tree({ "CLAUDE.md": "corpus", "AGENTS.md": "corpus" }, "warden-seed-from-");
    const repo = tree({ "CLAUDE.md": "the repository's own" }, "warden-seed-repo-");

    const results = seed(
      repo,
      [
        { file: "CLAUDE.md", from: join(source, "CLAUDE.md") },
        { file: "AGENTS.md", from: join(source, "AGENTS.md") },
      ],
      "forge",
    );

    expect(results).toEqual([
      { file: "CLAUDE.md", outcome: "kept" },
      { file: "AGENTS.md", outcome: "seeded" },
    ]);
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf-8")).toBe("the repository's own");
    expect(readFileSync(join(repo, "AGENTS.md"), "utf-8")).toBe("corpus");
  });

  it("creates the parent directory of a nested seed", () => {
    const source = tree({ "settings.json": "{}" }, "warden-seed-nested-from-");
    const repo = mkdtempSync(join(tmpdir(), "warden-seed-nested-repo-"));
    roots.push(repo);

    seed(repo, [{ file: ".claude/settings.json", from: join(source, "settings.json") }], "forge");

    expect(readFileSync(join(repo, ".claude/settings.json"), "utf-8")).toBe("{}");
  });

  it("reports nothing for a seed the installed corpus does not carry", () => {
    const repo = mkdtempSync(join(tmpdir(), "warden-seed-missing-"));
    roots.push(repo);

    expect(seed(repo, [{ file: "AGENTS.md", from: join(tmpdir(), "warden-absent-seed") }], "forge")).toEqual([]);
  });

  it("renders the slug into a seeded file", () => {
    const source = tree({ "CLAUDE.md": "/mcp/{{repo}}" }, "warden-seed-render-from-");
    const repo = mkdtempSync(join(tmpdir(), "warden-seed-render-repo-"));
    roots.push(repo);

    seed(repo, [{ file: "CLAUDE.md", from: join(source, "CLAUDE.md") }], "starter");

    expect(readFileSync(join(repo, "CLAUDE.md"), "utf-8")).toBe("/mcp/starter");
  });
});
