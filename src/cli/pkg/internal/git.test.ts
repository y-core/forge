import { describe, expect, it, mock } from "bun:test";
import * as childProcess from "node:child_process";

// `mock.module` is process-global and must land before ./git loads, so the real module is spread to preserve exports a sibling test file mocks.
const mockExecSync = mock((_cmd: string, _args?: string[], _opts?: unknown): string | Buffer => "");
await mock.module("node:child_process", () => ({ ...childProcess, execFileSync: mockExecSync }));

const { gitExec, isWorkingTreeClean, getLatestTag, getCommitsSinceTag, getLastCommitMessage, createTag, commit, tagExists, readFileAtRef } =
  await import("./git");

describe("gitExec()", () => {
  it("returns trimmed stdout", () => {
    mockExecSync.mockReturnValue("  hello world  ");
    expect(gitExec(["status"], "/cwd")).toBe("hello world");
  });

  it("captures stderr rather than letting git print it to the terminal", () => {
    mockExecSync.mockReturnValue("");
    mockExecSync.mockClear();
    gitExec(["show", "v1.0.0:package.json"], "/cwd");
    expect(mockExecSync.mock.calls[0]![2]).toMatchObject({ stdio: ["ignore", "pipe", "pipe"] });
  });

  it("throws ReleaseError when execSync throws", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("exit code 128");
    });
    expect(() => gitExec(["status"], "/cwd")).toThrow("git status failed:");
    mockExecSync.mockReturnValue("");
  });

  it("uses stderr text when error has non-empty stderr", () => {
    mockExecSync.mockImplementation(() => {
      throw { stderr: "nothing to commit, working tree clean", stdout: "", message: "Command failed" };
    });
    expect(() => gitExec(["commit", "-m", "test"], "/cwd")).toThrow("git commit failed: nothing to commit, working tree clean");
    mockExecSync.mockReturnValue("");
  });

  it("falls back to stdout when stderr is empty", () => {
    mockExecSync.mockImplementation(() => {
      throw { stderr: "", stdout: "some stdout text", message: "Command failed" };
    });
    expect(() => gitExec(["commit", "-m", "test"], "/cwd")).toThrow("git commit failed: some stdout text");
    mockExecSync.mockReturnValue("");
  });

  it("falls back to message when both stderr and stdout are empty", () => {
    mockExecSync.mockImplementation(() => {
      throw { stderr: "", stdout: "", message: "Command failed: git commit" };
    });
    expect(() => gitExec(["commit", "-m", "test"], "/cwd")).toThrow("git commit failed: Command failed: git commit");
    mockExecSync.mockReturnValue("");
  });
});

describe("isWorkingTreeClean()", () => {
  it("returns true for empty porcelain output", () => {
    mockExecSync.mockReturnValue("");
    expect(isWorkingTreeClean("/cwd")).toBe(true);
  });

  it("returns false when there are uncommitted changes", () => {
    mockExecSync.mockReturnValue(" M src/file.ts\n");
    expect(isWorkingTreeClean("/cwd")).toBe(false);
  });
});

describe("getLatestTag()", () => {
  it("returns null when there are no tags", () => {
    mockExecSync.mockReturnValue("");
    expect(getLatestTag("/cwd", "v")).toBeNull();
  });

  it("returns the first (highest) tag from sorted output", () => {
    mockExecSync.mockReturnValue("v0.3.0\nv0.2.0\nv0.1.0");
    expect(getLatestTag("/cwd", "v")).toBe("v0.3.0");
  });
});

describe("getCommitsSinceTag()", () => {
  it("returns an empty array when there are no commits since the tag", () => {
    mockExecSync.mockReturnValue("");
    expect(getCommitsSinceTag("/cwd", "v0.1.0")).toEqual([]);
  });

  it("splits commit lines into an array", () => {
    mockExecSync.mockReturnValue("abc1234 feat: add thing\ndef5678 fix: bug");
    expect(getCommitsSinceTag("/cwd", "v0.1.0")).toEqual(["abc1234 feat: add thing", "def5678 fix: bug"]);
  });
});

describe("getLastCommitMessage()", () => {
  it("returns the trimmed subject of the last commit", () => {
    mockExecSync.mockReturnValue("minor: add new feature");
    expect(getLastCommitMessage("/cwd")).toBe("minor: add new feature");
  });
});

