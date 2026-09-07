import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { copyTree, identical, sync, syncTrees, walk } from "./sync";

function tree(files: Record<string, string>, prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
  }
  return root;
}

describe("syncTrees()", () => {
  it("names the two .claude trees and nothing else — the canon is never copied", () => {
    expect(syncTrees("/warden/claude", "libs")).toEqual([
      { tree: ".claude/agents", from: "/warden/claude/agents/libs" },
      { tree: ".claude/commands", from: "/warden/claude/commands" },
    ]);
  });

  it("selects the agent tree by kind", () => {
    expect(syncTrees("/warden/claude", "apps")[0]?.from).toBe("/warden/claude/agents/apps");
  });
});

describe("walk()", () => {
  it("lists every file under a directory, nested and sorted", () => {
    const root = tree({ "b.md": "b", "a/c.md": "c", "a/b.md": "b" }, "warden-walk-");

    expect(walk(root)).toEqual([join("a", "b.md"), join("a", "c.md"), "b.md"]);
  });

  it("returns nothing for a directory that is not there", () => {
    expect(walk(join(tmpdir(), "warden-absent-directory"))).toEqual([]);
  });
});

describe("identical()", () => {
  it("compares bytes, not sizes alone", () => {
    const root = tree({ "a.md": "one", "b.md": "two", "c.md": "one" }, "warden-identical-");

    expect(identical(join(root, "a.md"), join(root, "c.md"))).toBe(true);
    expect(identical(join(root, "a.md"), join(root, "b.md"))).toBe(false);
  });

  it("reports two files of the same length differing in one byte as different", () => {
    const root = tree({ "a.md": "one", "b.md": "one".replace("e", "a") }, "warden-onebyte-");

    expect(identical(join(root, "a.md"), join(root, "b.md"))).toBe(false);
  });

  it("reports files of different lengths as different", () => {
    const root = tree({ "a.md": "one", "b.md": "one and more" }, "warden-length-");

    expect(identical(join(root, "a.md"), join(root, "b.md"))).toBe(false);
  });
});

describe("copyTree()", () => {
  it("reproduces the whole tree, nested directories included", () => {
    const from = tree({ "a.md": "a", "nested/b.md": "b" }, "warden-copy-from-");
    const to = join(mkdtempSync(join(tmpdir(), "warden-copy-to-")), "out");

    copyTree(from, to);

    expect(walk(to)).toEqual(["a.md", join("nested", "b.md")]);
    expect(readFileSync(join(to, "nested", "b.md"), "utf-8")).toBe("b");
  });
});

describe("sync()", () => {
  it("deletes the destination first, so a file the corpus dropped does not survive", () => {
    const from = tree({ "kept.md": "new" }, "warden-sync-from-");
    const repo = tree({ ".claude/agents/kept.md": "old", ".claude/agents/dropped.md": "gone" }, "warden-sync-repo-");

    expect(sync(repo, [{ tree: ".claude/agents", from }])).toEqual([".claude/agents"]);
    expect(readFileSync(join(repo, ".claude/agents/kept.md"), "utf-8")).toBe("new");
    expect(existsSync(join(repo, ".claude/agents/dropped.md"))).toBe(false);
  });

  it("leaves the destination intact when the copy fails partway", () => {
    const from = tree({ "kept.md": "new" }, "warden-sync-fail-from-");
    const repo = tree({ ".claude/agents/kept.md": "old" }, "warden-sync-fail-repo-");
    // A dangling symlink is read as a file and copied as one, so the copy throws partway — which is
    // exactly where the destination used to be already deleted with nothing to restore from.
    symlinkSync(join(from, "absent.md"), join(from, "broken.md"));

    expect(() => sync(repo, [{ tree: ".claude/agents", from }])).toThrow();
    expect(readFileSync(join(repo, ".claude/agents/kept.md"), "utf-8")).toBe("old");
  });

  it("skips a tree the installed corpus does not carry, writing nothing", () => {
    const repo = tree({ ".claude/agents/own.md": "own" }, "warden-sync-skip-");

    expect(sync(repo, [{ tree: ".claude/agents", from: join(tmpdir(), "warden-absent-source") }])).toEqual([]);
    expect(existsSync(join(repo, ".claude/agents/own.md"))).toBe(true);
  });
});
