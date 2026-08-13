import { describe, expect, it, type Mock, mock } from "bun:test";
import { ReleaseError, type VersionResult } from "../types";
import { createReleaseCommand } from "./release";

/** A written `[Unreleased]` — the ordinary case, where release has an entry to promote. */
const WRITTEN = ["# Changelog", "", "## [Unreleased]", "", "- a thing", "", "---", "", "## [1.0.0] — 2026-01-01", "", "body"].join("\n");

/** The same document with nothing written under `[Unreleased]`. */
const EMPTY = ["# Changelog", "", "## [Unreleased]", "", "_Nothing yet._", "", "---", "", "## [1.0.0] — 2026-01-01", "", "body"].join("\n");

/** A hyphen where the grammar requires an em dash. */
const MALFORMED = ["# Changelog", "", "## [Unreleased]", "", "- a thing", "", "## [1.0.0] - 2026-01-01", "", "body"].join("\n");

interface MockDeps {
  isWorkingTreeClean: Mock<(cwd: string) => boolean>;
  resolveVersion: Mock<(opts: { explicit?: string; cwd: string; tagPrefix: string }) => VersionResult>;
  updatePackageVersion: Mock<(version: string, cwd: string) => void>;
  commit: Mock<(cwd: string, message: string, files: string[]) => boolean>;
  tagExists: Mock<(cwd: string, tag: string) => boolean>;
  createTag: Mock<(cwd: string, tag: string) => void>;
  readChangelog: Mock<(cwd: string, file: string) => string | null>;
  writeChangelog: Mock<(cwd: string, file: string, source: string) => void>;
  readRepositoryUrl: Mock<(cwd: string) => string | null>;
  now: Mock<() => Date>;
}

function makeDeps(overrides: Partial<MockDeps> = {}): MockDeps {
  return {
    isWorkingTreeClean: mock((_cwd: string) => true),
    resolveVersion: mock((_opts: unknown): VersionResult => ({ version: "1.1.0", reason: "auto-patch", previous: "v1.0.0" })),
    updatePackageVersion: mock((_version: string, _cwd: string): void => {}),
    commit: mock((_cwd: string, _message: string, _files: string[]): boolean => true),
    tagExists: mock((_cwd: string, _tag: string): boolean => false),
    createTag: mock((_cwd: string, _tag: string): void => {}),
    readChangelog: mock((_cwd: string, _file: string): string | null => WRITTEN),
    writeChangelog: mock((_cwd: string, _file: string, _source: string): void => {}),
    readRepositoryUrl: mock((_cwd: string): string | null => "https://x/repo"),
    now: mock((): Date => new Date(2026, 1, 3)),
    ...overrides,
  };
}

/** Runs `cmd.run` with `console.log` captured, so an assertion can read what was printed without
 *  the output landing in the test report. */
