import { describe, expect, it, type Mock, mock } from "bun:test";
import { createReleaseCommand } from "./release";
import type { VersionResult } from "./types";

interface MockDeps {
  isWorkingTreeClean: Mock<(cwd: string) => boolean>;
  resolveVersion: Mock<(opts: { explicit?: string; cwd: string; tagPrefix: string }) => VersionResult>;
  updatePackageVersion: Mock<(version: string, cwd: string) => void>;
  createTag: Mock<(cwd: string, tag: string) => void>;
}

function makeDeps(overrides: Partial<MockDeps> = {}): MockDeps {
  return {
    isWorkingTreeClean: mock((_cwd: string) => true),
    resolveVersion: mock((_opts: unknown): VersionResult => ({ version: "1.1.0", reason: "auto-patch", previous: "v1.0.0" })),
    updatePackageVersion: mock((_version: string, _cwd: string): void => {}),
    createTag: mock((_cwd: string, _tag: string): void => {}),
    ...overrides,
  };
}

describe("createReleaseCommand()", () => {
  it("returns a Command with name 'release'", () => {
    const cmd = createReleaseCommand({ cwd: "/project" }, makeDeps());
    expect(cmd.name).toBe("release");
    expect(cmd.flags).toHaveProperty("dry");
    expect(cmd.flags).toHaveProperty("allow-dirty");
  });

  it("respects tagPrefix config", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project", tagPrefix: "pkg-v" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true });
    expect(deps.resolveVersion.mock.calls[0]![0]).toMatchObject({ tagPrefix: "pkg-v" });
  });

  it("passes cwd to resolveVersion", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/my/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true });
    expect(deps.resolveVersion.mock.calls[0]![0]).toMatchObject({ cwd: "/my/project" });
  });

  it("dry-run mode does not call updatePackageVersion or createTag", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: true, "allow-dirty": true });
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("non-dry-run calls updatePackageVersion and createTag", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true });
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(1);
    expect(deps.createTag.mock.calls).toHaveLength(1);
  });

  it("in-sync returns early without tagging", () => {
    const deps = makeDeps({ resolveVersion: mock(() => ({ version: "1.0.0", reason: "in-sync" as const, previous: "v1.0.0" })) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true });
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("post-release message reflects default stageFiles", () => {
    const deps = makeDeps();
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const cmd = createReleaseCommand({ cwd: "/project" }, deps);
      cmd.run?.([], { dry: false, "allow-dirty": true });
    } finally {
      console.log = origLog;
    }
    expect(logs.some((l) => l.includes("git add package.json"))).toBe(true);
  });

  it("post-release message reflects custom stageFiles", () => {
    const deps = makeDeps();
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const cmd = createReleaseCommand({ cwd: "/project", stageFiles: ["package.json"] }, deps);
      cmd.run?.([], { dry: false, "allow-dirty": true });
    } finally {
      console.log = origLog;
    }
    expect(logs.some((l) => l.includes("git add package.json"))).toBe(true);
  });

  it("checks dirty tree when allow-dirty is false", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": false });
    expect(deps.isWorkingTreeClean.mock.calls).toHaveLength(1);
  });

  it("skips dirty tree check when allow-dirty is true", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true });
    expect(deps.isWorkingTreeClean.mock.calls).toHaveLength(0);
  });

  it("skips dirty tree check in dry-run mode", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: true, "allow-dirty": false });
    expect(deps.isWorkingTreeClean.mock.calls).toHaveLength(0);
  });
});
