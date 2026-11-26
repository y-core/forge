import { describe, expect, it, mock } from "bun:test";
import type { Mock } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { worktreeGitEnv } from "../cli/worktree";
import { worktreeFixture } from "../cli/worktree.fixture";
import { changelogSectionsSource, packageWithVersion } from "./pkg-json";
import { createReleaseBinCommand, createReleaseCommand, defineReleaseConfig } from "./release";
import { ReleaseError } from "./types";
import type { CommitSummary, GateOutcome, GateRecord } from "./types";
import type { VersionResult } from "./types";

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
  committedPaths: Mock<(cwd: string) => string[]>;
  tagExists: Mock<(cwd: string, tag: string) => boolean>;
  createTag: Mock<(cwd: string, tag: string, commit?: string) => void>;
  fetchRemote: Mock<(cwd: string) => void>;
  commitSummary: Mock<(cwd: string, ref: string) => CommitSummary | null>;
  commitWithSubject: Mock<(cwd: string, ref: string, subject: string, since: string | null) => string | null>;
  pushTag: Mock<(cwd: string, tag: string) => void>;
  deleteTag: Mock<(cwd: string, tag: string) => void>;
  readChangelog: Mock<(cwd: string, file: string) => string | null>;
  writeChangelog: Mock<(cwd: string, file: string, source: string) => void>;
  writeChangelogSections: Mock<(cwd: string, file: string, source: string) => void>;
  readRepositoryUrl: Mock<(cwd: string) => string | null>;
  removedSurfaceSince: Mock<(cwd: string, ref: string) => string[]>;
  tagIsAncestorOfHead: Mock<(cwd: string, tag: string) => boolean>;
  remoteTags: Mock<(cwd: string) => string[] | null>;
  currentBranch: Mock<(cwd: string) => string | null>;
  defaultBranch: Mock<(cwd: string) => string | null>;
  runGate: Mock<(cwd: string, command: readonly string[]) => GateOutcome>;
  now: Mock<() => Date>;
  gitWritable: Mock<(cwd: string) => boolean>;
  readFileAtRef: Mock<(cwd: string, ref: string, path: string) => string | null>;
  lastCommitSubject: Mock<(cwd: string) => string>;
  resolveCommit: Mock<(cwd: string, ref: string) => string>;
  resolveTree: Mock<(cwd: string, ref: string) => string>;
  worktreeChanges: Mock<(cwd: string) => readonly string[] | undefined>;
  readWorkingFile: Mock<(cwd: string, path: string) => string | null>;
  readGateRecord: Mock<(cwd: string, tag: string) => GateRecord | null>;
  writeGateRecord: Mock<(cwd: string, tag: string, record: GateRecord) => void>;
}

function makeDeps(overrides: Partial<MockDeps> = {}): MockDeps {
  return {
    isWorkingTreeClean: mock((_cwd: string) => true),
    resolveVersion: mock((_opts: unknown): VersionResult => ({ version: "1.1.0", reason: "auto-patch", previous: "v1.0.0" })),
    updatePackageVersion: mock((_version: string, _cwd: string): void => {}),
    commit: mock((_cwd: string, _message: string, _files: string[]): boolean => true),
    committedPaths: mock((_cwd: string): string[] => ["package.json"]),
    tagExists: mock((_cwd: string, _tag: string): boolean => false),
    createTag: mock((_cwd: string, _tag: string, _commit?: string): void => {}),
    fetchRemote: mock((_cwd: string): void => {}),
    commitSummary: mock((_cwd: string, _ref: string): CommitSummary | null => null),
    commitWithSubject: mock((_cwd: string, _ref: string, _subject: string, _since: string | null): string | null => null),
    pushTag: mock((_cwd: string, _tag: string): void => {}),
    deleteTag: mock((_cwd: string, _tag: string): void => {}),
    readChangelog: mock((_cwd: string, _file: string): string | null => WRITTEN),
    writeChangelog: mock((_cwd: string, _file: string, _source: string): void => {}),
    writeChangelogSections: mock((_cwd: string, _file: string, _source: string): void => {}),
    readRepositoryUrl: mock((_cwd: string): string | null => "https://x/repo"),
    removedSurfaceSince: mock((_cwd: string, _ref: string): string[] => []),
    tagIsAncestorOfHead: mock((_cwd: string, _tag: string): boolean => true),
    remoteTags: mock((_cwd: string): string[] | null => ["v1.0.0"]),
    currentBranch: mock((_cwd: string): string | null => "main"),
    defaultBranch: mock((_cwd: string): string | null => "main"),
    runGate: mock((_cwd: string, _command: readonly string[]): GateOutcome => "passed"),
    now: mock((): Date => new Date(2026, 1, 3)),
    gitWritable: mock((_cwd: string): boolean => true),
    readFileAtRef: mock((_cwd: string, _ref: string, path: string): string | null =>
      path === "package.json" ? '{ "version": "1.0.0" }\n' : WRITTEN,
    ),
    lastCommitSubject: mock((_cwd: string): string => "feat: a thing"),
    resolveCommit: mock((_cwd: string, ref: string): string => (ref === "HEAD" ? "a".repeat(40) : "b".repeat(40))),
    resolveTree: mock((_cwd: string, ref: string): string => (ref === "HEAD" ? "c".repeat(40) : "d".repeat(40))),
    worktreeChanges: mock((_cwd: string): readonly string[] | undefined => []),
    readWorkingFile: mock((_cwd: string, path: string): string | null => (path === "package.json" ? '{ "version": "1.0.0" }\n' : null)),
    readGateRecord: mock((_cwd: string, _tag: string): GateRecord | null => null),
    writeGateRecord: mock((_cwd: string, _tag: string, _record: GateRecord): void => {}),
    ...overrides,
  };
}

/** Runs `cmd.run` with `console.log` captured so an assertion can read what was printed. */
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
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    expect(deps.resolveVersion.mock.calls[0]![0]).toMatchObject({ tagPrefix: "pkg-v" });
  });

  it("passes cwd to resolveVersion", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/my/project" }, deps);
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    expect(deps.resolveVersion.mock.calls[0]![0]).toMatchObject({ cwd: "/my/project" });
  });

  it("dry-run mode does not call updatePackageVersion, commit, or createTag", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], {
      dry: true,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(0);
    expect(deps.commit.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("non-dry-run calls updatePackageVersion, commit, and createTag", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
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
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
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
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    expect(callOrder).toEqual(["updatePackageVersion", "writeChangelog", "commit", "createTag"]);
  });

  it("commit receives the correct message and stageFiles", () => {
    const deps = makeDeps({ worktreeChanges: mock((_cwd: string): readonly string[] | undefined => ["bun.lock"]) });
    const cmd = createReleaseCommand({ cwd: "/project", stageFiles: ["package.json", "bun.lock"] }, deps);
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    const [cwd, message, files] = deps.commit.mock.calls[0]!;
    expect(cwd).toBe("/project");
    expect(message).toBe("chore: release 1.1.0");
    expect(files).toEqual(["package.json", "bun.lock", "config/changelog-sections.json"]);
  });

  it("in-sync returns early without tagging", () => {
    const deps = makeDeps({ resolveVersion: mock(() => ({ version: "1.0.0", reason: "in-sync" as const, previous: "v1.0.0" })) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
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
      void cmd.run?.([], {
        dry: false,
        "allow-dirty": true,
        "allow-empty-changelog": false,
        "allow-semver": false,
        "allow-branch": false,
        "allow-unverified": true,
      });
    } finally {
      console.log = origLog;
    }
    expect(logs.some((l) => l.includes("git push && git push --tags"))).toBe(true);
    expect(logs.some((l) => l.includes("git add"))).toBe(false);
  });

  it("checks dirty tree when allow-dirty is false", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": false,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    expect(deps.isWorkingTreeClean.mock.calls).toHaveLength(1);
  });

  it("skips dirty tree check when allow-dirty is true", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    expect(deps.isWorkingTreeClean.mock.calls).toHaveLength(0);
  });

  it("skips dirty tree check in dry-run mode", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], {
      dry: true,
      "allow-dirty": false,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    expect(deps.isWorkingTreeClean.mock.calls).toHaveLength(0);
  });

  it("tag already exists — skips all mutations", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    const deps = makeDeps({ tagExists: mock((_cwd: string, _tag: string): boolean => true) });
    try {
      const cmd = createReleaseCommand({ cwd: "/project" }, deps);
      void cmd.run?.([], {
        dry: false,
        "allow-dirty": true,
        "allow-empty-changelog": false,
        "allow-semver": false,
        "allow-branch": false,
        "allow-unverified": true,
      });
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
      void cmd.run?.([], {
        dry: false,
        "allow-dirty": true,
        "allow-empty-changelog": false,
        "allow-semver": false,
        "allow-branch": false,
        "allow-unverified": true,
      });
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
      void cmd.run?.([], {
        dry: false,
        "allow-dirty": true,
        "allow-empty-changelog": false,
        "allow-semver": false,
        "allow-branch": false,
        "allow-unverified": true,
      });
    } finally {
      console.log = origLog;
    }
    expect(deps.createTag.mock.calls).toHaveLength(1);
    expect(logs.some((l) => l.includes("skipping commit"))).toBe(false);
  });
});

describe("createReleaseCommand() — the bump's evidence", () => {
  const FLAGS = {
    dry: true,
    "allow-dirty": true,
    "allow-empty-changelog": false,
    "allow-semver": false,
    "allow-branch": false,
    "allow-unverified": true,
  };

  it("names the commit that won the bump", () => {
    const deps = makeDeps({
      resolveVersion: mock((): VersionResult => ({
        version: "1.1.0",
        reason: "auto-minor",
        previous: "v1.0.0",
        evidence: { commit: { sha: "a1b2c3d", subject: "minor: add the origin-guard tier" }, commitCount: 4 },
      })),
    });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    const logs = runCapturingLogs(() => void cmd.run?.([], FLAGS));
    expect(logs.some((l) => l === "  because:   a1b2c3d minor: add the origin-guard tier")).toBe(true);
  });

  it("says no commit asked for the bump when the range carries no prefix", () => {
    const deps = makeDeps({
      resolveVersion: mock((): VersionResult => ({ version: "1.0.1", reason: "auto-patch", previous: "v1.0.0", evidence: { commitCount: 7 } })),
    });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    const logs = runCapturingLogs(() => void cmd.run?.([], FLAGS));
    expect(logs.some((l) => l === "  because:   no major:/minor: subject in 7 commits since v1.0.0")).toBe(true);
  });

  it("prints no because: row when the version was not derived from commits", () => {
    const deps = makeDeps({ resolveVersion: mock((): VersionResult => ({ version: "2.0.0", reason: "explicit", previous: "v1.0.0" })) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    const logs = runCapturingLogs(() => void cmd.run?.([], FLAGS));
    expect(logs.some((l) => l.startsWith("  because:"))).toBe(false);
  });

  it("prints the row in a non-dry run too", () => {
    const deps = makeDeps({
      resolveVersion: mock((): VersionResult => ({
        version: "1.1.0",
        reason: "auto-minor",
        previous: "v1.0.0",
        evidence: { commit: { sha: "a1b2c3d", subject: "minor: add a thing" }, commitCount: 1 },
      })),
    });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    const logs = runCapturingLogs(() => void cmd.run?.([], { ...FLAGS, dry: false }));
    expect(logs.some((l) => l === "  because:   a1b2c3d minor: add a thing")).toBe(true);
  });
});

describe("createReleaseCommand() — a tag that fails after the commit", () => {
  const FLAGS = {
    dry: false,
    "allow-dirty": true,
    "allow-empty-changelog": false,
    "allow-semver": false,
    "allow-branch": false,
    "allow-unverified": true,
  };

  it("names the commit that landed", () => {
    const deps = makeDeps({
      createTag: mock((_cwd: string, _tag: string): void => {
        throw new ReleaseError("git-error", "git tag failed: fatal: tag exists");
      }),
    });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => runCapturingLogs(() => void cmd.run?.([], FLAGS))).toThrow(
      'Commit "chore: release 1.1.0" landed unpushed and untagged; creating tag v1.1.0 failed: git tag failed: fatal: tag exists',
    );
  });

  it("names no commit when nothing was staged", () => {
    const deps = makeDeps({
      commit: mock((_cwd: string, _message: string, _files: string[]): boolean => false),
      createTag: mock((_cwd: string, _tag: string): void => {
        throw new ReleaseError("git-error", "git tag failed: fatal: tag exists");
      }),
    });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => runCapturingLogs(() => void cmd.run?.([], FLAGS))).toThrow("creating tag v1.1.0 failed: git tag failed: fatal: tag exists");
  });
});

describe("createReleaseCommand() — the commit it is about to tag", () => {
  const FLAGS = {
    dry: false,
    "allow-dirty": true,
    "allow-empty-changelog": false,
    "allow-semver": false,
    "allow-branch": false,
    "allow-unverified": true,
  };

  it("tags a commit that changed only what it staged", () => {
    const deps = makeDeps({ committedPaths: mock((_cwd: string): string[] => ["CHANGELOG.md", "package.json"]) });
    runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS));
    expect(deps.createTag.mock.calls).toHaveLength(1);
  });

  it("refuses to tag a commit that changed paths it never staged, and names the undo", () => {
    const deps = makeDeps({ committedPaths: mock((_cwd: string): string[] => ["package.json", "src/mod.ts", "README.md"]) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => runCapturingLogs(() => void cmd.run?.([], FLAGS))).toThrow(
      'Commit "chore: release 1.1.0" changed src/mod.ts, README.md instead of only package.json, CHANGELOG.md, config/changelog-sections.json, so v1.1.0 was not cut.\n' +
        "Undo the commit, keeping the release files in the working tree:\n  git reset HEAD^",
    );
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("refuses to tag a commit that changed no path at all", () => {
    const deps = makeDeps({ committedPaths: mock((_cwd: string): string[] => []) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => runCapturingLogs(() => void cmd.run?.([], FLAGS))).toThrow('Commit "chore: release 1.1.0" changed no path instead of only');
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("does not inspect HEAD when nothing was committed", () => {
    const deps = makeDeps({ commit: mock((_cwd: string, _message: string, _files: string[]): boolean => false) });
    runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS));
    expect(deps.committedPaths.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(1);
  });

  it("reports an index left stale after the commit landed, and still tags it", () => {
    const deps = makeDeps({
      commit: mock((_cwd: string, _message: string, _files: string[]): boolean => {
        throw new ReleaseError("index-stale", "abc12345 landed, but the index still holds the old package.json");
      }),
    });
    const logs = runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS));
    expect(logs).toContain("  abc12345 landed, but the index still holds the old package.json");
    expect(deps.committedPaths.mock.calls).toHaveLength(1);
    expect(deps.createTag.mock.calls).toHaveLength(1);
  });
});

describe("createReleaseCommand() — the shrinking-surface guard", () => {
  const FLAGS = {
    dry: false,
    "allow-dirty": true,
    "allow-empty-changelog": false,
    "allow-semver": false,
    "allow-branch": false,
    "allow-unverified": true,
  };

  function shrinking(overrides: Partial<MockDeps> = {}): MockDeps {
    return makeDeps({
      removedSurfaceSince: mock((_cwd: string, _ref: string): string[] => ["./http#serveObject"]),
      resolveVersion: mock((): VersionResult => ({ version: "1.0.1", reason: "auto-patch", previous: "v1.0.0", evidence: { commitCount: 3 } })),
      ...overrides,
    });
  }

  it("registers the --allow-semver flag", () => {
    const cmd = createReleaseCommand({ cwd: "/project" }, makeDeps());
    expect(cmd.flags).toHaveProperty("allow-semver");
  });

  it("refuses an auto-patch whose surface shrank, naming the lost entries and the prefix that answers it", () => {
    const deps = shrinking({
      removedSurfaceSince: mock((_cwd: string, _ref: string): string[] => ["./http#serveObject", "./storage/r2#r2Client"]),
    });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], FLAGS)).toThrow(
      "Public export surface shrank since v1.0.0, but the resolved bump is auto-patch:\n" +
        "  ./http#serveObject\n" +
        "  ./storage/r2#r2Client\n" +
        "Give the commit that removed them a `minor:` subject prefix (`major:` from 1.0) — that prefix is the only signal a consumer pinning by tag gets.\n" +
        "--allow-semver overrides this deliberately, for a shrink where a patch bump is genuinely correct.",
    );
  });

  it("the refusal precedes every mutation", () => {
    const deps = shrinking();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], FLAGS)).toThrow(ReleaseError);
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(0);
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
    expect(deps.commit.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("refuses under --dry too, so the preview shows the refusal it would hit", () => {
    const deps = shrinking();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { ...FLAGS, dry: true })).toThrow(ReleaseError);
  });

  it("--allow-semver releases anyway", () => {
    const deps = shrinking();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], { ...FLAGS, "allow-semver": true });
    expect(deps.createTag.mock.calls).toHaveLength(1);
  });

  it("does not refuse an auto-minor, the bar this check holds to", () => {
    const deps = shrinking({
      resolveVersion: mock((): VersionResult => ({
        version: "1.1.0",
        reason: "auto-minor",
        previous: "v1.0.0",
        evidence: { commit: { sha: "a1b2c3d", subject: "minor: drop it" }, commitCount: 3 },
      })),
    });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], FLAGS);
    expect(deps.createTag.mock.calls).toHaveLength(1);
  });

  it("does not refuse an explicit version, which states the impact deliberately", () => {
    const deps = shrinking({ resolveVersion: mock((): VersionResult => ({ version: "2.0.0", reason: "explicit", previous: "v1.0.0" })) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.(["2.0.0"], FLAGS);
    expect(deps.createTag.mock.calls).toHaveLength(1);
  });

  it("does not read the surface at all when there is no previous tag", () => {
    const deps = shrinking({ resolveVersion: mock((): VersionResult => ({ version: "0.0.1", reason: "first-release", previous: null })) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], FLAGS);
    expect(deps.removedSurfaceSince.mock.calls).toHaveLength(0);
  });
});

