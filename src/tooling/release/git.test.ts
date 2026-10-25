import { describe, expect, it, mock } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { SpawnOutcome, SpawnSync } from "../cli/types";
import { worktreeGitEnv } from "../cli/worktree";
import { worktreeFixture } from "../cli/worktree.fixture";
import * as git from "./git";
import { ReleaseError } from "./types";

// The injected seam, not `mock.module`: a module mock is process-global and Bun never restores it,
// so it reaches whatever loads `node:child_process` after this file and decides by load order.
const mockSpawnSync = mock<SpawnSync>(() => answered(""));

function answered(stdout: string): SpawnOutcome {
  return { status: 0, stdout, stderr: "" };
}

function failed(status: number, stderr: string, stdout = ""): SpawnOutcome {
  return { status, stderr, stdout };
}

const gitExec = (args: string[], cwd: string) => git.gitExec(args, cwd, mockSpawnSync);
const isWorkingTreeClean = (cwd: string) => git.isWorkingTreeClean(cwd, mockSpawnSync);
const getLatestTag = (cwd: string, prefix: string) => git.getLatestTag(cwd, prefix, mockSpawnSync);
const getCommitsSinceTag = (cwd: string, tag: string) => git.getCommitsSinceTag(cwd, tag, mockSpawnSync);
const getLastCommitMessage = (cwd: string) => git.getLastCommitMessage(cwd, mockSpawnSync);
const createTag = (cwd: string, tag: string) => git.createTag(cwd, tag, mockSpawnSync);
const commit = (cwd: string, message: string, files: string[]) => git.commit(cwd, message, files, mockSpawnSync);
const tagExists = (cwd: string, tag: string) => git.tagExists(cwd, tag, mockSpawnSync);
const readFileAtRef = (cwd: string, ref: string, path: string) => git.readFileAtRef(cwd, ref, path, mockSpawnSync);
const tagIsAncestorOfHead = (cwd: string, tag: string) => git.tagIsAncestorOfHead(cwd, tag, mockSpawnSync);
const remoteTags = (cwd: string, remote?: string) => git.remoteTags(cwd, remote, mockSpawnSync);
const currentBranch = (cwd: string) => git.currentBranch(cwd, mockSpawnSync);
const defaultBranch = (cwd: string, remote?: string) => git.defaultBranch(cwd, remote, mockSpawnSync);