describe("readFileAtRef()", () => {
  it("returns the file contents at the ref", () => {
    mockExecSync.mockReturnValue("export { thing } from './thing';");
    expect(readFileAtRef("/cwd", "v1.0.0", "src/http/mod.ts")).toBe("export { thing } from './thing';");
  });

  it("asks git for `<ref>:<path>`", () => {
    mockExecSync.mockReturnValue("");
    mockExecSync.mockClear();
    readFileAtRef("/cwd", "v1.0.0", "src/http/mod.ts");
    expect(mockExecSync.mock.calls[0]![1]).toEqual(["show", "v1.0.0:src/http/mod.ts"]);
  });

  it("returns null when the path did not exist at a resolvable ref", () => {
    mockExecSync.mockImplementation((_cmd, args) => {
      if ((args as string[])[0] === "show") {
        throw { stderr: "fatal: path 'src/new/mod.ts' does not exist in 'v1.0.0'", stdout: "", message: "Command failed" };
      }
      return "0f1e2d3";
    });
    expect(readFileAtRef("/cwd", "v1.0.0", "src/new/mod.ts")).toBeNull();
    mockExecSync.mockReturnValue("");
  });

  it("verifies the ref itself before reading an absent path as data", () => {
    mockExecSync.mockImplementation((_cmd, args) => {
      if ((args as string[])[0] === "show") throw { stderr: "fatal: path does not exist", stdout: "", message: "Command failed" };
      return "0f1e2d3";
    });
    mockExecSync.mockClear();
    readFileAtRef("/cwd", "v1.0.0", "src/new/mod.ts");
    expect(mockExecSync.mock.calls[1]![1]).toEqual(["rev-parse", "--verify", "v1.0.0^{object}"]);
    mockExecSync.mockReturnValue("");
  });

  it("throws instead of returning null when git cannot resolve the ref", () => {
    mockExecSync.mockImplementation(() => {
      throw { stderr: "fatal: invalid object name 'v99.99.99'", stdout: "", message: "Command failed" };
    });
    expect(() => readFileAtRef("/cwd", "v99.99.99", "package.json")).toThrow(
      "git could not resolve v99.99.99: git show failed: fatal: invalid object name 'v99.99.99'",
    );
    mockExecSync.mockReturnValue("");
  });
});

describe("createTag()", () => {
  it("calls execFileSync with git and the correct arg array", () => {
    mockExecSync.mockReturnValue("");
    mockExecSync.mockClear();
    createTag("/cwd", "v1.2.3");
    expect(mockExecSync.mock.calls).toHaveLength(1);
    expect(mockExecSync.mock.calls[0]![0]).toBe("git");
    expect(mockExecSync.mock.calls[0]![1]).toEqual(["tag", "v1.2.3"]);
  });

  it("passes shell metacharacters in tag names as-is without interpretation", () => {
    mockExecSync.mockReturnValue("");
    mockExecSync.mockClear();
    createTag("/cwd", "v1.0.0; rm -rf /");
    expect(mockExecSync.mock.calls[0]![1]).toEqual(["tag", "v1.0.0; rm -rf /"]);
  });
});

describe("commit()", () => {
  it("returns false and does not call git commit when nothing is staged", () => {
    mockExecSync.mockClear();
    mockExecSync.mockReturnValueOnce("");
    mockExecSync.mockReturnValueOnce("");

    const result = commit("/cwd", "chore: release 1.0.0", ["package.json"]);

    expect(result).toBe(false);
    expect(mockExecSync.mock.calls).toHaveLength(2);
    expect(mockExecSync.mock.calls[0]![1]).toEqual(["add", "package.json"]);
    expect(mockExecSync.mock.calls[1]![1]).toEqual(["diff", "--cached", "--name-only"]);
    const commitCall = mockExecSync.mock.calls.find((c) => Array.isArray(c[1]) && (c[1] as string[]).includes("commit"));
    expect(commitCall).toBeUndefined();

    mockExecSync.mockReturnValue("");
  });

  it("returns true and calls git commit when files are staged", () => {
    mockExecSync.mockClear();
    mockExecSync.mockReturnValueOnce("");
    mockExecSync.mockReturnValueOnce("package.json");
    mockExecSync.mockReturnValueOnce("");

    const result = commit("/cwd", "chore: release 1.0.0", ["package.json"]);

    expect(result).toBe(true);
    expect(mockExecSync.mock.calls).toHaveLength(3);
    expect(mockExecSync.mock.calls[0]![1]).toEqual(["add", "package.json"]);
    expect(mockExecSync.mock.calls[1]![1]).toEqual(["diff", "--cached", "--name-only"]);
    expect(mockExecSync.mock.calls[2]![1]).toEqual(["commit", "-m", "chore: release 1.0.0"]);

    mockExecSync.mockReturnValue("");
  });
});

describe("tagExists()", () => {
  it("returns true when git tag --list returns a non-empty string", () => {
    mockExecSync.mockReturnValue("v1.2.3");
    expect(tagExists("/cwd", "v1.2.3")).toBe(true);
    mockExecSync.mockReturnValue("");
  });

  it("returns false when git tag --list returns an empty string", () => {
    mockExecSync.mockReturnValue("");
    expect(tagExists("/cwd", "v1.2.3")).toBe(false);
  });
});