describe("createReleaseCommand() — amend floor preflight", () => {
  const FLAGS = {
    dry: false,
    "allow-dirty": true,
    "allow-empty-changelog": false,
    "allow-semver": false,
    "allow-branch": false,
    "allow-unverified": true,
  };

  it("releases when the previous tag is an ancestor of HEAD and the remote carries it", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], FLAGS);
    expect(deps.tagIsAncestorOfHead.mock.calls[0]).toEqual(["/project", "v1.0.0"]);
    expect(deps.createTag.mock.calls).toHaveLength(1);
  });

  it("refuses when the previous tag is no longer an ancestor of HEAD, naming the tag and the recovery", () => {
    const deps = makeDeps({ tagIsAncestorOfHead: mock((_cwd: string, _tag: string): boolean => false) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], FLAGS)).toThrow(
      "v1.0.0 is no longer an ancestor of HEAD — published history was rewritten.\n" +
        "Consumers installed the tarball released at v1.0.0, so the tag no longer names what they hold, " +
        "and no version change signals it. Recover the rewritten commits with `git reflog` and rebuild HEAD on top of the tag.",
    );
  });

  it("the rewrite refusal precedes every mutation, and does not go on to ask the remote", () => {
    const deps = makeDeps({ tagIsAncestorOfHead: mock((_cwd: string, _tag: string): boolean => false) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], FLAGS)).toThrow(ReleaseError);
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(0);
    expect(deps.remoteTags.mock.calls).toHaveLength(0);
  });

  it("refuses when a reachable remote does not carry the previous tag, naming the push", () => {
    const deps = makeDeps({ remoteTags: mock((_cwd: string): string[] | null => ["v0.9.0"]) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], FLAGS)).toThrow(
      "v1.0.0 exists locally but not on the remote, so no consumer can fetch it.\n" + "Run `git push --tags` before cutting 1.1.0 on top of it.",
    );
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("reports an unreachable remote and releases anyway, since a local release has no route out", () => {
    const deps = makeDeps({ remoteTags: mock((_cwd: string): string[] | null => null) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    const logs = runCapturingLogs(() => void cmd.run?.([], FLAGS));
    expect(logs).toContain("  (remote unreachable — could not confirm v1.0.0 is pushed)");
    expect(deps.createTag.mock.calls).toHaveLength(1);
  });

  it("asks neither question on a first release, where there is no floor", () => {
    const deps = makeDeps({ resolveVersion: mock((): VersionResult => ({ version: "0.0.1", reason: "first-release", previous: null })) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], FLAGS);
    expect(deps.tagIsAncestorOfHead.mock.calls).toHaveLength(0);
    expect(deps.remoteTags.mock.calls).toHaveLength(0);
  });

  it("still checks the floor for an in-sync release, which cuts nothing but reports on a rewritten tag", () => {
    const deps = makeDeps({
      resolveVersion: mock((): VersionResult => ({ version: "1.0.0", reason: "in-sync", previous: "v1.0.0" })),
      tagIsAncestorOfHead: mock((_cwd: string, _tag: string): boolean => false),
    });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], FLAGS)).toThrow(ReleaseError);
  });

  it("checks the floor in a dry run too, so --dry shows the refusal it would hit", () => {
    const deps = makeDeps({ tagIsAncestorOfHead: mock((_cwd: string, _tag: string): boolean => false) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { ...FLAGS, dry: true })).toThrow(ReleaseError);
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
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
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
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    expect(deps.now.mock.calls).toHaveLength(1);
  });

  it("omits the link definition when the repository URL is unknown", () => {
    const deps = makeDeps({ readRepositoryUrl: mock((_cwd: string): string | null => null) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    const [, , source] = deps.writeChangelog.mock.calls[0] as [string, string, string];
    expect(source.includes("[1.1.0]: ")).toBe(false);
  });

  it("honours a configured changelogFile", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project", changelogFile: "docs/CHANGES.md" }, deps);
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    expect(deps.readChangelog.mock.calls[0]?.[1]).toBe("docs/CHANGES.md");
    expect(deps.writeChangelog.mock.calls[0]?.[1]).toBe("docs/CHANGES.md");
  });

  it("refuses an empty [Unreleased] and names the escape hatch", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => EMPTY) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() =>
      cmd.run?.([], {
        dry: false,
        "allow-dirty": true,
        "allow-empty-changelog": false,
        "allow-semver": false,
        "allow-branch": false,
        "allow-unverified": true,
      }),
    ).toThrow(
      "CHANGELOG.md has an empty [Unreleased] section, but commits exist since v1.0.0. " +
        "Write the entry, or use --allow-empty-changelog for a genuinely entry-free release.",
    );
  });

  it("the empty refusal precedes every mutation", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => EMPTY) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() =>
      cmd.run?.([], {
        dry: false,
        "allow-dirty": true,
        "allow-empty-changelog": false,
        "allow-semver": false,
        "allow-branch": false,
        "allow-unverified": true,
      }),
    ).toThrow(ReleaseError);
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(0);
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
    expect(deps.commit.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("refuses an empty [Unreleased] under --dry too, before reporting anything", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => EMPTY) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() =>
      cmd.run?.([], {
        dry: true,
        "allow-dirty": true,
        "allow-empty-changelog": false,
        "allow-semver": false,
        "allow-branch": false,
        "allow-unverified": true,
      }),
    ).toThrow(ReleaseError);
  });

  it("--allow-empty-changelog proceeds and still promotes, carrying the placeholder through", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => EMPTY) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": true,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    expect(deps.writeChangelog.mock.calls).toHaveLength(1);
    const [, , source] = deps.writeChangelog.mock.calls[0] as [string, string, string];
    expect(source.split("\n")[8]).toBe("## [1.1.0] — 2026-02-03");
    expect(source.split("\n")[10]).toBe("_Nothing yet._");
  });

  it("refuses a malformed changelog", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => MALFORMED) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() =>
      cmd.run?.([], {
        dry: false,
        "allow-dirty": true,
        "allow-empty-changelog": false,
        "allow-semver": false,
        "allow-branch": false,
        "allow-unverified": true,
      }),
    ).toThrow(ReleaseError);
  });

  it("--allow-empty-changelog does not license a malformed changelog", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => MALFORMED) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() =>
      cmd.run?.([], {
        dry: false,
        "allow-dirty": true,
        "allow-empty-changelog": true,
        "allow-semver": false,
        "allow-branch": false,
        "allow-unverified": true,
      }),
    ).toThrow(ReleaseError);
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
  });

  it("a repository with no changelog releases unchanged", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => null) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    const logs = runCapturingLogs(
      () =>
        void cmd.run?.([], {
          dry: false,
          "allow-dirty": true,
          "allow-empty-changelog": false,
          "allow-semver": false,
          "allow-branch": false,
          "allow-unverified": true,
        }),
    );
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(1);
    expect(logs.some((l) => l === "  changelog: (no CHANGELOG.md — skipped)")).toBe(true);
  });

  it("--dry reports the promotion and writes nothing", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    const logs = runCapturingLogs(
      () =>
        void cmd.run?.([], {
          dry: true,
          "allow-dirty": true,
          "allow-empty-changelog": false,
          "allow-semver": false,
          "allow-branch": false,
          "allow-unverified": true,
        }),
    );
    expect(deps.readChangelog.mock.calls).toHaveLength(1);
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
    expect(logs.some((l) => l === "  changelog: [Unreleased] → [1.1.0] — 2026-02-03")).toBe(true);
  });

  it("in-sync returns before the changelog is read", () => {
    const deps = makeDeps({ resolveVersion: mock(() => ({ version: "1.0.0", reason: "in-sync" as const, previous: "v1.0.0" })) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], {
      dry: false,
      "allow-dirty": true,
      "allow-empty-changelog": false,
      "allow-semver": false,
      "allow-branch": false,
      "allow-unverified": true,
    });
    expect(deps.readChangelog.mock.calls).toHaveLength(0);
  });

  it("a dirty working tree refuses before the changelog is read", () => {
    const deps = makeDeps({ isWorkingTreeClean: mock((_cwd: string): boolean => false) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() =>
      cmd.run?.([], {
        dry: false,
        "allow-dirty": false,
        "allow-empty-changelog": false,
        "allow-semver": false,
        "allow-branch": false,
        "allow-unverified": true,
      }),
    ).toThrow("Working tree is not clean. Commit or stash changes first, or use --allow-dirty.");
    expect(deps.readChangelog.mock.calls).toHaveLength(0);
  });
});

describe("createReleaseCommand — the derived stageFiles default", () => {
  const FLAGS = {
    dry: false,
    "allow-dirty": true,
    "allow-empty-changelog": false,
    "allow-semver": false,
    "allow-branch": false,
    "allow-unverified": true,
  };

  // The digest manifest rides the same commit as the promotion it records: a commit carrying the
  // new section without its digest is one the changelog check then refuses.
  it("stages the changelog it promoted and the digests it recorded, so all three land in one commit", () => {
    const deps = makeDeps();

    void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json", "CHANGELOG.md", "config/changelog-sections.json"]);
  });

  it("records the digests from the promoted document, not the one it read", () => {
    const deps = makeDeps();

    void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS);

    expect(deps.writeChangelogSections.mock.calls[0]?.[2]).toBe(deps.writeChangelog.mock.calls[0]?.[2]);
  });

  it("follows a renamed changelog rather than staging a `CHANGELOG.md` that was never written", () => {
    const deps = makeDeps();

    void createReleaseCommand({ cwd: "/project", changelogFile: "docs/CHANGES.md" }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json", "docs/CHANGES.md", "config/changelog-sections.json"]);
  });

  it("stages package.json alone when there is no changelog, since `git add` fails on a missing path", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => null) });

    void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json"]);
  });

  it("takes an explicit list verbatim, for a lockfile or a monorepo's sibling manifests", () => {
    const deps = makeDeps({ worktreeChanges: mock((_cwd: string): readonly string[] | undefined => ["bun.lock"]) });

    void createReleaseCommand({ cwd: "/project", stageFiles: ["package.json", "bun.lock"] }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json", "bun.lock", "config/changelog-sections.json"]);
  });

  it("lets an explicit list drop the changelog, since the field is an override and not an addition", () => {
    const deps = makeDeps();

    void createReleaseCommand({ cwd: "/project", stageFiles: ["package.json"] }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json", "config/changelog-sections.json"]);
  });

  // Naming the manifest was the only way to stage it before the append existed, so a project's
  // config still holds it and must not end up staging or naming the path twice.
  it("stages the digest manifest once for an explicit list that already names it", () => {
    const deps = makeDeps();

    void createReleaseCommand({ cwd: "/project", stageFiles: ["package.json", "config/changelog-sections.json"] }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json", "config/changelog-sections.json"]);
  });

  it("names the digest manifest once in the recovery when the explicit list already held it", () => {
    const deps = makeDeps({
      commit: mock((): boolean => {
        throw new Error("index.lock exists");
      }),
    });

    const thrown = (() => {
      try {
        void createReleaseCommand({ cwd: "/project", stageFiles: ["package.json", "config/changelog-sections.json"] }, deps).run?.([], FLAGS);
      } catch (error) {
        return error as Error;
      }
      return null;
    })();

    expect(thrown?.message).toStartWith("package.json and config/changelog-sections.json may hold the 1.1.0 release uncommitted");
  });

  // The manifest is forge's own write rather than a project's choice, and `checkChangelog` refuses
  // the next gate run without it — so an override may drop the changelog but never the digests.
  it("stages neither the changelog nor the digests for an explicit list on a run that promoted nothing", () => {
    const deps = makeDeps({
      readChangelog: mock((_cwd: string, _file: string): string | null => null),
      worktreeChanges: mock((_cwd: string): readonly string[] | undefined => ["bun.lock"]),
    });

    void createReleaseCommand({ cwd: "/project", stageFiles: ["package.json", "bun.lock"] }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json", "bun.lock"]);
  });

  it("names the digest manifest in the recovery a failed commit prints", () => {
    const deps = makeDeps({
      commit: mock((): boolean => {
        throw new Error("index.lock exists");
      }),
    });

    const thrown = (() => {
      try {
        void createReleaseCommand({ cwd: "/project", stageFiles: ["package.json"] }, deps).run?.([], FLAGS);
      } catch (error) {
        return error as Error;
      }
      return null;
    })();

    expect(thrown?.message).toStartWith("package.json and config/changelog-sections.json may hold the 1.1.0 release uncommitted");
  });
});

describe("createReleaseCommand() — the branch and gate preflight", () => {
  const FLAGS = {
    dry: false,
    "allow-dirty": true,
    "allow-empty-changelog": false,
    "allow-semver": false,
    "allow-branch": false,
    "allow-unverified": false,
  };

  it("runs the gate before the version write, and tags once it passes", () => {
    const order: string[] = [];
    const deps = makeDeps({
      runGate: mock((_cwd: string, _command: readonly string[]): GateOutcome => {
        order.push("gate");
        return "passed";
      }),
      updatePackageVersion: mock((_version: string, _cwd: string): void => {
        order.push("write");
      }),
      createTag: mock((_cwd: string, _tag: string): void => {
        order.push("tag");
      }),
    });

    runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS));

    expect(order).toEqual(["gate", "write", "tag"]);
  });

  it("refuses a red gate with nothing written and no tag cut", () => {
    const deps = makeDeps({ runGate: mock((_cwd: string, _command: readonly string[]): GateOutcome => "failed") });

    expect(() => runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS))).toThrow(ReleaseError);
    expect(deps.updatePackageVersion).not.toHaveBeenCalled();
    expect(deps.writeChangelog).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
    expect(deps.createTag).not.toHaveBeenCalled();
  });

  it("refuses a branch the remote does not publish from, before running the gate", () => {
    const deps = makeDeps({ currentBranch: mock((_cwd: string): string | null => "feature/x") });

    expect(() => runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS))).toThrow(
      "HEAD is on feature/x, and the remote publishes from main",
    );
    expect(deps.runGate).not.toHaveBeenCalled();
    expect(deps.updatePackageVersion).not.toHaveBeenCalled();
  });

  // A tag on a commit no branch carries is the failure this guard exists for, and whether HEAD is
  // detached is answerable without the remote — so it is refused even when the remote answers nothing.
  it("refuses a detached HEAD, whether or not the remote names a publishing branch", () => {
    for (const publishesFrom of ["main", null]) {
      const deps = makeDeps({
        currentBranch: mock((_cwd: string): string | null => null),
        defaultBranch: mock((_cwd: string): string | null => publishesFrom),
      });

      expect(() => runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS))).toThrow(
        "HEAD is detached, so the release commit would sit on no branch",
      );
      expect(deps.runGate).not.toHaveBeenCalled();
      expect(deps.updatePackageVersion).not.toHaveBeenCalled();
      expect(deps.commit).not.toHaveBeenCalled();
      expect(deps.createTag).not.toHaveBeenCalled();
    }
  });

  it("releases from a detached HEAD under --allow-branch, which is the same escape as any other", () => {
    const deps = makeDeps({
      currentBranch: mock((_cwd: string): string | null => null),
      defaultBranch: mock((_cwd: string): string | null => null),
    });

    runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], { ...FLAGS, "allow-branch": true }));

    expect(deps.createTag).toHaveBeenCalled();
  });

  it("releases from another branch under --allow-branch, and skips the gate under --allow-unverified", () => {
    const deps = makeDeps({ currentBranch: mock((_cwd: string): string | null => "release/1.1") });

    runCapturingLogs(
      () => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], { ...FLAGS, "allow-branch": true, "allow-unverified": true }),
    );

    expect(deps.runGate).not.toHaveBeenCalled();
    expect(deps.createTag).toHaveBeenCalled();
  });

  it("runs neither check on a dry run, which writes nothing to check for", () => {
    const deps = makeDeps();

    runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], { ...FLAGS, dry: true }));

    expect(deps.runGate).not.toHaveBeenCalled();
    expect(deps.currentBranch).not.toHaveBeenCalled();
  });

  it("names the resume as the recovery when the commit fails with the version and changelog already written", () => {
    const deps = makeDeps({
      commit: mock((_cwd: string, _message: string, _files: string[]): boolean => {
        throw new Error("pre-commit hook failed");
      }),
    });

    expect(() => runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS))).toThrow(
      "Run the release again: it re-derives the release from the working tree and writes only what still differs.",
    );
    expect(deps.createTag).not.toHaveBeenCalled();
  });
});

