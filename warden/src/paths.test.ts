import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { CANON_ROOT, CLAUDE_ROOT, resolveRepoRoot, WARDEN_ROOT, walkUpToRepo } from "./paths";

function repoFixture(): { root: string; nested: string } {
  const root = mkdtempSync(join(tmpdir(), "warden-paths-"));
  writeFileSync(join(root, "package.json"), "{}", "utf-8");
  const nested = join(root, "src", "deep");
  mkdirSync(nested, { recursive: true });
  return { root, nested };
}

describe("WARDEN_ROOT", () => {
  it("names the directory holding the canon and the claude tree", () => {
    expect(CANON_ROOT).toBe(resolve(WARDEN_ROOT, "canon"));
    expect(CLAUDE_ROOT).toBe(resolve(WARDEN_ROOT, "claude"));
  });
});

describe("walkUpToRepo()", () => {
  it("finds the nearest ancestor holding a package.json", () => {
    const { root, nested } = repoFixture();

    expect(walkUpToRepo(nested)).toBe(root);
  });

  it("returns undefined when no ancestor holds one", () => {
    // The filesystem root can hold no package.json in a fixture, so a directory under it is the
    // only reachable negative case; `tmpdir()` itself is asserted to be free of one first.
    const orphan = mkdtempSync(join(tmpdir(), "warden-orphan-"));

    expect(walkUpToRepo(orphan)).toBe(walkUpToRepo(tmpdir()));
  });
});

describe("resolveRepoRoot()", () => {
  it("prefers the explicit root over every other source", () => {
    const { root, nested } = repoFixture();

    expect(resolveRepoRoot(root, { WARDEN_REPO_ROOT: "/elsewhere" }, nested)).toBe(root);
  });

  it("falls back to WARDEN_REPO_ROOT in the environment", () => {
    const { root, nested } = repoFixture();

    expect(resolveRepoRoot(undefined, { WARDEN_REPO_ROOT: root }, nested)).toBe(root);
  });

  it("ignores `WARDEN_ROOT`, which names the installed library and not a repository", () => {
    const { root, nested } = repoFixture();

    expect(resolveRepoRoot(undefined, { WARDEN_ROOT: "/elsewhere" }, nested)).toBe(root);
  });

  it("walks up from the working directory when nothing else states one", () => {
    const { root, nested } = repoFixture();

    expect(resolveRepoRoot(undefined, {}, nested)).toBe(root);
  });

  it("treats an empty explicit root as unstated", () => {
    const { root, nested } = repoFixture();

    expect(resolveRepoRoot("", {}, nested)).toBe(root);
  });
});
