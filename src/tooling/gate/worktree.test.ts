import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { gateFixtureRoot } from "./checks/gate.fixture";
import { worktreeChanges, worktreeGitEnv, worktreeGitPath, worktreeHash } from "./worktree";
import { worktreeFixture } from "./worktree.fixture";

const FILES = { ".gitignore": "ignored.log\n", "a.txt": "alpha\n", "src/b.txt": "beta\n" };

function gitIn(root: string, args: string[]): void {
  spawnSync("git", args, { cwd: root, stdio: "ignore" });
}

function headTree(root: string): string {
  return spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf-8" }).stdout?.trim() ?? "";
}

function porcelainStatus(root: string): string {
  return spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf-8" }).stdout ?? "";
}

function withGitEnv<T>(vars: Record<string, string>, run: () => T): T {
  const saved = Object.keys(vars).map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, vars);
  try {
    return run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("worktreeHash()", () => {
  it("equals the tree of HEAD on a clean checkout", () => {
    const root = worktreeFixture(FILES);

    expect(worktreeHash(root)).toBe(headTree(root));
  });

  it("ignores a file the repository ignores", () => {
    const root = worktreeFixture(FILES);
    const clean = worktreeHash(root);
    writeFileSync(join(root, "ignored.log"), "noise\n");

    expect(worktreeHash(root)).toBe(clean);
  });

  it("changes on an edit, an untracked file and a deletion, and returns once each is reverted", () => {
    const root = worktreeFixture(FILES);
    const clean = worktreeHash(root);

    writeFileSync(join(root, "a.txt"), "edited\n");
    expect(worktreeHash(root)).not.toBe(clean);
    writeFileSync(join(root, "a.txt"), "alpha\n");
    expect(worktreeHash(root)).toBe(clean);

    writeFileSync(join(root, "new.txt"), "new\n");
    expect(worktreeHash(root)).not.toBe(clean);
    rmSync(join(root, "new.txt"));
    expect(worktreeHash(root)).toBe(clean);

    rmSync(join(root, "src/b.txt"));
    expect(worktreeHash(root)).not.toBe(clean);
    writeFileSync(join(root, "src/b.txt"), "beta\n");
    expect(worktreeHash(root)).toBe(clean);
  });

  it("leaves the real index byte-identical on a dirty tree", () => {
    const root = worktreeFixture(FILES);
    writeFileSync(join(root, "a.txt"), "edited\n");
    writeFileSync(join(root, "new.txt"), "new\n");
    const before = readFileSync(join(root, ".git/index"));
    worktreeHash(root);

    expect(readFileSync(join(root, ".git/index")).equals(before)).toBe(true);
  });

  it("hashes a nested repository as its HEAD commit, so an uncommitted edit inside it leaves the hash unchanged", () => {
    const root = worktreeFixture(FILES);
    const outer = worktreeHash(root);
    const nested = join(root, "vendor/inner");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "n.txt"), "nested\n");
    gitIn(nested, ["init", "-q"]);
    gitIn(nested, ["add", "-A"]);
    gitIn(nested, ["-c", "user.name=gate", "-c", "user.email=gate@fixture.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "nested"]);
    const committed = worktreeHash(root);
    writeFileSync(join(nested, "n.txt"), "edited\n");

    expect(committed).not.toBe(outer);
    expect(worktreeHash(root)).toBe(committed);
  });

  it("is undefined outside a git work tree", () => {
    expect(worktreeHash(gateFixtureRoot())).toBeUndefined();
  });
});

describe("worktreeGitPath()", () => {
  it("resolves a name under .git from the root and from a subdirectory", () => {
    const root = worktreeFixture(FILES);
    mkdirSync(join(root, "src/deep"), { recursive: true });
    const gitDir = realpathSync(join(root, ".git"));
    const fromRoot = worktreeGitPath(root, "forge-verify-receipt.json") ?? "";
    const fromDeep = worktreeGitPath(join(root, "src/deep"), "forge-verify-receipt.json") ?? "";

    expect(basename(fromRoot)).toBe("forge-verify-receipt.json");
    expect(realpathSync(dirname(fromRoot))).toBe(gitDir);
    expect(basename(fromDeep)).toBe("forge-verify-receipt.json");
    expect(realpathSync(dirname(fromDeep))).toBe(gitDir);
  });

  it("is undefined outside a git work tree", () => {
    expect(worktreeGitPath(gateFixtureRoot(), "index")).toBeUndefined();
  });
});

describe("worktreeChanges()", () => {
  it("is empty on a clean tree", () => {
    expect(worktreeChanges(worktreeFixture(FILES))).toEqual([]);
  });

  it("lists an edited, a staged, an untracked and a deleted file, and omits an ignored one", () => {
    const root = worktreeFixture({ ...FILES, "c.txt": "gamma\n", "d.txt": "delta\n" });
    writeFileSync(join(root, "a.txt"), "edited\n");
    writeFileSync(join(root, "c.txt"), "staged\n");
    gitIn(root, ["add", "c.txt"]);
    writeFileSync(join(root, "new.txt"), "new\n");
    rmSync(join(root, "d.txt"));
    writeFileSync(join(root, "ignored.log"), "noise\n");

    expect(worktreeChanges(root)).toEqual(["a.txt", "c.txt", "d.txt", "new.txt"]);
  });

  it("lists both halves of a rename", () => {
    const root = worktreeFixture(FILES);
    gitIn(root, ["mv", "a.txt", "moved.txt"]);

    expect(worktreeChanges(root)).toEqual(["a.txt", "moved.txt"]);
  });

  it("reports paths relative to a subdirectory cwd, an outside change as ../", () => {
    const root = worktreeFixture(FILES);
    writeFileSync(join(root, "src/b.txt"), "edited\n");
    writeFileSync(join(root, "a.txt"), "edited\n");

    expect(worktreeChanges(join(root, "src"))).toEqual(["../a.txt", "b.txt"]);
  });

  it("lists every file in a repository with no commit yet", () => {
    const root = gateFixtureRoot(FILES, "forge-worktree-");
    gitIn(root, ["init", "-q"]);

    expect(worktreeChanges(root)).toEqual([".gitignore", "a.txt", "src/b.txt"]);
  });

  it("is undefined outside a git work tree", () => {
    expect(worktreeChanges(gateFixtureRoot())).toBeUndefined();
  });
});

describe("worktreeGitEnv()", () => {
  it("drops git's repository-location variables and keeps the rest of the environment", () => {
    const env = withGitEnv({ GIT_DIR: "/elsewhere/.git", GIT_INDEX_FILE: "/elsewhere/index", GIT_WORK_TREE: "/elsewhere" }, worktreeGitEnv);

    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_INDEX_FILE).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
  });
});

describe("under a hook's GIT_DIR and GIT_INDEX_FILE", () => {
  it("answers for the cwd's repository and leaves the named one untouched", () => {
    const root = worktreeFixture(FILES);
    const other = worktreeFixture({ "z.txt": "zeta\n" });
    writeFileSync(join(root, "new.txt"), "new\n");
    const otherIndex = readFileSync(join(other, ".git/index"));
    const otherTree = headTree(other);
    const hooked = { GIT_DIR: join(other, ".git"), GIT_INDEX_FILE: join(other, ".git/index") };

    const [hash, changes] = withGitEnv(hooked, () => [worktreeHash(root), worktreeChanges(root)] as const);

    expect(changes).toEqual(["new.txt"]);
    expect(hash).toBe(worktreeHash(root));
    expect(hash).not.toBe(otherTree);
    expect(readFileSync(join(other, ".git/index")).equals(otherIndex)).toBe(true);
    expect(headTree(other)).toBe(otherTree);
    expect(porcelainStatus(other)).toBe("");
  });
});