describe("createReleaseCommand() — an unanswerable branch question and a gate that cannot run", () => {
  const FLAGS = {
    dry: false,
    "allow-dirty": true,
    "allow-empty-changelog": false,
    "allow-semver": false,
    "allow-branch": false,
    "allow-unverified": false,
  };

  // `refs/remotes/origin/HEAD` is written by `git clone` alone, so a repository created locally and
  // pushed has none — releasing there must not be refused against a branch nobody named.
  it("releases from any branch when the remote names no publishing branch, saying the question went unanswered", () => {
    const deps = makeDeps({
      currentBranch: mock((_cwd: string): string | null => "develop"),
      defaultBranch: mock((_cwd: string): string | null => null),
    });

    const logs = runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS));

    expect(deps.createTag).toHaveBeenCalled();
    expect(logs.join("\n")).toContain("remote names no publishing branch — could not confirm develop");
  });

  it("refuses a gate that could not be run in its own words, naming the config field that fixes it", () => {
    const deps = makeDeps({ runGate: mock((_cwd: string, _command: readonly string[]): GateOutcome => "unrunnable") });

    expect(() => runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS))).toThrow(
      "`bun run verify` could not be run",
    );
    expect(deps.updatePackageVersion).not.toHaveBeenCalled();
    expect(deps.createTag).not.toHaveBeenCalled();
  });

  it("runs the gate command the config names, rather than the default", () => {
    const deps = makeDeps();

    runCapturingLogs(() => void createReleaseCommand({ cwd: "/project", gateCommand: ["make", "check"] }, deps).run?.([], FLAGS));

    expect(deps.runGate.mock.calls[0]).toEqual(["/project", ["make", "check"]]);
  });

  it("names the configured command in both refusals, since the default is not what ran", () => {
    const failing = makeDeps({ runGate: mock((_cwd: string, _command: readonly string[]): GateOutcome => "failed") });
    expect(() =>
      runCapturingLogs(() => void createReleaseCommand({ cwd: "/project", gateCommand: ["make", "check"] }, failing).run?.([], FLAGS)),
    ).toThrow("`make check` failed");

    const absent = makeDeps({ runGate: mock((_cwd: string, _command: readonly string[]): GateOutcome => "unrunnable") });
    expect(() =>
      runCapturingLogs(() => void createReleaseCommand({ cwd: "/project", gateCommand: ["make", "check"] }, absent).run?.([], FLAGS)),
    ).toThrow("`make check` could not be run");
  });
});

describe("defineReleaseConfig()", () => {
  it("returns its argument unchanged", () => {
    const config = { gateCommand: ["bun", "run", "verify:scheduled"] };

    expect(defineReleaseConfig(config)).toBe(config);
  });

  it("returns a host-tag config unchanged", () => {
    const config = { tagOn: "pushed" as const };

    expect(defineReleaseConfig(config)).toEqual({ tagOn: "pushed" });
  });
});

const SECTIONS_FILE = "config/changelog-sections.json";
const RELEASE_FILES = ["package.json", "CHANGELOG.md", SECTIONS_FILE];
const FIRST_HEAD = "1".repeat(40);
const FIRST_PARENT = "0".repeat(40);
const MANIFEST_1_0_0 = '{\n  "name": "fixture",\n  "version": "1.0.0"\n}\n';
const MANIFEST_1_1_0 = '{\n  "name": "fixture",\n  "version": "1.1.0"\n}\n';

const RESUME_FLAGS = {
  dry: false,
  "allow-dirty": false,
  "allow-empty-changelog": false,
  "allow-semver": false,
  "allow-branch": false,
  "allow-unverified": false,
};

interface Repo {
  head: Record<string, string>;
  parentHead: Record<string, string>;
  work: Record<string, string>;
  headSha: string;
  parentSha: string;
  subject: string;
  committed: string[];
  tags: string[];
  remote: string[] | null;
  writable: boolean;
  today: Date;
  untracked: string[];
  records: Map<string, GateRecord>;
  /** origin/main after a fetch, newest first; `null` when the fetch leaves no origin/main. */
  published: CommitSummary[] | null;
  pushRefuses: boolean;
  pushed: string[];
}

/** A stand-in tree id: equal for equal contents, whatever commit carries them. */
function treeOf(files: Record<string, string>): string {
  return createHash("sha1")
    .update(JSON.stringify(Object.entries(files).sort()))
    .digest("hex");
}

function differingPaths(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((path) => a[path] !== b[path]);
}

/** An in-memory repository behind every `ReleaseDeps` member, whose writes and commits move its own state. */
function fakeRepo(seed: Partial<Repo> = {}) {
  const head = seed.head ?? { "package.json": MANIFEST_1_0_0, "CHANGELOG.md": WRITTEN, [SECTIONS_FILE]: "{}\n" };
  const repo: Repo = {
    head,
    parentHead: {},
    work: { ...head },
    headSha: FIRST_HEAD,
    parentSha: FIRST_PARENT,
    subject: "feat: a thing",
    committed: ["src/a.ts"],
    tags: ["v1.0.0"],
    remote: ["v1.0.0"],
    writable: true,
    today: new Date(2026, 1, 3),
    untracked: [],
    records: new Map(),
    published: [{ commit: FIRST_HEAD, tree: treeOf(head), subject: "feat: a thing" }],
    pushRefuses: false,
    pushed: [],
    ...seed,
  };
  let sequence = 1;

  const land = (message: string, files: readonly string[]): boolean => {
    const changed = files.filter((path) => repo.work[path] !== repo.head[path]);
    if (changed.length === 0) return false;
    sequence += 1;
    repo.parentSha = repo.headSha;
    repo.headSha = String(sequence).repeat(40);
    repo.parentHead = repo.head;
    const next = { ...repo.head };
    for (const path of changed) {
      const content = repo.work[path];
      if (content === undefined) delete next[path];
      else next[path] = content;
    }
    repo.head = next;
    repo.committed = changed;
    repo.subject = message;
    return true;
  };

  const deps: MockDeps = {
    isWorkingTreeClean: mock((_cwd: string) => differingPaths(repo.head, repo.work).length + repo.untracked.length === 0),
    resolveVersion: mock(({ explicit }: { explicit?: string }): VersionResult => {
      if (repo.tags.includes("v1.1.0")) return { version: "1.1.0", reason: "in-sync", previous: "v1.1.0" };
      if (explicit !== undefined) return { version: explicit, reason: "explicit", previous: "v1.0.0" };
      return { version: "1.1.0", reason: "auto-minor", previous: "v1.0.0" };
    }),
    updatePackageVersion: mock((version: string, _cwd: string): void => {
      repo.work["package.json"] = packageWithVersion(repo.work["package.json"] ?? "{}", version);
    }),
    commit: mock((_cwd: string, message: string, files: string[]): boolean => land(message, files)),
    committedPaths: mock((_cwd: string): string[] => [...repo.committed]),
    tagExists: mock((_cwd: string, tag: string): boolean => repo.tags.includes(tag)),
    createTag: mock((_cwd: string, tag: string, _commit?: string): void => {
      repo.tags.push(tag);
    }),
    fetchRemote: mock((_cwd: string): void => {}),
    commitSummary: mock((_cwd: string, ref: string): CommitSummary | null =>
      ref === "refs/remotes/origin/main" ? (repo.published?.[0] ?? null) : null,
    ),
    commitWithSubject: mock(
      (_cwd: string, _ref: string, subject: string, _since: string | null): string | null =>
        (repo.published ?? []).find((entry) => entry.subject === subject)?.commit ?? null,
    ),
    pushTag: mock((_cwd: string, tag: string): void => {
      if (!repo.tags.includes(tag)) throw new ReleaseError("git-error", `git push failed: error: src refspec refs/tags/${tag} does not match any`);
      if (repo.pushRefuses)
        throw new ReleaseError("git-error", `git push failed: ! [remote rejected] ${tag} -> ${tag} (pre-receive hook declined)`);
      repo.pushed.push(tag);
      repo.remote?.push(tag);
    }),
    deleteTag: mock((_cwd: string, tag: string): void => {
      repo.tags = repo.tags.filter((entry) => entry !== tag);
    }),
    readChangelog: mock((_cwd: string, file: string): string | null => repo.work[file] ?? null),
    writeChangelog: mock((_cwd: string, file: string, source: string): void => {
      repo.work[file] = source;
    }),
    writeChangelogSections: mock((_cwd: string, file: string, source: string): void => {
      repo.work[file] = changelogSectionsSource(source);
    }),
    readRepositoryUrl: mock((_cwd: string): string | null => "https://x/repo"),
    removedSurfaceSince: mock((_cwd: string, _ref: string): string[] => []),
    tagIsAncestorOfHead: mock((_cwd: string, _tag: string): boolean => true),
    remoteTags: mock((_cwd: string): string[] | null => (repo.remote === null ? null : [...repo.remote])),
    currentBranch: mock((_cwd: string): string | null => "main"),
    defaultBranch: mock((_cwd: string): string | null => "main"),
    runGate: mock((_cwd: string, _command: readonly string[]): GateOutcome => "passed"),
    now: mock((): Date => repo.today),
    gitWritable: mock((_cwd: string): boolean => repo.writable),
    readFileAtRef: mock((_cwd: string, ref: string, path: string): string | null => {
      if (ref !== "HEAD") throw new Error(`the fake answers HEAD only, not ${ref}`);
      return repo.head[path] ?? null;
    }),
    lastCommitSubject: mock((_cwd: string): string => repo.subject),
    resolveCommit: mock((_cwd: string, ref: string): string => {
      if (ref === "HEAD") return repo.headSha;
      if (ref === "HEAD^") return repo.parentSha;
      throw new Error(`the fake resolves HEAD and HEAD^ only, not ${ref}`);
    }),
    resolveTree: mock((_cwd: string, ref: string): string => {
      if (ref === "HEAD") return treeOf(repo.head);
      if (ref === "HEAD^") return treeOf(repo.parentHead);
      throw new Error(`the fake resolves HEAD and HEAD^ only, not ${ref}`);
    }),
    worktreeChanges: mock((_cwd: string): readonly string[] | undefined =>
      [...new Set([...differingPaths(repo.head, repo.work), ...repo.untracked])].sort(),
    ),
    readWorkingFile: mock((_cwd: string, path: string): string | null => repo.work[path] ?? null),
    readGateRecord: mock((_cwd: string, tag: string): GateRecord | null => repo.records.get(tag) ?? null),
    writeGateRecord: mock((_cwd: string, tag: string, record: GateRecord): void => {
      repo.records.set(tag, record);
    }),
  };

  const run = (args: string[] = [], flags = RESUME_FLAGS, config: Omit<Parameters<typeof createReleaseCommand>[0], "cwd"> = {}): string[] =>
    runCapturingLogs(() => void createReleaseCommand({ cwd: "/project", ...config }, deps).run?.(args, flags));

  const clear = (): void => {
    for (const fn of Object.values(deps)) fn.mockClear();
  };

  /** The merge skill's squash: a new sha over the same trees and subject. */
  const squash = (parentSha = repo.parentSha): void => {
    sequence += 1;
    repo.headSha = String(sequence).repeat(40);
    repo.parentSha = parentSha;
  };

  /** The push flow: the squash, then the squashed commit on top of origin/main. */
  const push = (): void => {
    squash();
    repo.published = [{ commit: repo.headSha, tree: treeOf(repo.head), subject: repo.subject }, ...(repo.published ?? [])];
  };

  return { repo, deps, land, run, clear, squash, push };
}

function outcomeOf(run: () => unknown): string {
  try {
    run();
    return "ok";
  } catch (err) {
    return err instanceof ReleaseError ? err.kind : `threw ${String(err)}`;
  }
}