function runCapturingLogs(run: () => void): string[] {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: string) => logs.push(msg);
  try {
    run();
  } finally {
    console.log = origLog;
  }
  return logs;
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
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    expect(deps.resolveVersion.mock.calls[0]![0]).toMatchObject({ tagPrefix: "pkg-v" });
  });

  it("passes cwd to resolveVersion", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/my/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    expect(deps.resolveVersion.mock.calls[0]![0]).toMatchObject({ cwd: "/my/project" });
  });

  it("dry-run mode does not call updatePackageVersion, commit, or createTag", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: true, "allow-dirty": true, "allow-empty-changelog": false });
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(0);
    expect(deps.commit.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("non-dry-run calls updatePackageVersion, commit, and createTag", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(1);
    expect(deps.commit.mock.calls).toHaveLength(1);
    expect(deps.createTag.mock.calls).toHaveLength(1);
  });

  it("commits staged files before creating the tag", () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      commit: mock((_cwd, _msg, _files): boolean => {
        callOrder.push("commit");
        return true;
      }),
      createTag: mock((_cwd, _tag): void => {
        callOrder.push("createTag");
      }),
    });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    expect(callOrder).toEqual(["commit", "createTag"]);
  });

  it("writes the changelog before committing, so both land in one commit", () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      updatePackageVersion: mock((_version, _cwd): void => {
        callOrder.push("updatePackageVersion");
      }),
      writeChangelog: mock((_cwd, _file, _source): void => {
        callOrder.push("writeChangelog");
      }),
      commit: mock((_cwd, _msg, _files): boolean => {
        callOrder.push("commit");
        return true;
      }),
      createTag: mock((_cwd, _tag): void => {
        callOrder.push("createTag");
      }),
    });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    expect(callOrder).toEqual(["updatePackageVersion", "writeChangelog", "commit", "createTag"]);
  });

  it("commit receives the correct message and stageFiles", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project", stageFiles: ["package.json", "bun.lock"] }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    const [cwd, message, files] = deps.commit.mock.calls[0]!;
    expect(cwd).toBe("/project");
    expect(message).toBe("chore: release 1.1.0");
    expect(files).toEqual(["package.json", "bun.lock"]);
  });

  it("in-sync returns early without tagging", () => {
    const deps = makeDeps({ resolveVersion: mock(() => ({ version: "1.0.0", reason: "in-sync" as const, previous: "v1.0.0" })) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("post-release message includes push instructions", () => {
    const deps = makeDeps();
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const cmd = createReleaseCommand({ cwd: "/project" }, deps);
      cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    } finally {
      console.log = origLog;
    }
    expect(logs.some((l) => l.includes("git push && git push --tags"))).toBe(true);
    expect(logs.some((l) => l.includes("git add"))).toBe(false);
  });

  it("checks dirty tree when allow-dirty is false", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": false, "allow-empty-changelog": false });
    expect(deps.isWorkingTreeClean.mock.calls).toHaveLength(1);
  });

  it("skips dirty tree check when allow-dirty is true", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    expect(deps.isWorkingTreeClean.mock.calls).toHaveLength(0);
  });

  it("skips dirty tree check in dry-run mode", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: true, "allow-dirty": false, "allow-empty-changelog": false });
    expect(deps.isWorkingTreeClean.mock.calls).toHaveLength(0);
  });

  it("tag already exists — skips all mutations", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    const deps = makeDeps({ tagExists: mock((_cwd: string, _tag: string): boolean => true) });
    try {
      const cmd = createReleaseCommand({ cwd: "/project" }, deps);
      cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    } finally {
      console.log = origLog;
    }
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(0);
    expect(deps.commit.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(0);
    expect(logs.some((l) => l.includes("Tag v1.1.0 already exists — nothing to release."))).toBe(true);
  });

  it("idempotent recovery — commit skipped but tag still created", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    const deps = makeDeps({ commit: mock((_cwd: string, _message: string, _files: string[]): boolean => false) });
    try {
      const cmd = createReleaseCommand({ cwd: "/project" }, deps);
      cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    } finally {
      console.log = origLog;
    }
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(1);
    expect(deps.commit.mock.calls).toHaveLength(1);
    expect(deps.createTag.mock.calls).toHaveLength(1);
    expect(logs.some((l) => l.includes("package.json already at 1.1.0 — skipping commit."))).toBe(true);
  });

  it("normal path — commit returns true, no skip message logged", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    const deps = makeDeps({ commit: mock((_cwd: string, _message: string, _files: string[]): boolean => true) });
    try {
      const cmd = createReleaseCommand({ cwd: "/project" }, deps);
      cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    } finally {
      console.log = origLog;
    }
    expect(deps.createTag.mock.calls).toHaveLength(1);
    expect(logs.some((l) => l.includes("skipping commit"))).toBe(false);
  });
});