describe("gitExec()", () => {
  it("returns trimmed stdout", () => {
    mockSpawnSync.mockReturnValue(answered("  hello world  "));
    expect(gitExec(["status"], "/cwd")).toBe("hello world");
  });

  it("captures stderr rather than letting git print it to the terminal", () => {
    mockSpawnSync.mockReturnValue(answered(""));
    mockSpawnSync.mockClear();
    gitExec(["show", "v1.0.0:package.json"], "/cwd");
    expect(mockSpawnSync.mock.calls[0]![2]).toMatchObject({ stdio: ["ignore", "pipe", "pipe"] });
  });

  it("throws ReleaseError when git exits non-zero", () => {
    mockSpawnSync.mockReturnValue(failed(128, ""));
    expect(() => gitExec(["status"], "/cwd")).toThrow("git status failed:");
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("uses stderr text when git wrote to stderr", () => {
    mockSpawnSync.mockReturnValue(failed(1, "nothing to commit, working tree clean"));
    expect(() => gitExec(["commit", "-m", "test"], "/cwd")).toThrow("git commit failed: nothing to commit, working tree clean");
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("falls back to stdout when stderr is empty", () => {
    mockSpawnSync.mockReturnValue(failed(1, "", "some stdout text"));
    expect(() => gitExec(["commit", "-m", "test"], "/cwd")).toThrow("git commit failed: some stdout text");
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("falls back to the exit code when both stderr and stdout are empty", () => {
    mockSpawnSync.mockReturnValue(failed(128, ""));
    expect(() => gitExec(["commit", "-m", "test"], "/cwd")).toThrow("git commit failed: exit 128");
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("throws a ReleaseError carrying the spawn error when git never started", () => {
    mockSpawnSync.mockReturnValue({ status: null, error: new Error("spawnSync git ENOENT") });
    expect(() => gitExec(["status"], "/cwd")).toThrow(new ReleaseError("git-error", "git status failed: spawnSync git ENOENT"));
    expect(() => gitExec(["status"], "/cwd")).toThrow(ReleaseError);
    mockSpawnSync.mockReturnValue(answered(""));
  });
});

describe("isWorkingTreeClean()", () => {
  it("returns true for empty porcelain output", () => {
    mockSpawnSync.mockReturnValue(answered(""));
    expect(isWorkingTreeClean("/cwd")).toBe(true);
  });

  it("returns false when there are uncommitted changes", () => {
    mockSpawnSync.mockReturnValue(answered(" M src/file.ts\n"));
    expect(isWorkingTreeClean("/cwd")).toBe(false);
  });
});

describe("getLatestTag()", () => {
  it("returns null when there are no tags", () => {
    mockSpawnSync.mockReturnValue(answered(""));
    expect(getLatestTag("/cwd", "v")).toBeNull();
  });

  it("returns the first (highest) tag from sorted output", () => {
    mockSpawnSync.mockReturnValue(answered("v0.3.0\nv0.2.0\nv0.1.0"));
    expect(getLatestTag("/cwd", "v")).toBe("v0.3.0");
  });

  it("skips a prerelease git sorted above the release it precedes", () => {
    mockSpawnSync.mockReturnValue(answered("v1.0.0-rc.1\nv1.0.0\nv0.9.0"));
    expect(getLatestTag("/cwd", "v")).toBe("v1.0.0");
  });

  it("returns null when no listed tag is a release version", () => {
    mockSpawnSync.mockReturnValue(answered("v1.0.0-rc.1\nvnightly"));
    expect(getLatestTag("/cwd", "v")).toBeNull();
  });
});

describe("getCommitsSinceTag()", () => {
  it("returns an empty array when there are no commits since the tag", () => {
    mockSpawnSync.mockReturnValue(answered(""));
    expect(getCommitsSinceTag("/cwd", "v0.1.0")).toEqual([]);
  });

  it("splits commit lines into an array", () => {
    mockSpawnSync.mockReturnValue(answered("abc1234 feat: add thing\ndef5678 fix: bug"));
    expect(getCommitsSinceTag("/cwd", "v0.1.0")).toEqual(["abc1234 feat: add thing", "def5678 fix: bug"]);
  });
});

describe("tagIsAncestorOfHead()", () => {
  it("returns true when merge-base exits zero", () => {
    mockSpawnSync.mockReturnValue(answered(""));
    expect(tagIsAncestorOfHead("/cwd", "v1.0.0")).toBe(true);
    expect(mockSpawnSync.mock.calls.at(-1)![1]).toEqual(["merge-base", "--is-ancestor", "v1.0.0", "HEAD"]);
  });

  it("returns false on exit 1, which is merge-base answering 'no'", () => {
    mockSpawnSync.mockReturnValue(failed(1, ""));
    expect(tagIsAncestorOfHead("/cwd", "v1.0.0")).toBe(false);
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("throws on any other exit, so git failing to answer does not read as a rewrite", () => {
    mockSpawnSync.mockReturnValue(failed(128, "not a valid object name"));
    expect(() => tagIsAncestorOfHead("/cwd", "v9.9.9")).toThrow("git merge-base failed: not a valid object name");
    mockSpawnSync.mockReturnValue(answered(""));
  });

  for (const [cause, outcome] of [
    ["a spawn error", { status: null, error: new Error("spawnSync git EAGAIN") }],
    ["a kill by signal", { status: null }],
  ] as const) {
    it(`throws git-error rather than answering false when git never exited, after ${cause}`, () => {
      mockSpawnSync.mockReturnValue(outcome);
      let thrown: unknown;
      try {
        tagIsAncestorOfHead("/cwd", "v1.0.0");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ReleaseError);
      expect((thrown as ReleaseError).kind).toBe("git-error");
      mockSpawnSync.mockReturnValue(answered(""));
    });
  }
});

describe("remoteTags()", () => {
  it("strips the refs/tags prefix from each line", () => {
    mockSpawnSync.mockReturnValue(answered("abc123\trefs/tags/v0.1.0\ndef456\trefs/tags/v0.2.0"));
    expect(remoteTags("/cwd")).toEqual(["v0.1.0", "v0.2.0"]);
  });

  it("collapses the ^{} dereference line an annotated tag adds", () => {
    mockSpawnSync.mockReturnValue(answered("abc123\trefs/tags/v0.1.0\ndef456\trefs/tags/v0.1.0^{}"));
    expect(remoteTags("/cwd")).toEqual(["v0.1.0", "v0.1.0"]);
  });

  it("asks the named remote, defaulting to origin", () => {
    mockSpawnSync.mockReturnValue(answered(""));
    void remoteTags("/cwd");
    expect(mockSpawnSync.mock.calls.at(-1)![1]).toEqual(["ls-remote", "--tags", "origin"]);
    void remoteTags("/cwd", "upstream");
    expect(mockSpawnSync.mock.calls.at(-1)![1]).toEqual(["ls-remote", "--tags", "upstream"]);
  });

  it("returns an empty array for a remote carrying no tags", () => {
    mockSpawnSync.mockReturnValue(answered(""));
    expect(remoteTags("/cwd")).toEqual([]);
  });

  it("returns null when the remote cannot be reached", () => {
    mockSpawnSync.mockReturnValue(failed(128, "Could not resolve host: github.com"));
    expect(remoteTags("/cwd")).toBeNull();
    mockSpawnSync.mockReturnValue(answered(""));
  });
});

describe("getLastCommitMessage()", () => {
  it("returns the trimmed subject of the last commit", () => {
    mockSpawnSync.mockReturnValue(answered("minor: add new feature"));
    expect(getLastCommitMessage("/cwd")).toBe("minor: add new feature");
  });
});

describe("readFileAtRef()", () => {
  it("returns the file contents at the ref", () => {
    mockSpawnSync.mockReturnValue(answered("export { thing } from './thing';"));
    expect(readFileAtRef("/cwd", "v1.0.0", "src/http/mod.ts")).toBe("export { thing } from './thing';");
  });

  it("asks git for `<ref>:<path>`", () => {
    mockSpawnSync.mockReturnValue(answered(""));
    mockSpawnSync.mockClear();
    readFileAtRef("/cwd", "v1.0.0", "src/http/mod.ts");
    expect(mockSpawnSync.mock.calls[0]![1]).toEqual(["show", "v1.0.0:src/http/mod.ts"]);
  });

  it("returns null when the path did not exist at a resolvable ref", () => {
    mockSpawnSync.mockImplementation((_cmd, args) => {
      if (args[0] === "show") return failed(128, "fatal: path 'src/new/mod.ts' does not exist in 'v1.0.0'");
      return answered("0f1e2d3");
    });
    expect(readFileAtRef("/cwd", "v1.0.0", "src/new/mod.ts")).toBeNull();
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("verifies the ref itself before reading an absent path as data", () => {
    mockSpawnSync.mockImplementation((_cmd, args) => {
      if (args[0] === "show") return failed(128, "fatal: path does not exist");
      return answered("0f1e2d3");
    });
    mockSpawnSync.mockClear();
    readFileAtRef("/cwd", "v1.0.0", "src/new/mod.ts");
    expect(mockSpawnSync.mock.calls[1]![1]).toEqual(["rev-parse", "--verify", "v1.0.0^{object}"]);
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("throws instead of returning null when git cannot resolve the ref", () => {
    mockSpawnSync.mockReturnValue(failed(128, "fatal: invalid object name 'v99.99.99'"));
    expect(() => readFileAtRef("/cwd", "v99.99.99", "package.json")).toThrow(
      "git could not resolve v99.99.99: git show failed: fatal: invalid object name 'v99.99.99'",
    );
    mockSpawnSync.mockReturnValue(answered(""));
  });
});

describe("createTag()", () => {
  it("spawns git with the correct arg array", () => {
    mockSpawnSync.mockReturnValue(answered(""));
    mockSpawnSync.mockClear();
    createTag("/cwd", "v1.2.3");
    expect(mockSpawnSync.mock.calls).toHaveLength(1);
    expect(mockSpawnSync.mock.calls[0]![0]).toBe("git");
    expect(mockSpawnSync.mock.calls[0]![1]).toEqual(["tag", "v1.2.3"]);
  });

  it("passes shell metacharacters in tag names as-is without interpretation", () => {
    mockSpawnSync.mockReturnValue(answered(""));
    mockSpawnSync.mockClear();
    createTag("/cwd", "v1.0.0; rm -rf /");
    expect(mockSpawnSync.mock.calls[0]![1]).toEqual(["tag", "v1.0.0; rm -rf /"]);
  });
});

function caught(run: () => unknown): ReleaseError {
  try {
    run();
  } catch (err) {
    if (err instanceof ReleaseError) return err;
    throw err;
  }
  throw new Error("expected a ReleaseError");
}

describe("commit()", () => {
  const RELEASE = ["package.json", "CHANGELOG.md"];

  function answerPlumbing(diffStatus: number, ...rest: SpawnOutcome[]): void {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValueOnce(answered("head0000\n"));
    mockSpawnSync.mockReturnValueOnce(answered(""));
    mockSpawnSync.mockReturnValueOnce(answered(""));
    mockSpawnSync.mockReturnValueOnce(diffStatus === 0 ? answered("") : failed(diffStatus, ""));
    for (const outcome of rest) mockSpawnSync.mockReturnValueOnce(outcome);
  }

  function answerCommit(signing: SpawnOutcome, ...rest: SpawnOutcome[]): void {
    answerPlumbing(1, answered("tree0000\n"), signing, answered("next00001234\n"), ...rest);
  }

  const UNSET = failed(1, "");

  function callArgs(): string[][] {
    return mockSpawnSync.mock.calls.map((c) => c[1]);
  }

  function indexOf(call: number): string | undefined {
    return mockSpawnSync.mock.calls[call]![2].env?.GIT_INDEX_FILE;
  }

  it("builds the commit with plumbing on HEAD, compare-and-swaps the ref and checks the index it leaves", () => {
    answerCommit(UNSET, answered(""), answered(""), answered(""));

    expect(commit("/cwd", "chore: release 1.0.0", RELEASE)).toBe(true);
    expect(callArgs()).toEqual([
      ["rev-parse", "--verify", "HEAD"],
      ["read-tree", "head0000"],
      ["add", "--", "package.json", "CHANGELOG.md"],
      ["diff", "--cached", "--quiet", "head0000"],
      ["write-tree"],
      ["config", "--bool", "commit.gpgsign"],
      ["commit-tree", "tree0000", "-p", "head0000", "-m", "chore: release 1.0.0"],
      ["update-ref", "-m", "commit: chore: release 1.0.0", "HEAD", "next00001234", "head0000"],
      ["reset", "-q", "--", "package.json", "CHANGELOG.md"],
      ["diff", "--cached", "--name-only", "HEAD"],
    ]);
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("signs the commit when commit.gpgsign is true, as git commit would", () => {
    answerCommit(answered("true\n"), answered(""), answered(""), answered(""));

    commit("/cwd", "chore: release 1.0.0", RELEASE);
    expect(callArgs()[6]).toEqual(["commit-tree", "tree0000", "-p", "head0000", "-S", "-m", "chore: release 1.0.0"]);
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("does not sign when commit.gpgsign is false", () => {
    answerCommit(answered("false\n"), answered(""), answered(""), answered(""));

    commit("/cwd", "chore: release 1.0.0", RELEASE);
    expect(callArgs()[6]).not.toContain("-S");
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("touches only a private index under the temp directory, never the repository's or an inherited one", () => {
    const inherited = process.env["GIT_INDEX_FILE"];
    process.env["GIT_INDEX_FILE"] = "/elsewhere/index";
    try {
      answerCommit(UNSET, answered(""), answered(""), answered(""));
      commit("/cwd", "chore: release 1.0.0", RELEASE);
    } finally {
      if (inherited === undefined) delete process.env["GIT_INDEX_FILE"];
      else process.env["GIT_INDEX_FILE"] = inherited;
    }

    const privateIndex = indexOf(1);
    expect(privateIndex?.startsWith(tmpdir())).toBe(true);
    expect([indexOf(2), indexOf(3), indexOf(4)]).toEqual([privateIndex, privateIndex, privateIndex]);
    expect([0, 5, 6, 7, 8, 9].map(indexOf)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(existsSync(dirname(privateIndex!))).toBe(false);
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("returns false and writes nothing when none of the files changed", () => {
    answerPlumbing(0);

    expect(commit("/cwd", "chore: release 1.0.0", RELEASE)).toBe(false);
    expect(callArgs().map((args) => args[0])).toEqual(["rev-parse", "read-tree", "add", "diff"]);
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("throws when git diff fails rather than answering whether anything changed", () => {
    answerPlumbing(128);

    expect(() => commit("/cwd", "chore: release 1.0.0", RELEASE)).toThrow(new ReleaseError("git-error", "git diff failed: exit 128"));
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("surfaces a moved HEAD as a ReleaseError and leaves the index alone", () => {
    answerCommit(UNSET, failed(128, "fatal: cannot lock ref 'HEAD': is at other000 but expected head0000"));

    expect(() => commit("/cwd", "chore: release 1.0.0", RELEASE)).toThrow(
      new ReleaseError("git-error", "git update-ref failed: fatal: cannot lock ref 'HEAD': is at other000 but expected head0000"),
    );
    expect(callArgs().some((args) => args[0] === "reset")).toBe(false);
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("reports an index it could not bring in line as index-stale, naming the commit and the fix", () => {
    answerCommit(UNSET, answered(""), failed(128, "fatal: index.lock exists"));

    const err = caught(() => commit("/cwd", "chore: release 1.0.0", RELEASE));
    expect(err.kind).toBe("index-stale");
    expect(err.message).toBe(
      'next0000 "chore: release 1.0.0" landed, but the index still holds the old package.json CHANGELOG.md: git reset failed: fatal: index.lock exists\n' +
        "Bring it in line with:\n  git reset -q -- package.json CHANGELOG.md",
    );
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("reports a reset that succeeded on a truncated index as index-stale rather than success", () => {
    answerCommit(UNSET, answered(""), answered(""), answered("README.md\nsrc/a.ts\nsrc/b.ts\nsrc/c.ts\n"));

    const err = caught(() => commit("/cwd", "chore: release 1.0.0", RELEASE));
    expect(err.kind).toBe("index-stale");
    expect(err.message).toBe(
      'next0000 "chore: release 1.0.0" landed, but the index no longer matches it at 4 path(s), README.md, src/a.ts, src/b.ts among them.\n' +
        "Unless you staged those yourself, restore it from the commit with:\n  git reset -q",
    );
    mockSpawnSync.mockReturnValue(answered(""));
  });
});

describe("commit() against a real repository", () => {
  const FILES = ["package.json", "CHANGELOG.md", "config/changelog-sections.json"];

  function releaseFixture(config: string): string {
    const root = worktreeFixture({
      "package.json": '{ "version": "1.0.0" }\n',
      "CHANGELOG.md": "# Changelog\n",
      "config/changelog-sections.json": "{}\n",
      "src/mod.ts": "export {};\n",
      "README.md": "# fixture\n",
    });
    const gitConfig = join(root, ".git", "config");
    writeFileSync(gitConfig, readFileSync(gitConfig, "utf-8") + `[user]\n\tname = gate\n\temail = gate@fixture.invalid\n${config}`);
    writeFileSync(join(root, "package.json"), '{ "version": "1.0.1" }\n');
    writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## [1.0.1]\n");
    writeFileSync(join(root, "config/changelog-sections.json"), '{ "1.0.1": [] }\n');
    return root;
  }

  const readGit = (root: string, args: string[]) => git.gitExec(args, root, undefined, worktreeGitEnv());

  it("commits HEAD's whole tree plus the release files when the index is gone, and reports the index the reset left", () => {
    const root = releaseFixture("[commit]\n\tgpgsign = false\n");
    try {
      rmSync(join(root, ".git", "index"));

      expect(caught(() => git.commit(root, "chore: release 1.0.1", FILES)).kind).toBe("index-stale");
      const tree = readGit(root, ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n");
      expect(tree.sort()).toEqual(["CHANGELOG.md", "README.md", "config/changelog-sections.json", "package.json", "src/mod.ts"]);
      expect(git.committedPaths(root).sort()).toEqual([...FILES].sort());
      expect(git.readFileAtRef(root, "HEAD", "package.json")).toBe('{ "version": "1.0.1" }');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves the index matching the commit when the index is intact", () => {
    const root = releaseFixture("[commit]\n\tgpgsign = false\n");
    try {
      expect(git.commit(root, "chore: release 1.0.1", FILES)).toBe(true);
      expect(readGit(root, ["diff", "--cached", "--name-only", "HEAD"])).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("asks the signing program under commit.gpgsign, and moves no ref when it refuses", () => {
    const root = releaseFixture("[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n");
    try {
      const before = readGit(root, ["rev-parse", "HEAD"]);

      expect(caught(() => git.commit(root, "chore: release 1.0.1", FILES)).message).toStartWith("git commit-tree failed:");
      expect(readGit(root, ["rev-parse", "HEAD"])).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("committedPaths()", () => {
  it("lists what HEAD changed against its parent, relative to the working directory", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValueOnce(answered("pkg/\n"));
    mockSpawnSync.mockReturnValueOnce(answered("pkg/package.json\0pkg/CHANGELOG.md\0src/mod.ts\0"));

    expect(git.committedPaths("/cwd/pkg", mockSpawnSync)).toEqual(["package.json", "CHANGELOG.md", "../src/mod.ts"]);
    expect(mockSpawnSync.mock.calls[1]![1]).toEqual(["diff", "--name-only", "--no-renames", "-z", "HEAD^", "HEAD"]);
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("answers no path for a commit whose tree matches its parent's", () => {
    mockSpawnSync.mockClear();
    mockSpawnSync.mockReturnValueOnce(answered("\n"));
    mockSpawnSync.mockReturnValueOnce(answered(""));

    expect(git.committedPaths("/cwd", mockSpawnSync)).toEqual([]);
    mockSpawnSync.mockReturnValue(answered(""));
  });
});

describe("tagExists()", () => {
  it("returns true when git tag --list returns a non-empty string", () => {
    mockSpawnSync.mockReturnValue(answered("v1.2.3"));
    expect(tagExists("/cwd", "v1.2.3")).toBe(true);
    mockSpawnSync.mockReturnValue(answered(""));
  });

  it("returns false when git tag --list returns an empty string", () => {
    mockSpawnSync.mockReturnValue(answered(""));
    expect(tagExists("/cwd", "v1.2.3")).toBe(false);
  });
});

describe("currentBranch()", () => {
  it("names the branch HEAD is on", () => {
    mockSpawnSync.mockReturnValue(answered("main\n"));
    expect(currentBranch("/cwd")).toBe("main");
  });

  it("answers null in a detached HEAD, which git names HEAD", () => {
    mockSpawnSync.mockReturnValue(answered("HEAD\n"));
    expect(currentBranch("/cwd")).toBe(null);
  });
});

describe("defaultBranch()", () => {
  it("strips the remote from the ref the remote publishes from", () => {
    mockSpawnSync.mockReturnValue(answered("origin/trunk\n"));
    expect(defaultBranch("/cwd")).toBe("trunk");
  });

  it("answers null when the remote names no publishing branch", () => {
    mockSpawnSync.mockReturnValue(failed(128, "fatal: ref refs/remotes/origin/HEAD is not a symbolic ref"));
    expect(defaultBranch("/cwd")).toBe(null);

    mockSpawnSync.mockReturnValue(answered(""));
    expect(defaultBranch("/cwd")).toBe(null);
  });
});