function errorFrom(run: () => unknown): ReleaseError {
  try {
    run();
  } catch (err) {
    if (err instanceof ReleaseError) return err;
    throw err;
  }
  throw new Error("expected a ReleaseError");
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** git's own answer for each content's blob id, so the printed `# expect` is checked against git rather than against the formula. */
function gitBlobIds(contents: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-release-blob-"));
  try {
    const paths = contents.map((content, i) => {
      const path = join(dir, String(i));
      writeFileSync(path, content);
      return path;
    });
    const result = spawnSync("git", ["hash-object", ...paths], { encoding: "utf-8", env: worktreeGitEnv() });
    if (result.status !== 0) throw new Error(`git hash-object failed: ${result.stderr}`);
    return result.stdout.trim().split("\n").join(" ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function releaseCalls(deps: MockDeps): Record<string, number> {
  return {
    updatePackageVersion: deps.updatePackageVersion.mock.calls.length,
    writeChangelog: deps.writeChangelog.mock.calls.length,
    commit: deps.commit.mock.calls.length,
    createTag: deps.createTag.mock.calls.length,
  };
}

/** A fake left where a read-only release stops: the release written, nothing committed. */
function writtenRepo(seed: Partial<Repo> = {}) {
  const fake = fakeRepo({ ...seed, writable: false });
  fake.run();
  fake.clear();
  return fake;
}

function committedRepo(seed: Partial<Repo> = {}) {
  const fake = writtenRepo(seed);
  fake.land("chore: release 1.1.0", RELEASE_FILES);
  return fake;
}

function hostStepsIn(logs: readonly string[]): string[] {
  const start = logs.findIndex((line) => line.startsWith("\n.git is read-only here"));
  return start === -1 ? [] : logs.slice(start);
}

const PUSHED = { tagOn: "pushed" as const };

describe("createReleaseCommand() — resuming a release from the state the repository is in", () => {
  type Start = "fresh" | "written" | "committed" | "tagged" | "bumped-only" | "version-mismatch";

  function startIn(start: Start, writable: boolean) {
    const fake =
      start === "fresh" || start === "bumped-only"
        ? fakeRepo()
        : start === "written" || start === "version-mismatch"
          ? writtenRepo()
          : committedRepo();
    if (start === "tagged") fake.repo.tags.push("v1.1.0");
    if (start === "bumped-only") fake.repo.work["package.json"] = MANIFEST_1_1_0;
    fake.repo.writable = writable;
    return { fake, args: start === "version-mismatch" ? ["1.2.0"] : [] };
  }

  const none = { updatePackageVersion: 0, writeChangelog: 0, commit: 0, createTag: 0 };
  const cases: { start: Start; writable: boolean; outcomes: string[]; calls: Record<string, number> }[] = [
    { start: "fresh", writable: true, outcomes: ["ok", "ok"], calls: { updatePackageVersion: 1, writeChangelog: 1, commit: 1, createTag: 1 } },
    { start: "fresh", writable: false, outcomes: ["ok", "ok"], calls: { updatePackageVersion: 1, writeChangelog: 1, commit: 0, createTag: 0 } },
    { start: "written", writable: true, outcomes: ["ok", "ok"], calls: { ...none, commit: 1, createTag: 1 } },
    { start: "written", writable: false, outcomes: ["ok", "ok"], calls: none },
    { start: "committed", writable: true, outcomes: ["ok", "ok"], calls: { ...none, createTag: 1 } },
    { start: "committed", writable: false, outcomes: ["ok", "ok"], calls: none },
    { start: "tagged", writable: true, outcomes: ["ok", "ok"], calls: none },
    { start: "tagged", writable: false, outcomes: ["ok", "ok"], calls: none },
    { start: "bumped-only", writable: true, outcomes: ["ok", "ok"], calls: { ...none, writeChangelog: 1, commit: 1, createTag: 1 } },
    { start: "bumped-only", writable: false, outcomes: ["ok", "ok"], calls: { ...none, writeChangelog: 1 } },
    { start: "version-mismatch", writable: true, outcomes: ["version-mismatch", "version-mismatch"], calls: none },
    { start: "version-mismatch", writable: false, outcomes: ["version-mismatch", "version-mismatch"], calls: none },
  ];

  for (const { start, writable, outcomes, calls } of cases) {
    it(`${start}, .git ${writable ? "writable" : "read-only"}: two consecutive runs write and commit and tag at most once`, () => {
      const { fake, args } = startIn(start, writable);

      const seen = [outcomeOf(() => fake.run(args)), outcomeOf(() => fake.run(args))];

      expect({ outcomes: seen, calls: releaseCalls(fake.deps) }).toEqual({ outcomes, calls });
    });
  }

  const pushedCases: { start: Start; outcomes: string[]; calls: Record<string, number> }[] = [
    { start: "fresh", outcomes: ["ok", "ok"], calls: { updatePackageVersion: 1, writeChangelog: 1, commit: 1, createTag: 0 } },
    { start: "written", outcomes: ["ok", "ok"], calls: { ...none, commit: 1 } },
    { start: "committed", outcomes: ["ok", "ok"], calls: none },
    { start: "tagged", outcomes: ["ok", "ok"], calls: none },
    { start: "bumped-only", outcomes: ["ok", "ok"], calls: { ...none, writeChangelog: 1, commit: 1 } },
    { start: "version-mismatch", outcomes: ["version-mismatch", "version-mismatch"], calls: none },
  ];

  for (const { start, outcomes, calls } of pushedCases) {
    it(`${start}, .git writable, tagOn pushed: two consecutive runs before the push write and commit at most once and never tag or push`, () => {
      const { fake, args } = startIn(start, true);

      const seen = [outcomeOf(() => fake.run(args, RESUME_FLAGS, PUSHED)), outcomeOf(() => fake.run(args, RESUME_FLAGS, PUSHED))];

      expect({ outcomes: seen, calls: { ...releaseCalls(fake.deps), pushTag: fake.deps.pushTag.mock.calls.length } }).toEqual({
        outcomes,
        calls: { ...calls, pushTag: 0 },
      });
    });
  }

  it("leaves exactly one [1.1.0] heading in the changelog after a read-only run, its rerun, the host commit and the tag", () => {
    const fake = fakeRepo({ writable: false });
    const headings = (): number => (fake.repo.work["CHANGELOG.md"] ?? "").split("\n").filter((line) => line.startsWith("## [1.1.0]")).length;

    fake.run();
    fake.run();
    fake.land("chore: release 1.1.0", RELEASE_FILES);
    fake.run();
    fake.repo.tags.push("v1.1.0");
    fake.run();

    expect({ headings: headings(), headVersion: JSON.parse(fake.repo.head["package.json"] ?? "{}").version }).toEqual({
      headings: 1,
      headVersion: "1.1.0",
    });
  });
});

describe("createReleaseCommand() — the steps it prints for the host when .git is read-only", () => {
  it("prints the commit, the tag and the push for a written release, with HEAD and each file's blob id filled in", () => {
    const fake = writtenRepo();

    const steps = hostStepsIn(fake.run());

    const ids = gitBlobIds(RELEASE_FILES.map((path) => fake.repo.work[path] ?? ""));
    expect(steps).toEqual([
      "\n.git is read-only here, so commit and tag v1.1.0 on the host:",
      `  test "$(git rev-parse HEAD)" = ${FIRST_HEAD} && git hash-object package.json CHANGELOG.md config/changelog-sections.json   # expect ${ids}`,
      '  git commit -m "chore: release 1.1.0" -- package.json CHANGELOG.md config/changelog-sections.json',
      "  git tag v1.1.0",
      "  git push && git push --tags",
      "Then run `bun run release` here to confirm.",
    ]);
  });

  it("prints the same steps on the fresh run that wrote the release as on its rerun", () => {
    const fake = fakeRepo({ writable: false });

    const first = hostStepsIn(fake.run());
    const second = hostStepsIn(fake.run());

    expect(first).toEqual(second);
    expect(first).toHaveLength(6);
  });

  it("prints only the tag and the push for a release the host already committed", () => {
    const fake = committedRepo();

    expect(hostStepsIn(fake.run())).toEqual([
      "\n.git is read-only here, so tag v1.1.0 on the host:",
      "  git tag v1.1.0",
      "  git push && git push --tags",
      "Then run `bun run release` here to confirm.",
    ]);
  });

  it("quotes a staged path the shell would split", () => {
    const fake = writtenRepo({ head: { "package.json": MANIFEST_1_0_0, "CHANGELOG.md": WRITTEN, "my notes.md": "x\n", [SECTIONS_FILE]: "{}\n" } });
    fake.repo.work["my notes.md"] = "y\n";

    const steps = hostStepsIn(fake.run([], RESUME_FLAGS, { stageFiles: ["package.json", "CHANGELOG.md", "my notes.md"] }));

    expect(steps[2]).toBe("  git commit -m \"chore: release 1.1.0\" -- package.json CHANGELOG.md 'my notes.md' config/changelog-sections.json");
  });
});

describe("createReleaseCommand() — the commit row", () => {
  const DRY = { ...RESUME_FLAGS, dry: true };

  it("reads `here` on a dry run with a writable .git", () => {
    expect(fakeRepo().run([], DRY)).toEqual([
      "  previous:  v1.0.0",
      "  next:      1.1.0  (auto-minor)",
      "  tag:       v1.1.0",
      "  changelog: [Unreleased] → [1.1.0] — 2026-02-03",
      "  commit:    here",
      "\nDry run — no changes made.",
    ]);
  });

  it("reads `on the host` on a dry run with a read-only .git", () => {
    expect(fakeRepo({ writable: false }).run([], DRY)).toEqual([
      "  previous:  v1.0.0",
      "  next:      1.1.0  (auto-minor)",
      "  tag:       v1.1.0",
      "  changelog: [Unreleased] → [1.1.0] — 2026-02-03",
      "  commit:    on the host (.git is read-only)",
      "\nDry run — no changes made.",
    ]);
  });

  it("is printed on a resumed run too, beside the changelog it found already written", () => {
    const logs = writtenRepo().run([], DRY);

    expect(logs.slice(3, 5)).toEqual(["  changelog: [1.1.0] — 2026-02-03  (already written)", "  commit:    on the host (.git is read-only)"]);
  });

  it("is printed on a run that commits and tags", () => {
    const logs = fakeRepo().run();

    expect(logs.filter((line) => line.startsWith("  commit:"))).toEqual(["  commit:    here"]);
  });
});

describe("createReleaseCommand() — the release date on a resumed run", () => {
  it("keeps the date the written heading carries when resumed on a later day", () => {
    const fake = writtenRepo();
    const changelog = fake.repo.work["CHANGELOG.md"];
    fake.repo.today = new Date(2026, 2, 9);

    const logs = fake.run([], { ...RESUME_FLAGS, dry: true });

    expect({ row: logs[3], changelog: fake.repo.work["CHANGELOG.md"] }).toEqual({
      row: "  changelog: [1.1.0] — 2026-02-03  (already written)",
      changelog,
    });
  });

  it("resumes a written release on a later day instead of refusing it as partial", () => {
    const fake = writtenRepo();
    fake.repo.writable = true;
    fake.repo.today = new Date(2026, 2, 9);

    fake.run();

    expect(fake.repo.head["CHANGELOG.md"]?.split("\n").filter((line) => line.startsWith("## [1.1.0]"))).toEqual(["## [1.1.0] — 2026-02-03"]);
  });

  it("reads a committed release's date from HEAD's heading", () => {
    const fake = committedRepo();
    fake.repo.today = new Date(2026, 2, 9);

    expect(fake.run([], { ...RESUME_FLAGS, dry: true })[3]).toBe("  changelog: [1.1.0] — 2026-02-03  (already committed)");
  });
});

describe("createReleaseCommand() — the explicit version on a resumed run", () => {
  it("resumes a written release named by its own version", () => {
    const fake = writtenRepo();
    fake.repo.writable = true;

    fake.run(["1.1.0"]);

    expect({ subject: fake.repo.subject, tags: fake.repo.tags }).toEqual({ subject: "chore: release 1.1.0", tags: ["v1.0.0", "v1.1.0"] });
  });

  it("refuses another version over a written release, naming the one to finish", () => {
    const fake = writtenRepo();

    const err = errorFrom(() => fake.run(["1.2.0"]));

    expect({ kind: err.kind, message: err.message }).toEqual({
      kind: "version-mismatch",
      message:
        "package.json holds 1.1.0 from a release that was written and never committed, so 1.2.0 cannot be released over it.\n" +
        "Finish 1.1.0 first: run the release again with 1.1.0.",
    });
    expect(fake.repo.work["package.json"]).toBe(MANIFEST_1_1_0);
  });

  it("refuses another version on top of an untagged release commit, naming the one to finish", () => {
    const fake = committedRepo();

    const err = errorFrom(() => fake.run(["1.2.0"]));

    expect({ kind: err.kind, message: err.message }).toEqual({
      kind: "version-mismatch",
      message:
        "HEAD is the release commit for 1.1.0, which was never tagged, so 1.2.0 cannot be released on top of it.\n" +
        "Finish 1.1.0 first: run the release again with 1.1.0.",
    });
    expect(fake.deps.runGate).not.toHaveBeenCalled();
  });

  it("releases on top of a release commit that was tagged", () => {
    const fake = committedRepo();
    fake.repo.tags.push("v1.1.0");
    fake.repo.writable = true;
    fake.deps.resolveVersion.mockImplementation((): VersionResult => ({ version: "1.2.0", reason: "explicit", previous: "v1.1.0" }));
    fake.repo.remote = ["v1.0.0", "v1.1.0"];

    expect(outcomeOf(() => fake.run(["1.2.0"], { ...RESUME_FLAGS, "allow-empty-changelog": true }))).toBe("ok");
  });
});

describe("createReleaseCommand() — a working tree holding part of a release", () => {
  it("finishes a bumped package.json with no promotion by promoting the changelog, leaving package.json as it is", () => {
    const fake = fakeRepo();
    fake.repo.work["package.json"] = MANIFEST_1_1_0;

    fake.run();

    expect({ calls: releaseCalls(fake.deps), committed: fake.repo.committed.sort() }).toEqual({
      calls: { updatePackageVersion: 0, writeChangelog: 1, commit: 1, createTag: 1 },
      committed: [...RELEASE_FILES].sort(),
    });
  });

  it("refuses an edit to a released section other than the one being released, since that section shipped", () => {
    const fake = writtenRepo();
    fake.repo.work["CHANGELOG.md"] = `${fake.repo.work["CHANGELOG.md"]}\n- added by hand`;

    const err = errorFrom(() => fake.run());

    expect({ kind: err.kind, message: err.message }).toEqual({
      kind: "release-partial",
      message:
        "CHANGELOG.md changes [1.0.0] against HEAD, and those sections shipped with their tags, so the release will not carry the edit.\n" +
        "Restore them from HEAD (`git show HEAD:./CHANGELOG.md` prints it, and works with .git read-only), then release again.",
    });
  });

  it("refuses a package.json changing more than its version against HEAD", () => {
    const fake = writtenRepo();
    fake.repo.work["package.json"] = MANIFEST_1_1_0.replace('"version"', '"private": true,\n  "version"');

    expect(outcomeOf(() => fake.run())).toBe("release-partial");
  });

  it("bumps a package.json that was put back, and rewrites nothing else", () => {
    const fake = writtenRepo();
    fake.repo.work["package.json"] = MANIFEST_1_0_0;

    fake.run();

    expect({ ...releaseCalls(fake.deps), sections: fake.deps.writeChangelogSections.mock.calls.length }).toEqual({
      updatePackageVersion: 1,
      writeChangelog: 0,
      commit: 0,
      createTag: 0,
      sections: 0,
    });
  });

  it("regenerates a sections manifest that does not record the promotion, and rewrites nothing else", () => {
    const fake = writtenRepo();
    fake.repo.work[SECTIONS_FILE] = "{}\n";

    fake.run();

    expect({ ...releaseCalls(fake.deps), sections: fake.deps.writeChangelogSections.mock.calls.length }).toEqual({
      updatePackageVersion: 0,
      writeChangelog: 0,
      commit: 0,
      createTag: 0,
      sections: 1,
    });
  });

  it("writes what a bumped package.json lacks once, and nothing on the run after", () => {
    const fake = fakeRepo({ writable: false });
    fake.repo.work["package.json"] = MANIFEST_1_1_0;

    fake.run();
    const first = { ...releaseCalls(fake.deps), sections: fake.deps.writeChangelogSections.mock.calls.length };
    fake.clear();
    fake.run();

    expect({ first, second: { ...releaseCalls(fake.deps), sections: fake.deps.writeChangelogSections.mock.calls.length } }).toEqual({
      first: { updatePackageVersion: 0, writeChangelog: 1, commit: 0, createTag: 0, sections: 1 },
      second: { updatePackageVersion: 0, writeChangelog: 0, commit: 0, createTag: 0, sections: 0 },
    });
  });

  it("tags HEAD with no commit when the release files were committed under another subject", () => {
    const fake = writtenRepo();
    fake.land("chore: bump", RELEASE_FILES);

    expect(hostStepsIn(fake.run())).toEqual([
      "\n.git is read-only here, so tag v1.1.0 on the host:",
      `  test "$(git rev-parse HEAD)" = ${fake.repo.headSha} && git tag v1.1.0`,
      "  git push && git push --tags",
      "Then run `bun run release` here to confirm.",
    ]);
    expect(releaseCalls(fake.deps)).toEqual({ updatePackageVersion: 0, writeChangelog: 0, commit: 0, createTag: 0 });
  });

  it("tags a release commit that also changed a path outside the staged set, without a second commit", () => {
    const fake = writtenRepo();
    fake.repo.work["src/a.ts"] = "export {};\n";
    fake.land("chore: release 1.1.0", [...RELEASE_FILES, "src/a.ts"]);
    fake.repo.writable = true;

    fake.run();

    expect({ commit: fake.deps.commit.mock.calls.length, tags: fake.repo.tags }).toEqual({ commit: 0, tags: ["v1.0.0", "v1.1.0"] });
  });

  it("commits the file a release commit left out, then tags", () => {
    const fake = writtenRepo();
    fake.land("chore: release 1.1.0", ["package.json", "CHANGELOG.md"]);
    fake.repo.writable = true;

    fake.run();

    expect({ commits: fake.deps.commit.mock.calls, tags: fake.repo.tags }).toEqual({
      commits: [["/project", "chore: release 1.1.0", [SECTIONS_FILE]]],
      tags: ["v1.0.0", "v1.1.0"],
    });
  });

  it("accepts a release commit that is a subset of the staged set holding every file forge writes", () => {
    const fake = writtenRepo({ head: { "package.json": MANIFEST_1_0_0, "CHANGELOG.md": WRITTEN, "bun.lock": "lock\n", [SECTIONS_FILE]: "{}\n" } });
    fake.land("chore: release 1.1.0", ["package.json", "CHANGELOG.md", "bun.lock", SECTIONS_FILE]);
    fake.repo.writable = true;

    fake.run([], RESUME_FLAGS, { stageFiles: ["package.json", "CHANGELOG.md", "bun.lock"] });

    expect({ commit: fake.deps.commit.mock.calls.length, tags: fake.repo.tags }).toEqual({ commit: 0, tags: ["v1.0.0", "v1.1.0"] });
  });

  it("reports a working tree git cannot list as a git error", () => {
    const fake = fakeRepo();
    fake.deps.worktreeChanges.mockImplementation((): readonly string[] | undefined => undefined);

    const err = errorFrom(() => fake.run());

    expect({ kind: err.kind, message: err.message }).toEqual({
      kind: "git-error",
      message: "Cannot list what the working tree at /project changes against HEAD.",
    });
  });
});

describe("createReleaseCommand() — the clean-tree check on a written release", () => {
  it("refuses a change beyond the release files, naming it", () => {
    const fake = writtenRepo();
    fake.repo.untracked = ["src/new.ts"];

    const err = errorFrom(() => fake.run());

    expect({ kind: err.kind, message: err.message }).toEqual({
      kind: "working-tree-dirty",
      message: "Working tree changes src/new.ts, which the 1.1.0 release does not carry. Commit or stash them first, or use --allow-dirty.",
    });
  });

  it("commits only the release files past that change under --allow-dirty", () => {
    const fake = writtenRepo();
    fake.repo.untracked = ["src/new.ts"];
    fake.repo.writable = true;

    fake.run([], { ...RESUME_FLAGS, "allow-dirty": true });

    expect(fake.deps.commit.mock.calls).toEqual([["/project", "chore: release 1.1.0", RELEASE_FILES]]);
  });

  it("refuses a dirty tree on a committed release", () => {
    const fake = committedRepo();
    fake.repo.untracked = ["src/new.ts"];

    expect(outcomeOf(() => fake.run())).toBe("working-tree-dirty");
  });
});

describe("createReleaseCommand() — a release already tagged", () => {
  it("says it is already at the version, and prints the push when the remote lacks the tag", () => {
    const fake = committedRepo();
    fake.repo.tags.push("v1.1.0");

    expect(fake.run()).toEqual(["Already at 1.1.0 — nothing to release.", "v1.1.0 is not on the remote yet. Push it:\n  git push --tags"]);
  });

  it("prints no push when the remote carries the tag", () => {
    const fake = committedRepo();
    fake.repo.tags.push("v1.1.0");
    fake.repo.remote = ["v1.0.0", "v1.1.0"];

    expect(fake.run()).toEqual(["Already at 1.1.0 — nothing to release."]);
  });

  it("prints no push when the remote cannot be reached", () => {
    const fake = committedRepo();
    fake.repo.tags.push("v1.1.0");
    fake.repo.remote = null;

    expect(fake.run()).toEqual(["  (remote unreachable — could not confirm v1.1.0 is pushed)", "Already at 1.1.0 — nothing to release."]);
  });

  it("prints the push for a resolved version whose tag already exists locally", () => {
    const fake = fakeRepo();
    fake.repo.tags.push("v1.1.0");
    fake.deps.resolveVersion.mockImplementation((): VersionResult => ({ version: "1.1.0", reason: "auto-minor", previous: "v1.0.0" }));

    expect(fake.run()).toEqual([
      "\nTag v1.1.0 already exists — nothing to release.",
      "v1.1.0 is not on the remote yet. Push it:\n  git push --tags",
    ]);
  });
});

describe("createReleaseCommand() — the gate record", () => {
  const SKIPPED = "\n`bun run verify` already passed on these v1.1.0 files — not running it again.";

  it("records the version, HEAD's tree, each staged file's sha256, the gate command and when it passed", () => {
    const fake = fakeRepo({ writable: false });
    const baseTree = treeOf(fake.repo.head);

    fake.run();

    expect(fake.deps.writeGateRecord.mock.calls).toEqual([
      [
        "/project",
        "v1.1.0",
        {
          version: "1.1.0",
          baseTree,
          files: Object.fromEntries(RELEASE_FILES.map((path) => [path, sha256Hex(fake.repo.work[path] ?? "")])),
          gateCommand: ["bun", "run", "verify"],
          passedAt: new Date(2026, 1, 3).toISOString(),
        },
      ],
    ]);
  });

  it("skips the gate on a written release whose record matches HEAD and the working files", () => {
    const fake = writtenRepo();

    const logs = fake.run();

    expect({ gate: fake.deps.runGate.mock.calls.length, skipped: logs.includes(SKIPPED) }).toEqual({ gate: 0, skipped: true });
  });

  it("runs the gate again on a written release when HEAD is no longer the record's base", () => {
    const fake = writtenRepo();
    fake.repo.head["src/b.ts"] = "export const b = 1;\n";
    fake.repo.work["src/b.ts"] = "export const b = 1;\n";

    fake.run();

    expect(fake.deps.runGate.mock.calls.length).toBe(1);
  });

  it("does not take HEAD^ as a written release's base", () => {
    const fake = writtenRepo();
    const record = fake.repo.records.get("v1.1.0");
    if (record === undefined) throw new Error("expected a gate record");
    fake.repo.records.set("v1.1.0", { ...record, baseTree: treeOf(fake.repo.parentHead) });

    fake.run();

    expect(fake.deps.runGate.mock.calls.length).toBe(1);
  });

  it("runs the gate again on a written release when a file no longer hashes as recorded", () => {
    const fake = writtenRepo();
    const record = fake.repo.records.get("v1.1.0");
    if (record === undefined) throw new Error("expected a gate record");
    fake.repo.records.set("v1.1.0", { ...record, files: { ...record.files, "package.json": sha256Hex("something else") } });

    fake.run();

    expect(fake.deps.runGate.mock.calls.length).toBe(1);
  });

  it("runs the gate again when the record names another gate command", () => {
    const fake = writtenRepo();

    fake.run([], RESUME_FLAGS, { gateCommand: ["bun", "run", "verify:unit"] });

    expect(fake.deps.runGate.mock.calls).toEqual([["/project", ["bun", "run", "verify:unit"]]]);
  });

  it("runs the gate again when the record covers another file set", () => {
    const fake = writtenRepo();
    const record = fake.repo.records.get("v1.1.0");
    if (record === undefined) throw new Error("expected a gate record");
    fake.repo.records.set("v1.1.0", { ...record, files: { ...record.files, "bun.lock": sha256Hex("lock\n") } });

    fake.run();

    expect(fake.deps.runGate.mock.calls.length).toBe(1);
  });

  it("skips the gate on a committed release whose record matches HEAD^ and HEAD's blobs", () => {
    const fake = committedRepo();

    const logs = fake.run();

    expect({ gate: fake.deps.runGate.mock.calls.length, skipped: logs.includes(SKIPPED) }).toEqual({ gate: 0, skipped: true });
  });

  it("runs the gate again on a committed release whose HEAD blob differs from what the gate passed", () => {
    const fake = writtenRepo();
    fake.repo.work["CHANGELOG.md"] = `${fake.repo.work["CHANGELOG.md"]}\n- edited before the host commit`;
    fake.land("chore: release 1.1.0", RELEASE_FILES);

    fake.run();

    expect(fake.deps.runGate.mock.calls.length).toBe(1);
  });

  it("reopens a committed release whose [V] body was edited after the host commit, and gates the new bytes", () => {
    const fake = committedRepo();
    fake.repo.work["CHANGELOG.md"] = (fake.repo.work["CHANGELOG.md"] ?? "").replace("- a thing", "- a thing\n- edited after the host commit");
    fake.repo.writable = true;

    fake.run();

    expect({ gate: fake.deps.runGate.mock.calls.length, commits: fake.deps.commit.mock.calls }).toEqual({
      gate: 1,
      commits: [["/project", "chore: release 1.1.0", ["CHANGELOG.md", SECTIONS_FILE]]],
    });
  });

  it("runs the gate again on a committed release whose parent is not the record's base", () => {
    const fake = committedRepo();
    fake.repo.parentHead = { ...fake.repo.parentHead, "src/b.ts": "export const b = 1;\n" };

    fake.run();

    expect(fake.deps.runGate.mock.calls.length).toBe(1);
  });

  it("never consults a record on a fresh release", () => {
    const fake = fakeRepo({ writable: false });
    fake.repo.records.set("v1.1.0", {
      version: "1.1.0",
      baseTree: treeOf(fake.repo.head),
      files: {},
      gateCommand: ["bun", "run", "verify"],
      passedAt: "2026-01-01T00:00:00.000Z",
    });

    fake.run();

    expect({ read: fake.deps.readGateRecord.mock.calls.length, gate: fake.deps.runGate.mock.calls.length }).toEqual({ read: 0, gate: 1 });
  });

  it("writes no record when the gate was skipped by a matching one", () => {
    const fake = writtenRepo();

    fake.run();

    expect(fake.deps.writeGateRecord).not.toHaveBeenCalled();
  });

  it("writes no record under --allow-unverified", () => {
    const fake = fakeRepo();

    fake.run([], { ...RESUME_FLAGS, "allow-unverified": true });

    expect({ gate: fake.deps.runGate.mock.calls.length, write: fake.deps.writeGateRecord.mock.calls.length }).toEqual({ gate: 0, write: 0 });
  });

  it("prints a note and still commits and tags when the record cannot be written", () => {
    const fake = fakeRepo();
    fake.deps.writeGateRecord.mockImplementation((): void => {
      throw new Error("EROFS: read-only file system");
    });

    const logs = fake.run();

    expect({ note: logs.filter((line) => line.startsWith("  (could not record")), subject: fake.repo.subject, tags: fake.repo.tags }).toEqual({
      note: ["  (could not record the gate run, so a resumed release runs it again: EROFS: read-only file system)"],
      subject: "chore: release 1.1.0",
      tags: ["v1.0.0", "v1.1.0"],
    });
  });

  it("says nothing was written when the gate fails on a fresh release", () => {
    const fake = fakeRepo();
    fake.deps.runGate.mockImplementation((): GateOutcome => "failed");

    expect(errorFrom(() => fake.run()).message).toBe(
      "`bun run verify` failed, so v1.1.0 was not cut and nothing was written.\n" +
        "Fix what it reported and run the release again, or use --allow-unverified to tag anyway.",
    );
  });

  it("does not claim nothing was written when the gate fails on a written release", () => {
    const fake = writtenRepo();
    fake.repo.records.clear();
    fake.deps.runGate.mockImplementation((): GateOutcome => "failed");

    expect(errorFrom(() => fake.run()).message).toBe(
      "`bun run verify` failed, so v1.1.0 was not cut.\n" +
        "Fix what it reported and run the release again, or use --allow-unverified to tag anyway.",
    );
  });

  it("resumes a release whose tag failed after the commit, tagging it without running the gate again", () => {
    const fake = fakeRepo();
    let attempts = 0;
    fake.deps.createTag.mockImplementation((_cwd: string, tag: string): void => {
      attempts += 1;
      if (attempts === 1) throw new Error("fatal: cannot lock ref");
      fake.repo.tags.push(tag);
    });
    outcomeOf(() => fake.run());

    fake.run();

    expect({ gate: fake.deps.runGate.mock.calls.length, commit: fake.deps.commit.mock.calls.length, tags: fake.repo.tags }).toEqual({
      gate: 1,
      commit: 1,
      tags: ["v1.0.0", "v1.1.0"],
    });
  });
});

function chmodDeniesWrites(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "forge-release-probe-"));
  try {
    chmodSync(dir, 0o555);
    writeFileSync(join(dir, "probe"), "");
    return false;
  } catch {
    return true;
  } finally {
    chmodSync(dir, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
}

const CHMOD_DENIES = chmodDeniesWrites();

describe("createReleaseCommand() — tagging the pushed release commit from the clone", () => {
  const SKIPPED = "\n`bun run verify` already passed on these v1.1.0 files — not running it again.";
  const PUSH_IT =
    "Push it to main through the repository's push flow (in an agent clone, the `merge` skill), keeping its subject, then run `bun run release` here again.";
  const COMMITTED_AWAITING = ['\nCommitted "chore: release 1.1.0" here; v1.1.0 is cut once it reaches main.', PUSH_IT];
  const NOT_REACHED = ["\nThe release commit has not reached main yet, so v1.1.0 was not cut.", PUSH_IT];
  const OTHER_TREE = "9".repeat(40);

  function tagAndPushCalls(deps: MockDeps) {
    return { createTag: deps.createTag.mock.calls, pushTag: deps.pushTag.mock.calls, gate: deps.runGate.mock.calls.length };
  }

  function committedHere() {
    const fake = fakeRepo();
    fake.run([], RESUME_FLAGS, PUSHED);
    fake.clear();
    return fake;
  }

  function publish(fake: ReturnType<typeof fakeRepo>, tip: CommitSummary): void {
    fake.repo.published = [tip, ...(fake.repo.published ?? [])];
  }

  it("commits a fresh release, cuts no tag, fetches nothing, and prints what it waits on", () => {
    const fake = fakeRepo();

    const logs = fake.run([], RESUME_FLAGS, PUSHED);

    expect({
      commits: fake.deps.commit.mock.calls,
      fetch: fake.deps.fetchRemote.mock.calls.length,
      ...tagAndPushCalls(fake.deps),
      tail: logs.slice(-2),
    }).toEqual({
      commits: [["/project", "chore: release 1.1.0", RELEASE_FILES]],
      fetch: 0,
      createTag: [],
      pushTag: [],
      gate: 1,
      tail: COMMITTED_AWAITING,
    });
  });

  it("fetches once on the unpushed release commit, skips the gate, and says the commit has not reached main", () => {
    const fake = committedHere();

    const logs = fake.run([], RESUME_FLAGS, PUSHED);

    expect({
      fetch: fake.deps.fetchRemote.mock.calls,
      read: fake.deps.commitSummary.mock.calls,
      searched: fake.deps.commitWithSubject.mock.calls,
      ...tagAndPushCalls(fake.deps),
      commit: fake.deps.commit.mock.calls.length,
      tail: logs.slice(-2),
    }).toEqual({
      fetch: [["/project"]],
      read: [["/project", "refs/remotes/origin/main"]],
      searched: [["/project", "refs/remotes/origin/main", "chore: release 1.1.0", "v1.0.0"]],
      createTag: [],
      pushTag: [],
      gate: 0,
      commit: 0,
      tail: NOT_REACHED,
    });
  });

  it("tags the pushed tip once the squashed release commit is on main, then pushes only that tag", () => {
    const fake = committedHere();
    fake.push();

    const logs = fake.run([], RESUME_FLAGS, PUSHED);

    expect({ ...tagAndPushCalls(fake.deps), pushed: fake.repo.pushed, skipped: logs.includes(SKIPPED), tail: logs.slice(-2) }).toEqual({
      createTag: [["/project", "v1.1.0", "3".repeat(40)]],
      pushTag: [["/project", "v1.1.0"]],
      gate: 0,
      pushed: ["v1.1.0"],
      skipped: true,
      tail: ["\nTagged main's tip 33333333 as v1.1.0 and pushed the tag. Publish from the host:", "  git push && git push --tags"],
    });
  });

  for (const branch of ["task/x", null]) {
    it(`tags the tip of main, never the stale HEAD, from ${branch === null ? "a detached HEAD" : branch} under --allow-branch`, () => {
      const fake = fakeRepo();
      fake.deps.currentBranch.mockImplementation((_cwd: string): string | null => branch);
      const flags = { ...RESUME_FLAGS, "allow-branch": true };
      fake.run([], flags, PUSHED);
      publish(fake, { commit: "f".repeat(40), tree: treeOf(fake.repo.head), subject: "chore: release 1.1.0" });
      fake.clear();

      const logs = fake.run([], flags, PUSHED);

      expect({
        head: fake.repo.headSha,
        ...tagAndPushCalls(fake.deps),
        namesTaskBranch: logs.some((line) => line.includes("task/x")),
        tail: logs.slice(-2),
      }).toEqual({
        head: "2".repeat(40),
        createTag: [["/project", "v1.1.0", "f".repeat(40)]],
        pushTag: [["/project", "v1.1.0"]],
        gate: 0,
        namesTaskBranch: false,
        tail: ["\nTagged main's tip ffffffff as v1.1.0 and pushed the tag. Publish from the host:", "  git push && git push --tags"],
      });
    });
  }

  const mismatches: { name: string; tip: (fake: ReturnType<typeof fakeRepo>) => void; message: string }[] = [
    {
      name: "the release subject over a tree the gate never passed",
      tip: (fake) => publish(fake, { commit: "a".repeat(40), tree: OTHER_TREE, subject: "chore: release 1.1.0" }),
      message:
        "main's tip aaaaaaaa is the 1.1.0 release commit over a tree the gate never passed here, so v1.1.0 was not cut.\n" +
        "The push carried other work into it. Run the release again on that tip (`git switch main && git merge --ff-only origin/main`): it gates the pushed tree before tagging it.",
    },
    {
      name: "the gated tree under another subject",
      tip: (fake) => publish(fake, { commit: "a".repeat(40), tree: treeOf(fake.repo.head), subject: "feat: release it" }),
      message:
        'main\'s tip aaaaaaaa carries the gated tree under "feat: release it" rather than "chore: release 1.1.0", so v1.1.0 was not cut.\n' +
        "The release commit is recognised by its subject, and a pushed commit cannot be reworded: check the tip and tag it on the host by hand.",
    },
    {
      name: "a branch that moved past the release commit",
      tip: (fake) => {
        fake.push();
        publish(fake, { commit: "c".repeat(40), tree: OTHER_TREE, subject: "fix: later" });
      },
      message:
        'main has moved past the 1.1.0 release commit 33333333, and its tip cccccccc is "fix: later", so v1.1.0 was not cut.\n' +
        "Only a tip that is the release commit is tagged here: check 33333333 and tag it on the host by hand.",
    },
  ];

  for (const { name, tip, message } of mismatches) {
    it(`refuses ${name} as publishing-mismatch, before the gate, any write, the tag and the push`, () => {
      const fake = committedHere();
      tip(fake);

      const err = errorFrom(() => fake.run([], RESUME_FLAGS, PUSHED));

      expect({
        kind: err.kind,
        message: err.message,
        writes: writesBy(fake.deps),
        commit: fake.deps.commit.mock.calls.length,
        ...tagAndPushCalls(fake.deps),
      }).toEqual({ kind: "publishing-mismatch", message, writes: 0, commit: 0, createTag: [], pushTag: [], gate: 0 });
    });
  }

  it("quotes a publishing branch the shell would expand in the command a mismatch prints", () => {
    const fake = fakeRepo();
    fake.deps.currentBranch.mockImplementation((_cwd: string): string | null => "rel$ease");
    fake.deps.defaultBranch.mockImplementation((_cwd: string): string | null => "rel$ease");
    fake.run([], RESUME_FLAGS, PUSHED);
    fake.deps.commitSummary.mockImplementation((_cwd: string, ref: string): CommitSummary | null =>
      ref === "refs/remotes/origin/rel$ease" ? { commit: "a".repeat(40), tree: OTHER_TREE, subject: "chore: release 1.1.0" } : null,
    );

    const err = errorFrom(() => fake.run([], RESUME_FLAGS, PUSHED));

    expect(err.message.split("\n")[1]).toBe(
      "The push carried other work into it. Run the release again on that tip (`git switch 'rel$ease' && git merge --ff-only origin/'rel$ease'`): it gates the pushed tree before tagging it.",
    );
  });

  it("refuses as wrong-branch when origin/main does not exist after the fetch", () => {
    const fake = committedHere();
    fake.repo.published = null;

    const err = errorFrom(() => fake.run([], RESUME_FLAGS, PUSHED));

    expect({ kind: err.kind, message: err.message, ...tagAndPushCalls(fake.deps) }).toEqual({
      kind: "wrong-branch",
      message:
        "The remote publishes from main, but origin/main does not exist after the fetch, so v1.1.0 was not cut.\n" +
        "Set the publishing branch with `git remote set-head origin --auto`, then release again.",
      createTag: [],
      pushTag: [],
      gate: 0,
    });
  });

  it("refuses as git-error when the fetch fails, reading nothing it would have fetched", () => {
    const fake = committedHere();
    fake.deps.fetchRemote.mockImplementation((_cwd: string): void => {
      throw new ReleaseError("git-error", "git fetch failed: Could not resolve host: x");
    });

    const err = errorFrom(() => fake.run([], RESUME_FLAGS, PUSHED));

    expect({ kind: err.kind, message: err.message, read: fake.deps.commitSummary.mock.calls.length, ...tagAndPushCalls(fake.deps) }).toEqual({
      kind: "git-error",
      message: "Could not fetch origin, so v1.1.0 was not cut: git fetch failed: Could not resolve host: x",
      read: 0,
      createTag: [],
      pushTag: [],
      gate: 0,
    });
  });

  it("deletes the local tag again when the server refuses the tag push, and a later run tags and pushes it", () => {
    const fake = committedHere();
    fake.push();
    fake.repo.pushRefuses = true;

    const err = errorFrom(() => fake.run([], RESUME_FLAGS, PUSHED));
    const afterRefusal = { tags: [...fake.repo.tags], deleted: fake.deps.deleteTag.mock.calls };
    fake.repo.pushRefuses = false;
    fake.run([], RESUME_FLAGS, PUSHED);

    expect({
      kind: err.kind,
      message: err.message,
      afterRefusal,
      createTag: fake.deps.createTag.mock.calls,
      pushTag: fake.deps.pushTag.mock.calls,
      pushed: fake.repo.pushed,
    }).toEqual({
      kind: "tag-push-failed",
      message:
        "Tagged 33333333 as v1.1.0, but pushing the tag to origin failed: git push failed: ! [remote rejected] v1.1.0 -> v1.1.0 (pre-receive hook declined)\n" +
        "The local v1.1.0 is deleted again. Run the release again once the server accepts it: it checks main's tip before tagging.",
      afterRefusal: { tags: ["v1.0.0"], deleted: [["/project", "v1.1.0"]] },
      createTag: [
        ["/project", "v1.1.0", "3".repeat(40)],
        ["/project", "v1.1.0", "3".repeat(40)],
      ],
      pushTag: [
        ["/project", "v1.1.0"],
        ["/project", "v1.1.0"],
      ],
      pushed: ["v1.1.0"],
    });
  });

  it("names `git tag -d` when deleting the refused tag fails too, leaving the tag in place", () => {
    const fake = committedHere();
    fake.push();
    fake.repo.pushRefuses = true;
    fake.deps.deleteTag.mockImplementation((_cwd: string, _tag: string): void => {
      throw new Error("cannot lock ref 'refs/tags/v1.1.0'");
    });

    const err = errorFrom(() => fake.run([], RESUME_FLAGS, PUSHED));

    expect({ kind: err.kind, undo: err.message.split("\n").slice(1), tags: fake.repo.tags }).toEqual({
      kind: "tag-push-failed",
      undo: ["Deleting the local v1.1.0 failed too: cannot lock ref 'refs/tags/v1.1.0'", "Run `git tag -d v1.1.0`, then release again."],
      tags: ["v1.0.0", "v1.1.0"],
    });
  });

  const alreadyTagged: { name: string; arrange: (fake: ReturnType<typeof fakeRepo>) => void; logs: string[] }[] = [
    { name: "a release in sync with its tag", arrange: (fake) => fake.repo.tags.push("v1.1.0"), logs: ["Already at 1.1.0 — nothing to release."] },
    {
      name: "a tag that already exists",
      arrange: (fake) => fake.deps.tagExists.mockImplementation((_cwd: string, tag: string): boolean => tag === "v1.1.0"),
      logs: ["\nTag v1.1.0 already exists — nothing to release."],
    },
  ];

  for (const { name, arrange, logs: expected } of alreadyTagged) {
    it(`reports ${name}, on the remote too, as done without fetching or pushing`, () => {
      const fake = committedHere();
      fake.push();
      arrange(fake);
      fake.repo.remote = ["v1.0.0", "v1.1.0"];

      const logs = fake.run([], RESUME_FLAGS, PUSHED);

      expect({ logs, fetch: fake.deps.fetchRemote.mock.calls.length, ...tagAndPushCalls(fake.deps) }).toEqual({
        logs: expected,
        fetch: 0,
        createTag: [],
        pushTag: [],
        gate: 0,
      });
    });
  }

  it("asks for `git tag -d` rather than `git push --tags` when the tag is here but not on the remote", () => {
    const fake = committedHere();
    fake.repo.tags.push("v1.1.0");

    const logs = fake.run([], RESUME_FLAGS, PUSHED);

    expect({ logs, pushTag: fake.deps.pushTag.mock.calls.length, fetch: fake.deps.fetchRemote.mock.calls.length }).toEqual({
      logs: [
        "Already at 1.1.0 — nothing to release.",
        "v1.1.0 is tagged here but not on the remote. Delete it with `git tag -d v1.1.0` and run `bun run release` again: it checks the publishing branch's tip, tags it and pushes the tag.",
      ],
      pushTag: 0,
      fetch: 0,
    });
  });

  for (const dry of [false, true]) {
    it(`asks for a fetch when the remote carries the tag the clone lacks${dry ? ", under --dry" : ""}`, () => {
      const fake = fakeRepo();
      fake.repo.remote = ["v1.0.0", "v1.1.0"];

      const logs = fake.run([], { ...RESUME_FLAGS, dry }, PUSHED);

      expect({
        logs,
        gate: fake.deps.runGate.mock.calls.length,
        writes: writesBy(fake.deps),
        calls: releaseCalls(fake.deps),
        fetch: fake.deps.fetchRemote.mock.calls.length,
        pushTag: fake.deps.pushTag.mock.calls.length,
      }).toEqual({
        logs: ["\nv1.1.0 is already on the remote. Run `git fetch --tags` and `bun run release` here to confirm."],
        gate: 0,
        writes: 0,
        calls: { updatePackageVersion: 0, writeChangelog: 0, commit: 0, createTag: 0 },
        fetch: 0,
        pushTag: 0,
      });
    });
  }

  it("matches the tree alone when the release files were committed under another subject, tagging a tip that carries it", () => {
    const fake = writtenRepo();
    fake.land("chore: bump", RELEASE_FILES);
    fake.repo.writable = true;
    publish(fake, { commit: "d".repeat(40), tree: treeOf(fake.repo.head), subject: "chore: bump" });

    const logs = fake.run([], RESUME_FLAGS, PUSHED);

    expect({
      commit: fake.deps.commit.mock.calls.length,
      createTag: fake.deps.createTag.mock.calls,
      pushTag: fake.deps.pushTag.mock.calls,
      tail: logs.slice(-2),
    }).toEqual({
      commit: 0,
      createTag: [["/project", "v1.1.0", "d".repeat(40)]],
      pushTag: [["/project", "v1.1.0"]],
      tail: ["\nTagged main's tip dddddddd as v1.1.0 and pushed the tag. Publish from the host:", "  git push && git push --tags"],
    });
  });

  it("waits on the push when the release files were committed under another subject and main carries another tree", () => {
    const fake = writtenRepo();
    fake.land("chore: bump", RELEASE_FILES);
    fake.repo.writable = true;

    const logs = fake.run([], RESUME_FLAGS, PUSHED);

    expect({ ...tagAndPushCalls(fake.deps), searched: fake.deps.commitWithSubject.mock.calls.length, tail: logs.slice(-2) }).toEqual({
      createTag: [],
      pushTag: [],
      gate: 0,
      searched: 0,
      tail: NOT_REACHED,
    });
  });

  it("refuses a remote that names no publishing branch before the gate, every write and the fetch, even under --allow-branch", () => {
    const fake = fakeRepo();
    fake.deps.defaultBranch.mockImplementation((_cwd: string): string | null => null);

    const err = errorFrom(() => fake.run([], { ...RESUME_FLAGS, "allow-branch": true }, PUSHED));

    expect({
      kind: err.kind,
      message: err.message,
      gate: fake.deps.runGate.mock.calls.length,
      writes: writesBy(fake.deps),
      calls: releaseCalls(fake.deps),
      fetch: fake.deps.fetchRemote.mock.calls.length,
    }).toEqual({
      kind: "wrong-branch",
      message:
        'The remote names no publishing branch, and with `tagOn: "pushed"` the tag goes on the tip of the branch the release commit is pushed to, so there is none to check.\n' +
        "Set it with `git remote set-head origin --auto`, then release again.",
      gate: 0,
      writes: 0,
      calls: { updatePackageVersion: 0, writeChangelog: 0, commit: 0, createTag: 0 },
      fetch: 0,
    });
  });

  it("keeps the read-only host steps when .git is read-only, fetching nothing", () => {
    const fake = fakeRepo({ writable: false });

    const logs = fake.run([], RESUME_FLAGS, PUSHED);

    expect({
      steps: hostStepsIn(logs),
      row: logs.includes("  commit:    on the host (.git is read-only)"),
      fetch: fake.deps.fetchRemote.mock.calls.length,
      read: fake.deps.commitSummary.mock.calls.length,
      pushTag: fake.deps.pushTag.mock.calls.length,
    }).toEqual({ steps: hostSteps(fake, RELEASE_FILES), row: true, fetch: 0, read: 0, pushTag: 0 });
  });

  it("names the pushed tag in the commit row of a dry run, writing and fetching nothing", () => {
    const fake = fakeRepo();

    const logs = fake.run([], { ...RESUME_FLAGS, dry: true }, PUSHED);

    expect({
      row: logs.includes("  commit:    here; tagged once pushed to the publishing branch"),
      writes: writesBy(fake.deps),
      fetch: fake.deps.fetchRemote.mock.calls.length,
    }).toEqual({ row: true, writes: 0, fetch: 0 });
  });

  const gateCases: { name: string; parentChanged: boolean; gate: number }[] = [
    { name: "skips the gate after a squash that gave the release commit's parent a new sha over the same tree", parentChanged: false, gate: 0 },
    { name: "runs the gate again when the squash moved the release commit onto a parent with other content", parentChanged: true, gate: 1 },
  ];

  for (const { name, parentChanged, gate } of gateCases) {
    it(`${name}, then tags the tip carrying HEAD's tree`, () => {
      const fake = committedHere();
      fake.squash("e".repeat(40));
      if (parentChanged) fake.repo.parentHead = { ...fake.repo.parentHead, "src/b.ts": "export const b = 1;\n" };
      publish(fake, { commit: fake.repo.headSha, tree: treeOf(fake.repo.head), subject: "chore: release 1.1.0" });

      fake.run([], RESUME_FLAGS, PUSHED);

      expect(tagAndPushCalls(fake.deps)).toEqual({ createTag: [["/project", "v1.1.0", "3".repeat(40)]], pushTag: [["/project", "v1.1.0"]], gate });
    });
  }

  it("refuses as gate-failed on a pushed tip whose gate fails, cutting and pushing no tag", () => {
    const fake = committedHere();
    fake.push();
    fake.repo.records.clear();
    fake.deps.runGate.mockImplementation((_cwd: string, _command: readonly string[]): GateOutcome => "failed");

    const kind = outcomeOf(() => fake.run([], RESUME_FLAGS, PUSHED));

    expect({ kind, ...tagAndPushCalls(fake.deps) }).toEqual({ kind: "gate-failed", createTag: [], pushTag: [], gate: 1 });
  });

  it("pushes nothing but the one tag, and prints no `git push origin`, across a whole release", () => {
    const fake = fakeRepo();
    const logs = [
      ...fake.run([], RESUME_FLAGS, PUSHED),
      ...fake.run([], RESUME_FLAGS, PUSHED),
      ...(fake.push(), fake.run([], RESUME_FLAGS, PUSHED)),
      ...fake.run([], RESUME_FLAGS, PUSHED),
    ];

    expect({
      printsPushOrigin: logs.some((line) => line.includes("git push origin")),
      pushTag: fake.deps.pushTag.mock.calls,
      commits: fake.deps.commit.mock.calls.length,
      last: logs.at(-1),
    }).toEqual({ printsPushOrigin: false, pushTag: [["/project", "v1.1.0"]], commits: 1, last: "Already at 1.1.0 — nothing to release." });
  });
});

describe("forge release end to end in a real repository", () => {
  const CHANGELOG = "# Changelog\n\n## [Unreleased]\n\n- a thing\n\n---\n\n## [1.0.0] — 2026-01-01\n\nbody\n";

  function git(root: string, args: string[]): string {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf-8", env: worktreeGitEnv() });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout;
  }

  function sh(root: string, line: string): string {
    const result = spawnSync("sh", ["-c", line], { cwd: root, encoding: "utf-8", env: worktreeGitEnv() });
    if (result.status !== 0) throw new Error(`${line} failed: ${result.stderr}`);
    return result.stdout;
  }

  /** A repository one `feat:` commit past `v1.0.0`, whose gate appends a line to `gateLog` outside it. */
  function releaseRepo({ ignoresForge = true, tagOn = "here" as "here" | "pushed" } = {}): { root: string; gateLog: string; scratch: string } {
    const scratch = mkdtempSync(join(tmpdir(), "forge-release-gate-"));
    const gateLog = join(scratch, "runs");
    writeFileSync(gateLog, "");
    const root = worktreeFixture({
      "package.json": MANIFEST_1_0_0,
      "CHANGELOG.md": CHANGELOG,
      [SECTIONS_FILE]: "{}\n",
      "config/release.config.ts": `export default { gateCommand: ["sh", "-c", "echo ran >> '${gateLog}'"], tagOn: "${tagOn}" };\n`,
      ...(ignoresForge ? { ".gitignore": ".forge/\n" } : {}),
      "src/a.ts": "export {};\n",
    });
    const config = join(root, ".git", "config");
    writeFileSync(config, `${readFileSync(config, "utf-8")}[user]\n\tname = gate\n\temail = gate@fixture.invalid\n[commit]\n\tgpgsign = false\n`);
    git(root, ["tag", "v1.0.0"]);
    writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
    git(root, ["commit", "-q", "-am", "feat: a thing"]);
    return { root, gateLog, scratch };
  }

  async function release(root: string): Promise<string[]> {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      await createReleaseBinCommand().run?.([], { ...RESUME_FLAGS, root, config: undefined });
    } finally {
      console.log = origLog;
    }
    return logs;
  }

  const lock = (root: string): void => chmodSync(join(root, ".git"), 0o555);
  const unlock = (root: string): void => chmodSync(join(root, ".git"), 0o755);

  function releaseHeadings(source: string): string[] {
    return source.split("\n").filter((line) => line.startsWith("## [1.0.1]"));
  }

  function snapshot(root: string, gateLog: string) {
    const work = readFileSync(join(root, "CHANGELOG.md"), "utf-8");
    return {
      workHeadings: releaseHeadings(work).length,
      headHeadings: releaseHeadings(git(root, ["show", "HEAD:CHANGELOG.md"])).length,
      version: JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).version,
      tagged: git(root, ["tag", "--list", "v1.0.1"]).trim() === "v1.0.1",
      gateRuns: readFileSync(gateLog, "utf-8").split("\n").filter(Boolean).length,
    };
  }

  function cleanup(fixture: { root: string; scratch: string }): void {
    unlock(fixture.root);
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(fixture.scratch, { recursive: true, force: true });
  }

  /** A pushed-mode fixture whose origin is a bare repository in `scratch`, holding main and v1.0.0, with origin/HEAD set. */
  function pushedRepo(): { root: string; gateLog: string; scratch: string; bare: string } {
    const fixture = releaseRepo({ tagOn: "pushed" });
    const bare = join(fixture.scratch, "origin.git");
    git(fixture.root, ["branch", "-M", "main"]);
    git(fixture.scratch, ["init", "--bare", "-q", bare]);
    git(fixture.root, ["remote", "add", "origin", bare]);
    git(fixture.root, ["push", "-q", "origin", "main", "v1.0.0"]);
    git(fixture.root, ["fetch", "-q", "origin"]);
    git(fixture.root, ["remote", "set-head", "origin", "main"]);
    return { ...fixture, bare };
  }

  it("under tagOn pushed: commits, waits on the push, then tags the pushed tip and pushes only the tag to origin", async () => {
    const fixture = pushedRepo();
    const { root, gateLog, bare } = fixture;
    const bareTag = (): string => git(bare, ["tag", "--list", "v1.0.1"]).trim();
    try {
      const committed = (await release(root)).slice(-2);
      const afterCommit = { bareTag: bareTag(), subject: git(root, ["log", "-1", "--format=%s"]).trim() };
      const unpushed = (await release(root)).slice(-2);
      git(root, ["push", "-q", "origin", "main"]);
      const tagged = (await release(root)).slice(-2);
      const bareMain = git(bare, ["rev-parse", "main"]).trim();
      const afterTag = { bareTagged: git(bare, ["rev-parse", "refs/tags/v1.0.1^{commit}"]).trim(), bareMain, state: snapshot(root, gateLog) };
      const done = await release(root);

      const pushLine =
        "Push it to main through the repository's push flow (in an agent clone, the `merge` skill), keeping its subject, then run `bun run release` here again.";
      expect({ committed, afterCommit, unpushed, tagged, afterTag, done }).toEqual({
        committed: ['\nCommitted "chore: release 1.0.1" here; v1.0.1 is cut once it reaches main.', pushLine],
        afterCommit: { bareTag: "", subject: "chore: release 1.0.1" },
        unpushed: ["\nThe release commit has not reached main yet, so v1.0.1 was not cut.", pushLine],
        tagged: [
          `\nTagged main's tip ${bareMain.slice(0, 8)} as v1.0.1 and pushed the tag. Publish from the host:`,
          "  git push && git push --tags",
        ],
        afterTag: { bareTagged: bareMain, bareMain, state: { workHeadings: 1, headHeadings: 1, version: "1.0.1", tagged: true, gateRuns: 1 } },
        done: ["Already at 1.0.1 — nothing to release."],
      });
    } finally {
      cleanup(fixture);
    }
  });

  it("commits and tags once with a writable .git, and a rerun finds it already released", async () => {
    const fixture = releaseRepo();
    try {
      await release(fixture.root);
      const rerun = await release(fixture.root);

      expect({ rerun, state: snapshot(fixture.root, fixture.gateLog) }).toEqual({
        rerun: ["  (remote unreachable — could not confirm v1.0.1 is pushed)", "Already at 1.0.1 — nothing to release."],
        state: { workHeadings: 1, headHeadings: 1, version: "1.0.1", tagged: true, gateRuns: 1 },
      });
    } finally {
      cleanup(fixture);
    }
  });

  it.skipIf(!CHMOD_DENIES)("with .git read-only: writes once, then resumes through the host's commit and tag without writing again", async () => {
    const fixture = releaseRepo();
    const { root, gateLog } = fixture;
    try {
      const before = git(root, ["rev-parse", "HEAD"]).trim();
      lock(root);

      const first = hostStepsIn(await release(root));
      const afterFirst = { ...snapshot(root, gateLog), head: git(root, ["rev-parse", "HEAD"]).trim() };

      const written = hostStepsIn(await release(root));
      const afterWritten = snapshot(root, gateLog);

      unlock(root);
      const verify = (written[1] ?? "").trim();
      const commitLine = (written[2] ?? "").trim();
      const [check, expected] = verify.split("   # expect ");
      const ids = sh(root, check ?? "")
        .trim()
        .split("\n")
        .join(" ");
      sh(root, commitLine);
      lock(root);
      const committed = hostStepsIn(await release(root));
      const afterCommitted = snapshot(root, gateLog);

      unlock(root);
      sh(root, (committed[1] ?? "").trim());
      lock(root);
      const tagged = await release(root);

      expect({
        first: { steps: first.length, ...afterFirst },
        rerunPrintsTheSameSteps: written,
        ids,
        afterWritten,
        committed,
        afterCommitted,
        tagged,
        final: snapshot(root, gateLog),
      }).toEqual({
        first: { steps: 6, workHeadings: 1, headHeadings: 0, version: "1.0.1", tagged: false, gateRuns: 1, head: before },
        rerunPrintsTheSameSteps: first,
        ids: expected,
        afterWritten: { workHeadings: 1, headHeadings: 0, version: "1.0.1", tagged: false, gateRuns: 1 },
        committed: [
          "\n.git is read-only here, so tag v1.0.1 on the host:",
          "  git tag v1.0.1",
          "  git push && git push --tags",
          "Then run `bun run release` here to confirm.",
        ],
        afterCommitted: { workHeadings: 1, headHeadings: 1, version: "1.0.1", tagged: false, gateRuns: 1 },
        tagged: ["  (remote unreachable — could not confirm v1.0.1 is pushed)", "Already at 1.0.1 — nothing to release."],
        final: { workHeadings: 1, headHeadings: 1, version: "1.0.1", tagged: true, gateRuns: 1 },
      });
    } finally {
      cleanup(fixture);
    }
  });

  // `.forge/` is ignored only where warden's MUST_IGNORE reached the repository, so a consumer's
  // gate record is an untracked file that a resume must neither count as dirt nor stage.
  it.skipIf(!CHMOD_DENIES)("resumes a written and a committed release when nothing ignores the gate record", async () => {
    const fixture = releaseRepo({ ignoresForge: false });
    const { root, gateLog } = fixture;
    try {
      lock(root);
      const first = hostStepsIn(await release(root));
      const written = hostStepsIn(await release(root));

      unlock(root);
      sh(root, (written[2] ?? "").trim());
      lock(root);
      const committed = hostStepsIn(await release(root));

      unlock(root);
      await release(root);

      expect({
        rerunPrintsTheSameSteps: written,
        committed: committed.length,
        changed: git(root, ["diff", "--name-only", "HEAD^", "HEAD"]).trim().split("\n").sort(),
        untracked: git(root, ["ls-files", "--others", "--exclude-standard"]).trim(),
        final: snapshot(root, gateLog),
      }).toEqual({
        rerunPrintsTheSameSteps: first,
        committed: 4,
        changed: ["CHANGELOG.md", SECTIONS_FILE, "package.json"],
        untracked: ".forge/release/v1.0.1.json",
        final: { workHeadings: 1, headHeadings: 1, version: "1.0.1", tagged: true, gateRuns: 1 },
      });
    } finally {
      cleanup(fixture);
    }
  });

  it.skipIf(!CHMOD_DENIES)("commits and tags a release written under a read-only .git once .git is writable again", async () => {
    const fixture = releaseRepo();
    try {
      lock(fixture.root);
      await release(fixture.root);
      unlock(fixture.root);

      await release(fixture.root);

      expect({
        subject: git(fixture.root, ["log", "-1", "--format=%s"]).trim(),
        changed: git(fixture.root, ["diff", "--name-only", "HEAD^", "HEAD"]).trim().split("\n").sort(),
        state: snapshot(fixture.root, fixture.gateLog),
      }).toEqual({
        subject: "chore: release 1.0.1",
        changed: ["CHANGELOG.md", SECTIONS_FILE, "package.json"],
        state: { workHeadings: 1, headHeadings: 1, version: "1.0.1", tagged: true, gateRuns: 1 },
      });
    } finally {
      cleanup(fixture);
    }
  });

  const LONG_AGO = new Date(2020, 0, 1);

  /** Runs the release a second time and answers which release files it wrote, by stamping each with an old mtime first. */
  async function rewrittenBy(root: string): Promise<string[]> {
    const files = ["package.json", "CHANGELOG.md", SECTIONS_FILE];
    for (const file of files) utimesSync(join(root, file), LONG_AGO, LONG_AGO);
    await release(root);
    return files.filter((file) => statSync(join(root, file)).mtimeMs !== LONG_AGO.getTime());
  }

  /** Runs the host's commit, then its tag, from the steps a read-only run printed. */
  function runHostSteps(root: string, steps: readonly string[]): void {
    unlock(root);
    for (const line of steps.slice(1, -2)) sh(root, line.trim().split("   # expect ")[0] ?? "");
    lock(root);
  }

  function releasedBody(root: string): string[] {
    const head = git(root, ["show", "HEAD:CHANGELOG.md"]);
    const lines = head.split("\n");
    const from = lines.findIndex((line) => line.startsWith("## [1.0.1]"));
    const to = lines.findIndex((line, i) => i > from && line.startsWith("## ["));
    return lines.slice(from + 1, to).filter((line) => line.startsWith("- "));
  }

  it.skipIf(!CHMOD_DENIES)("re-cuts a release after everything was committed and an [Unreleased] entry added, through the host steps", async () => {
    const fixture = releaseRepo();
    const { root, gateLog } = fixture;
    try {
      lock(root);
      await release(root);
      unlock(root);
      writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");
      git(root, ["commit", "-q", "-am", "fix: more work"]);
      const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf-8");
      writeFileSync(join(root, "CHANGELOG.md"), changelog.replace("## [Unreleased]\n\n_Nothing yet._", "## [Unreleased]\n\n- a later thing"));
      lock(root);

      const steps = hostStepsIn(await release(root));
      const rewritten = await rewrittenBy(root);
      const again = hostStepsIn(await release(root));
      runHostSteps(root, steps);
      const tagged = await release(root);

      expect({ files: steps[2], again, rewritten, body: releasedBody(root), tagged, final: snapshot(root, gateLog) }).toEqual({
        files: '  git commit -m "chore: release 1.0.1" -- CHANGELOG.md config/changelog-sections.json',
        again: steps,
        rewritten: [],
        body: ["- a thing", "- a later thing"],
        tagged: ["  (remote unreachable — could not confirm v1.0.1 is pushed)", "Already at 1.0.1 — nothing to release."],
        final: { workHeadings: 1, headHeadings: 1, version: "1.0.1", tagged: true, gateRuns: 2 },
      });
    } finally {
      cleanup(fixture);
    }
  });

  it.skipIf(!CHMOD_DENIES)(
    "re-cuts a release after only code was committed and an entry added to its [V] body, through the host steps",
    async () => {
      const fixture = releaseRepo();
      const { root, gateLog } = fixture;
      try {
        lock(root);
        await release(root);
        unlock(root);
        writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");
        git(root, ["commit", "-q", "-m", "fix: more work", "--", "src/a.ts"]);
        const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf-8");
        writeFileSync(join(root, "CHANGELOG.md"), changelog.replace("- a thing", "- a thing\n- another thing"));
        lock(root);

        const steps = hostStepsIn(await release(root));
        const rewritten = await rewrittenBy(root);
        const again = hostStepsIn(await release(root));
        runHostSteps(root, steps);
        const tagged = await release(root);

        expect({ files: steps[2], again, rewritten, body: releasedBody(root), tagged, final: snapshot(root, gateLog) }).toEqual({
          files: '  git commit -m "chore: release 1.0.1" -- package.json CHANGELOG.md config/changelog-sections.json',
          again: steps,
          rewritten: [],
          body: ["- a thing", "- another thing"],
          tagged: ["  (remote unreachable — could not confirm v1.0.1 is pushed)", "Already at 1.0.1 — nothing to release."],
          final: { workHeadings: 1, headHeadings: 1, version: "1.0.1", tagged: true, gateRuns: 2 },
        });
      } finally {
        cleanup(fixture);
      }
    },
  );
});

const LATER_DAY = new Date(2026, 2, 9);

type Workflow = "commit-all" | "commit-code-only" | "unreleased-entry" | "v-body-entry" | "edit-after-host-commit";

/** A read-only release written on 2026-02-03, then moved on by the user the way `workflow` names, with the clock on a later day. */
function afterWorkflow(workflow: Workflow) {
  const fake = writtenRepo();
  const changelog = (): string => fake.repo.work["CHANGELOG.md"] ?? "";
  if (workflow === "commit-all") {
    fake.repo.work["src/a.ts"] = "export const a = 2;\n";
    fake.land("fix: more work", [...RELEASE_FILES, "src/a.ts"]);
  }
  if (workflow === "commit-code-only") {
    fake.repo.work["src/a.ts"] = "export const a = 2;\n";
    fake.land("fix: more work", ["src/a.ts"]);
  }
  if (workflow === "unreleased-entry")
    fake.repo.work["CHANGELOG.md"] = changelog().replace("## [Unreleased]\n\n_Nothing yet._", "## [Unreleased]\n\n- a later thing");
  if (workflow === "v-body-entry") fake.repo.work["CHANGELOG.md"] = changelog().replace("- a thing", "- a thing\n- another thing");
  if (workflow === "edit-after-host-commit") {
    fake.land("chore: release 1.1.0", RELEASE_FILES);
    fake.repo.work["CHANGELOG.md"] = changelog().replace("- a thing", "- a thing\n- an edit");
  }
  fake.repo.today = LATER_DAY;
  return fake;
}

function releaseSection(changelog: string): { headings: string[]; entries: string[] } {
  const lines = changelog.split("\n");
  const headings = lines.filter((line) => line.startsWith("## [1.1.0]"));
  const from = lines.findIndex((line) => line.startsWith("## [1.1.0]"));
  const to = lines.findIndex((line, i) => i > from && line.startsWith("## ["));
  return { headings, entries: lines.slice(from + 1, to).filter((line) => line.startsWith("- ")) };
}

function writesBy(deps: MockDeps): number {
  return deps.updatePackageVersion.mock.calls.length + deps.writeChangelog.mock.calls.length + deps.writeChangelogSections.mock.calls.length;
}

function hostSteps(fake: ReturnType<typeof fakeRepo>, files: readonly string[]): string[] {
  const head = fake.repo.headSha;
  const tail = ["  git push && git push --tags", "Then run `bun run release` here to confirm."];
  if (files.length === 0)
    return ["\n.git is read-only here, so tag v1.1.0 on the host:", `  test "$(git rev-parse HEAD)" = ${head} && git tag v1.1.0`, ...tail];
  const ids = gitBlobIds(files.map((path) => fake.repo.work[path] ?? ""));
  return [
    "\n.git is read-only here, so commit and tag v1.1.0 on the host:",
    `  test "$(git rev-parse HEAD)" = ${head} && git hash-object ${files.join(" ")}   # expect ${ids}`,
    `  git commit -m "chore: release 1.1.0" -- ${files.join(" ")}`,
    "  git tag v1.1.0",
    ...tail,
  ];
}

describe("createReleaseCommand() — re-cutting an open release after the user moved on", () => {
  const cases: { workflow: Workflow; commits: string[]; date: string; entries: string[] }[] = [
    { workflow: "commit-all", commits: [], date: "2026-02-03", entries: ["- a thing"] },
    { workflow: "commit-code-only", commits: RELEASE_FILES, date: "2026-02-03", entries: ["- a thing"] },
    { workflow: "unreleased-entry", commits: RELEASE_FILES, date: "2026-03-09", entries: ["- a thing", "- a later thing"] },
    { workflow: "v-body-entry", commits: RELEASE_FILES, date: "2026-03-09", entries: ["- a thing", "- another thing"] },
    { workflow: "edit-after-host-commit", commits: ["CHANGELOG.md", SECTIONS_FILE], date: "2026-03-09", entries: ["- a thing", "- an edit"] },
  ];

  for (const { workflow, commits, date, entries } of cases) {
    it(`${workflow}, .git read-only: one dated [1.1.0] holding every entry, the exact host steps, and no write on the identical rerun`, () => {
      const fake = afterWorkflow(workflow);
      fake.repo.writable = false;

      const first = hostStepsIn(fake.run());
      const expected = hostSteps(fake, commits);
      fake.clear();
      const second = hostStepsIn(fake.run());

      expect({ first, second, writes: writesBy(fake.deps), section: releaseSection(fake.repo.work["CHANGELOG.md"] ?? "") }).toEqual({
        first: expected,
        second: expected,
        writes: 0,
        section: { headings: [`## [1.1.0] — ${date}`], entries },
      });
    });

    it(`${workflow}, .git writable: commits only what differs from HEAD, tags once, and the rerun writes nothing`, () => {
      const fake = afterWorkflow(workflow);
      fake.repo.writable = true;

      fake.run();
      const commitCalls = fake.deps.commit.mock.calls.map((call) => call[2]);
      fake.clear();
      const rerun = fake.run();

      expect({
        commitCalls,
        tags: fake.repo.tags,
        rerun,
        writes: writesBy(fake.deps),
        section: releaseSection(fake.repo.head["CHANGELOG.md"] ?? ""),
      }).toEqual({
        commitCalls: commits.length === 0 ? [] : [commits],
        tags: ["v1.0.0", "v1.1.0"],
        rerun: ["Already at 1.1.0 — nothing to release.", "v1.1.0 is not on the remote yet. Push it:\n  git push --tags"],
        writes: 0,
        section: { headings: [`## [1.1.0] — ${date}`], entries },
      });
    });
  }

  it("writes the changelog and its manifest, never package.json, for an entry added after the write", () => {
    const fake = afterWorkflow("unreleased-entry");

    fake.run();

    expect({
      pkg: fake.deps.updatePackageVersion.mock.calls.length,
      changelog: fake.deps.writeChangelog.mock.calls.length,
      sections: fake.repo.work[SECTIONS_FILE],
    }).toEqual({ pkg: 0, changelog: 1, sections: changelogSectionsSource(fake.repo.work["CHANGELOG.md"] ?? "") });
  });

  it("names on the changelog row the files this run rewrites", () => {
    expect(afterWorkflow("unreleased-entry").run([], { ...RESUME_FLAGS, dry: true })[3]).toBe(
      "  changelog: [1.1.0] — 2026-03-09  (rewrites CHANGELOG.md, config/changelog-sections.json)",
    );
  });

  it("names a run that rewrites only the sections manifest, rather than calling the release already written", () => {
    const fake = writtenRepo();
    fake.repo.work[SECTIONS_FILE] = "{}\n";

    expect(fake.run([], { ...RESUME_FLAGS, dry: true })[3]).toBe("  changelog: [1.1.0] — 2026-02-03  (rewrites config/changelog-sections.json)");
  });
});

describe("createReleaseCommand() — the re-dating rule", () => {
  it("keeps [V]'s date on a pure resume, however late the rerun", () => {
    const fake = writtenRepo();
    fake.repo.today = new Date(2027, 5, 1);

    fake.run();

    expect({ writes: writesBy(fake.deps), section: releaseSection(fake.repo.work["CHANGELOG.md"] ?? "").headings }).toEqual({
      writes: 0,
      section: ["## [1.1.0] — 2026-02-03"],
    });
  });

  it("takes now() for [V] once its content changed", () => {
    const fake = afterWorkflow("unreleased-entry");

    fake.run();

    expect(releaseSection(fake.repo.work["CHANGELOG.md"] ?? "").headings).toEqual(["## [1.1.0] — 2026-03-09"]);
  });

  it("keeps a re-dated [V] on the rerun after the content change, rather than re-dating again", () => {
    const fake = afterWorkflow("unreleased-entry");
    fake.run();
    fake.repo.today = new Date(2026, 3, 20);
    fake.clear();

    fake.run();

    expect({ writes: writesBy(fake.deps), headings: releaseSection(fake.repo.work["CHANGELOG.md"] ?? "").headings }).toEqual({
      writes: 0,
      headings: ["## [1.1.0] — 2026-03-09"],
    });
  });

  it("takes now() for an entry written into [V]'s own body, which the sections manifest no longer records", () => {
    const fake = afterWorkflow("v-body-entry");

    fake.run();

    expect(releaseSection(fake.repo.work["CHANGELOG.md"] ?? "")).toEqual({
      headings: ["## [1.1.0] — 2026-03-09"],
      entries: ["- a thing", "- another thing"],
    });
  });

  it("re-dates a release committed on HEAD only when an entry reached its working [Unreleased]", () => {
    const kept = committedRepo();
    kept.repo.today = LATER_DAY;
    const keptRow = kept.run([], { ...RESUME_FLAGS, dry: true })[3];

    const edited = committedRepo();
    edited.repo.today = LATER_DAY;
    edited.repo.work["CHANGELOG.md"] = (edited.repo.work["CHANGELOG.md"] ?? "").replace(
      "## [Unreleased]\n\n_Nothing yet._",
      "## [Unreleased]\n\n- a later thing",
    );
    const editedRow = edited.run([], { ...RESUME_FLAGS, dry: true })[3];

    expect([keptRow, editedRow]).toEqual([
      "  changelog: [1.1.0] — 2026-02-03  (already committed)",
      "  changelog: [1.1.0] — 2026-03-09  (rewrites CHANGELOG.md, config/changelog-sections.json)",
    ]);
  });
});

describe("createReleaseCommand() — what an open release refuses", () => {
  function refusal(fake: ReturnType<typeof fakeRepo>, args: string[] = [], flags = RESUME_FLAGS) {
    const err = errorFrom(() => fake.run(args, flags));
    return {
      kind: err.kind,
      message: err.message,
      writes: writesBy(fake.deps),
      commits: fake.deps.commit.mock.calls.length,
      gate: fake.deps.runGate.mock.calls.length,
    };
  }

  const PKG_BEYOND = {
    kind: "release-partial",
    message:
      "package.json changes more than its version against HEAD, and a release commits only the version.\n" +
      "Commit that change first, or restore it with `git show HEAD:./package.json > package.json`, then release again.",
    writes: 0,
    commits: 0,
    gate: 0,
  };

  it("refuses a written package.json that changes more than its version", () => {
    const fake = writtenRepo();
    fake.repo.work["package.json"] = MANIFEST_1_1_0.replace('"version"', '"private": true,\n  "version"');

    expect(refusal(fake)).toEqual(PKG_BEYOND);
  });

  it("refuses an unbumped package.json that changes more than its version", () => {
    const fake = fakeRepo();
    fake.repo.work["package.json"] = MANIFEST_1_0_0.replace('"version"', '"private": true,\n  "version"');

    expect(refusal(fake)).toEqual(PKG_BEYOND);
  });

  it("refuses a re-dated shipped section, naming it", () => {
    const fake = writtenRepo();
    fake.repo.work["CHANGELOG.md"] = (fake.repo.work["CHANGELOG.md"] ?? "").replace("## [1.0.0] — 2026-01-01", "## [1.0.0] — 2026-01-02");

    expect(refusal(fake)).toEqual({
      kind: "release-partial",
      message:
        "CHANGELOG.md changes [1.0.0] against HEAD, and those sections shipped with their tags, so the release will not carry the edit.\n" +
        "Restore them from HEAD (`git show HEAD:./CHANGELOG.md` prints it, and works with .git read-only), then release again.",
      writes: 0,
      commits: 0,
      gate: 0,
    });
  });

  it("refuses an edit to shipped history even after the host commit", () => {
    const fake = committedRepo();
    fake.repo.work["CHANGELOG.md"] = (fake.repo.work["CHANGELOG.md"] ?? "").replace("body", "body, rewritten");

    expect(outcomeOf(() => fake.run())).toBe("release-partial");
  });

  const finish = "\nFinish 1.1.0 first: run the release again with 1.1.0.";

  const untagged: { detection: string; setup: () => ReturnType<typeof fakeRepo>; message: string }[] = [
    {
      detection: "HEAD is forge's release commit for W",
      setup: () => committedRepo(),
      message: `HEAD is the release commit for 1.1.0, which was never tagged, so 1.2.0 cannot be released on top of it.${finish}`,
    },
    {
      detection: "HEAD's package.json and newest section are W under another subject",
      setup: () => {
        const fake = writtenRepo();
        fake.land("chore: bump", RELEASE_FILES);
        return fake;
      },
      message: `HEAD holds 1.1.0 from a release that was committed and never tagged, so 1.2.0 cannot be released on top of it.${finish}`,
    },
    {
      detection: "the working package.json holds W",
      setup: () => writtenRepo(),
      message: `package.json holds 1.1.0 from a release that was written and never committed, so 1.2.0 cannot be released over it.${finish}`,
    },
    {
      detection: "the working changelog's newest section is W",
      setup: () => {
        const fake = writtenRepo();
        fake.repo.work["package.json"] = MANIFEST_1_0_0;
        return fake;
      },
      message: `CHANGELOG.md holds a [1.1.0] section from a release that was never tagged, so 1.2.0 cannot be released over it.${finish}`,
    },
  ];

  for (const { detection, setup, message } of untagged) {
    it(`refuses 1.2.0 over an untagged 1.1.0 when ${detection}`, () => {
      expect(refusal(setup(), ["1.2.0"])).toEqual({ kind: "version-mismatch", message, writes: 0, commits: 0, gate: 0 });
    });
  }

  it("refuses a release left empty once reopened, unless --allow-empty-changelog", () => {
    const fake = fakeRepo({ head: { "package.json": MANIFEST_1_0_0, "CHANGELOG.md": EMPTY, [SECTIONS_FILE]: "{}\n" }, writable: false });
    fake.run([], { ...RESUME_FLAGS, "allow-empty-changelog": true });
    fake.clear();

    const refused = refusal(fake);
    const allowed = outcomeOf(() => fake.run([], { ...RESUME_FLAGS, "allow-empty-changelog": true }));

    expect({ refused, allowed }).toEqual({
      refused: {
        kind: "changelog-empty",
        message:
          "CHANGELOG.md has an empty [Unreleased] section, but commits exist since v1.0.0. " +
          "Write the entry, or use --allow-empty-changelog for a genuinely entry-free release.",
        writes: 0,
        commits: 0,
        gate: 0,
      },
      allowed: "ok",
    });
  });

  it("refuses a stray path on a re-cut, naming it", () => {
    const fake = afterWorkflow("v-body-entry");
    fake.repo.untracked = ["src/new.ts"];

    expect(refusal(fake)).toEqual({
      kind: "working-tree-dirty",
      message: "Working tree changes src/new.ts, which the 1.1.0 release does not carry. Commit or stash them first, or use --allow-dirty.",
      writes: 0,
      commits: 0,
      gate: 0,
    });
  });

  it("does not count a path the config stages as stray", () => {
    const fake = writtenRepo({ head: { "package.json": MANIFEST_1_0_0, "CHANGELOG.md": WRITTEN, "bun.lock": "lock\n", [SECTIONS_FILE]: "{}\n" } });
    fake.repo.work["bun.lock"] = "lock, updated\n";
    fake.repo.writable = true;

    fake.run([], RESUME_FLAGS, { stageFiles: ["package.json", "CHANGELOG.md", "bun.lock"] });

    expect(fake.deps.commit.mock.calls.map((call) => call[2])).toEqual([["package.json", "CHANGELOG.md", "bun.lock", SECTIONS_FILE]]);
  });

  it("refuses a tree git calls dirty while listing no change, in the generic words", () => {
    const fake = fakeRepo();
    fake.deps.isWorkingTreeClean.mockImplementation(() => false);

    expect(refusal(fake)).toEqual({
      kind: "working-tree-dirty",
      message: "Working tree is not clean. Commit or stash changes first, or use --allow-dirty.",
      writes: 0,
      commits: 0,
      gate: 0,
    });
  });
});

describe("createReleaseCommand() — the gate's place around the write", () => {
  function orderOf(fake: ReturnType<typeof fakeRepo>): string[] {
    const order: string[] = [];
    fake.deps.runGate.mockImplementation((): GateOutcome => {
      order.push("gate");
      return "passed";
    });
    fake.deps.writeChangelog.mockImplementation((_cwd: string, file: string, source: string): void => {
      order.push("write");
      fake.repo.work[file] = source;
    });
    return order;
  }

  it("gates a fresh release before writing it", () => {
    const fake = fakeRepo();
    const order = orderOf(fake);

    fake.run();

    expect(order).toEqual(["gate", "write"]);
  });

  it("writes nothing when the gate fails on a fresh release", () => {
    const fake = fakeRepo();
    const before = { ...fake.repo.work };
    fake.deps.runGate.mockImplementation((): GateOutcome => "failed");

    expect({ outcome: outcomeOf(() => fake.run()), writes: writesBy(fake.deps), work: fake.repo.work }).toEqual({
      outcome: "gate-failed",
      writes: 0,
      work: before,
    });
  });

  it("writes a re-cut before gating it, so the gate runs over the bytes the release commits", () => {
    const fake = afterWorkflow("v-body-entry");
    const seen: (string | undefined)[] = [];
    fake.deps.runGate.mockImplementation((): GateOutcome => {
      seen.push(fake.repo.work["CHANGELOG.md"]);
      return "passed";
    });
    fake.repo.writable = true;

    fake.run();

    expect(seen).toEqual([fake.repo.head["CHANGELOG.md"]]);
  });

  it("leaves a re-cut written when its gate fails, without claiming nothing was written", () => {
    const fake = afterWorkflow("unreleased-entry");
    fake.deps.runGate.mockImplementation((): GateOutcome => "failed");

    const err = errorFrom(() => fake.run());

    expect({ message: err.message, section: releaseSection(fake.repo.work["CHANGELOG.md"] ?? "") }).toEqual({
      message:
        "`bun run verify` failed, so v1.1.0 was not cut.\nFix what it reported and run the release again, or use --allow-unverified to tag anyway.",
      section: { headings: ["## [1.1.0] — 2026-03-09"], entries: ["- a thing", "- a later thing"] },
    });
  });

  it("re-gates a re-cut whose bytes changed on the same HEAD", () => {
    const fake = afterWorkflow("unreleased-entry");

    fake.run();

    expect(fake.deps.runGate.mock.calls.length).toBe(1);
  });

  it("re-gates a resume whose bytes are unchanged on a new HEAD", () => {
    const fake = afterWorkflow("commit-code-only");

    fake.run();

    expect(fake.deps.runGate.mock.calls.length).toBe(1);
  });

  it("skips the gate on the rerun after a re-cut, now that HEAD and the bytes are the ones it passed", () => {
    const fake = afterWorkflow("unreleased-entry");
    fake.run();
    fake.clear();

    fake.run();

    expect(fake.deps.runGate.mock.calls.length).toBe(0);
  });

  it("records a re-cut's gate against HEAD, not HEAD^", () => {
    const fake = afterWorkflow("edit-after-host-commit");

    fake.run();

    expect(fake.repo.records.get("v1.1.0")?.baseTree).toBe(treeOf(fake.repo.head));
  });
});