describe("createReleaseCommand() — changelog promotion", () => {
  it("registers the --allow-empty-changelog flag", () => {
    const cmd = createReleaseCommand({ cwd: "/project" }, makeDeps());
    expect(cmd.flags).toHaveProperty("allow-empty-changelog");
  });

  it("promotes [Unreleased] into a dated section using the injected clock", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    const [cwd, file, source] = deps.writeChangelog.mock.calls[0] as [string, string, string];
    expect(cwd).toBe("/project");
    expect(file).toBe("CHANGELOG.md");
    expect(source).toBe(
      [
        "# Changelog",
        "",
        "## [Unreleased]",
        "",
        "_Nothing yet._",
        "",
        "---",
        "",
        "## [1.1.0] — 2026-02-03",
        "",
        "- a thing",
        "",
        "---",
        "",
        "## [1.0.0] — 2026-01-01",
        "",
        "body",
        "",
        "[1.1.0]: https://x/repo/compare/v1.0.0...v1.1.0",
      ].join("\n"),
    );
  });

  it("reads the clock exactly once", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    expect(deps.now.mock.calls).toHaveLength(1);
  });

  it("omits the link definition when the repository URL is unknown", () => {
    const deps = makeDeps({ readRepositoryUrl: mock((_cwd: string): string | null => null) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    const [, , source] = deps.writeChangelog.mock.calls[0] as [string, string, string];
    expect(source.includes("[1.1.0]: ")).toBe(false);
  });

  it("honours a configured changelogFile", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project", changelogFile: "docs/CHANGES.md" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    expect(deps.readChangelog.mock.calls[0]?.[1]).toBe("docs/CHANGES.md");
    expect(deps.writeChangelog.mock.calls[0]?.[1]).toBe("docs/CHANGES.md");
  });

  it("refuses an empty [Unreleased] and names the escape hatch", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => EMPTY) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false })).toThrow(
      "CHANGELOG.md has an empty [Unreleased] section, but commits exist since v1.0.0. " +
        "Write the entry, or use --allow-empty-changelog for a genuinely entry-free release.",
    );
  });

  it("the empty refusal precedes every mutation", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => EMPTY) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false })).toThrow(ReleaseError);
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(0);
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
    expect(deps.commit.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("refuses an empty [Unreleased] under --dry too, before reporting anything", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => EMPTY) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { dry: true, "allow-dirty": true, "allow-empty-changelog": false })).toThrow(ReleaseError);
  });

  it("--allow-empty-changelog proceeds and still promotes, carrying the placeholder through", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => EMPTY) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": true });
    expect(deps.writeChangelog.mock.calls).toHaveLength(1);
    const [, , source] = deps.writeChangelog.mock.calls[0] as [string, string, string];
    expect(source.split("\n")[8]).toBe("## [1.1.0] — 2026-02-03");
    expect(source.split("\n")[10]).toBe("_Nothing yet._");
  });

  it("refuses a malformed changelog", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => MALFORMED) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false })).toThrow(ReleaseError);
  });

  it("--allow-empty-changelog does not license a malformed changelog", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => MALFORMED) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": true })).toThrow(ReleaseError);
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
  });

  it("a repository with no changelog releases unchanged", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => null) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    const logs = runCapturingLogs(() => cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false }));
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(1);
    expect(logs.some((l) => l === "  changelog: (no CHANGELOG.md — skipped)")).toBe(true);
  });

  it("--dry reports the promotion and writes nothing", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    const logs = runCapturingLogs(() => cmd.run?.([], { dry: true, "allow-dirty": true, "allow-empty-changelog": false }));
    expect(deps.readChangelog.mock.calls).toHaveLength(1);
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
    expect(logs.some((l) => l === "  changelog: [Unreleased] → [1.1.0] — 2026-02-03")).toBe(true);
  });

  it("in-sync returns before the changelog is read", () => {
    const deps = makeDeps({ resolveVersion: mock(() => ({ version: "1.0.0", reason: "in-sync" as const, previous: "v1.0.0" })) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false });
    expect(deps.readChangelog.mock.calls).toHaveLength(0);
  });

  it("a dirty working tree refuses before the changelog is read", () => {
    const deps = makeDeps({ isWorkingTreeClean: mock((_cwd: string): boolean => false) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { dry: false, "allow-dirty": false, "allow-empty-changelog": false })).toThrow(
      "Working tree is not clean. Commit or stash changes first, or use --allow-dirty.",
    );
    expect(deps.readChangelog.mock.calls).toHaveLength(0);
  });
});
