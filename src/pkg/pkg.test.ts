import { describe, expect, it, mock } from "bun:test";
import { ReleaseError } from "./types";

const mockExecSync = mock((_cmd: string, _opts?: unknown): string | Buffer => "");
const mockReadFileSync = mock((_path: string, _enc: string): string => "");

mock.module("node:child_process", () => ({ execSync: mockExecSync }));
mock.module("node:fs", () => ({ readFileSync: mockReadFileSync, existsSync: () => true }));

const { readPackageVersion, updatePackageVersion } = await import("./pkg");

describe("readPackageVersion()", () => {
  it("returns the version field from package.json", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "pkg", version: "1.2.3" }));
    expect(readPackageVersion("/cwd")).toBe("1.2.3");
  });

  it("throws invalid-version when no version field is present", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "pkg" }));
    let thrown: ReleaseError | null = null;
    try {
      readPackageVersion("/cwd");
    } catch (e) {
      thrown = e as ReleaseError;
    }
    expect(thrown).toBeInstanceOf(ReleaseError);
    expect(thrown?.kind).toBe("invalid-version");
  });

  it("throws invalid-version when readFileSync throws", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    let thrown: ReleaseError | null = null;
    try {
      readPackageVersion("/cwd");
    } catch (e) {
      thrown = e as ReleaseError;
    }
    expect(thrown).toBeInstanceOf(ReleaseError);
    expect(thrown?.kind).toBe("invalid-version");
    mockReadFileSync.mockReturnValue("");
  });
});

describe("updatePackageVersion()", () => {
  it("calls npm version with the correct arguments", () => {
    mockExecSync.mockReturnValue("");
    mockExecSync.mockClear();
    updatePackageVersion("1.3.0", "/cwd");
    expect(mockExecSync.mock.calls).toHaveLength(1);
    expect(mockExecSync.mock.calls[0][0]).toBe("npm version 1.3.0 --no-git-tag-version");
    expect((mockExecSync.mock.calls[0][1] as { cwd: string }).cwd).toBe("/cwd");
  });

  it("throws a ReleaseError when npm version fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("npm error");
    });
    let thrown: ReleaseError | null = null;
    try {
      updatePackageVersion("1.3.0", "/cwd");
    } catch (e) {
      thrown = e as ReleaseError;
    }
    expect(thrown).toBeInstanceOf(ReleaseError);
    expect(thrown?.kind).toBe("git-error");
    mockExecSync.mockReturnValue("");
  });
});
