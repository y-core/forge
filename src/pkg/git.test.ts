import { describe, expect, it, mock } from "bun:test";

// Install mock before ./git is loaded so its top-level import gets the stub.
const mockExecSync = mock((_cmd: string, _opts?: unknown): string | Buffer => "");
mock.module("node:child_process", () => ({ execSync: mockExecSync }));

const {
  gitExec,
  isWorkingTreeClean,
  getLatestTag,
  getCommitsSinceTag,
  getLastCommitMessage,
  createTag,
} = await import("./git");

describe("gitExec()", () => {
  it("returns trimmed stdout", () => {
    mockExecSync.mockReturnValue("  hello world  ");
    expect(gitExec(["status"], "/cwd")).toBe("hello world");
  });

  it("throws ReleaseError when execSync throws", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("exit code 128");
    });
    expect(() => gitExec(["status"], "/cwd")).toThrow("git status failed:");
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
    expect(getCommitsSinceTag("/cwd", "v0.1.0")).toEqual([
      "abc1234 feat: add thing",
      "def5678 fix: bug",
    ]);
  });
});

describe("getLastCommitMessage()", () => {
  it("returns the trimmed subject of the last commit", () => {
    mockExecSync.mockReturnValue("minor: add new feature");
    expect(getLastCommitMessage("/cwd")).toBe("minor: add new feature");
  });
});

describe("createTag()", () => {
  it("calls execSync with the correct tag argument", () => {
    mockExecSync.mockReturnValue("");
    mockExecSync.mockClear();
    createTag("/cwd", "v1.2.3");
    expect(mockExecSync.mock.calls).toHaveLength(1);
    expect(mockExecSync.mock.calls[0][0]).toBe("git tag v1.2.3");
  });
});
