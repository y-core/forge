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
  it("selects the CLAUDE.md seed by kind and shares the other two", () => {
    expect(seedFiles("/warden/claude", "apps")).toEqual([
      { file: "CLAUDE.md", from: "/warden/claude/seed/CLAUDE.apps.md" },
      { file: "AGENTS.md", from: "/warden/claude/seed/AGENTS.md" },
      { file: ".claude/settings.json", from: "/warden/claude/seed/settings.json" },
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
    const source = tree({ "settings.json": "{}" }, "warden-seed-nested-from-");
    const repo = mkdtempSync(join(tmpdir(), "warden-seed-nested-repo-"));
    roots.push(repo);

    seed(repo, [{ file: ".claude/settings.json", from: join(source, "settings.json") }]);

    expect(readFileSync(join(repo, ".claude/settings.json"), "utf-8")).toBe("{}");
  });

  it("reports nothing for a seed the installed corpus does not carry", () => {
    const repo = mkdtempSync(join(tmpdir(), "warden-seed-missing-"));
    roots.push(repo);

    expect(seed(repo, [{ file: "AGENTS.md", from: join(tmpdir(), "warden-absent-seed") }])).toEqual([]);
  });
});

describe("the shipped settings seed", () => {
  const settings = JSON.parse(readFileSync(join(import.meta.dir, "../../claude/seed/settings.json"), "utf-8"));
  const forge = JSON.parse(readFileSync(join(import.meta.dir, "../../../.claude/settings.json"), "utf-8"));

  it("denies every git write the forge settings deny, and allows no git verb wholesale", () => {
    expect(settings.permissions.deny).toEqual(forge.permissions.deny);
    expect(settings.permissions.allow).not.toContain("Bash(git *)");
  });

  it("leaves the permission mode to the user, as the forge settings do", () => {
    expect(settings.permissions.defaultMode).toBeUndefined();
  });

  it("allows the one exit-status spelling and no variant, in the seed and in forge's own settings", () => {
    for (const allow of [settings.permissions.allow, forge.permissions.allow]) {
      expect(allow.filter((rule: string) => rule.includes("$?"))).toEqual(['Bash(echo "EXIT:$?")']);
    }
  });

  it("uses only the space-separated wildcard syntax", () => {
    expect(settings.permissions.allow.filter((rule: string) => rule.includes(":*"))).toEqual([]);
  });

  it("enables both MCP servers the agents reach", () => {
    expect(settings.enabledMcpjsonServers).toEqual(["ledger", "warden"]);
  });

  it("leaves the bundled /code-review to a person, in the seed and in forge's own settings, so warden-review takes review requests", () => {
    for (const overrides of [settings.skillOverrides, forge.skillOverrides]) {
      expect(overrides).toEqual({ "code-review": "user-invocable-only" });
    }
  });
});
