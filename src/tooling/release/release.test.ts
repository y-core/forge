import { describe, expect, it, mock } from "bun:test";
import type { Mock } from "bun:test";

import { createReleaseCommand } from "./release";
import { ReleaseError } from "./types";
import type { GateOutcome } from "./types";
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
  tagExists: Mock<(cwd: string, tag: string) => boolean>;
  createTag: Mock<(cwd: string, tag: string) => void>;
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
    writeChangelogSections: mock((_cwd: string, _file: string, _source: string): void => {}),
    readRepositoryUrl: mock((_cwd: string): string | null => "https://x/repo"),
    removedSurfaceSince: mock((_cwd: string, _ref: string): string[] => []),
    tagIsAncestorOfHead: mock((_cwd: string, _tag: string): boolean => true),
    remoteTags: mock((_cwd: string): string[] | null => ["v1.0.0"]),
    currentBranch: mock((_cwd: string): string | null => "main"),
    defaultBranch: mock((_cwd: string): string | null => "main"),
    runGate: mock((_cwd: string, _command: readonly string[]): GateOutcome => "passed"),
    now: mock((): Date => new Date(2026, 1, 3)),
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
    const deps = makeDeps();
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
        "Consumers fetch a codeload tarball at v1.0.0, so the commits they already hold no longer match the tag, " +
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
    const deps = makeDeps();

    void createReleaseCommand({ cwd: "/project", stageFiles: ["package.json", "bun.lock"] }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json", "bun.lock", "config/changelog-sections.json"]);
  });

  it("lets an explicit list drop the changelog, since the field is an override and not an addition", () => {
    const deps = makeDeps();

    void createReleaseCommand({ cwd: "/project", stageFiles: ["package.json"] }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json", "config/changelog-sections.json"]);
  });

  // Naming the manifest was the only way to stage it before the append existed, so a project's
  // config still holds it and must not end up staging — or offering to undo — the path twice.
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

    expect(thrown?.message).toContain("git checkout -- package.json config/changelog-sections.json");
  });

  // The manifest is forge's own write rather than a project's choice, and `checkChangelog` refuses
  // the next gate run without it — so an override may drop the changelog but never the digests.
  it("stages neither the changelog nor the digests for an explicit list on a run that promoted nothing", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => null) });

    void createReleaseCommand({ cwd: "/project", stageFiles: ["package.json", "bun.lock"] }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json", "bun.lock"]);
  });

  // An operator following the recovery verbatim must not be told to undo a set that leaves the one
  // file still dirty out of it.
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

    expect(thrown?.message).toContain("git checkout -- package.json config/changelog-sections.json");
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

  it("names the exact recovery when the commit fails with the version and changelog already written", () => {
    const deps = makeDeps({
      commit: mock((_cwd: string, _message: string, _files: string[]): boolean => {
        throw new Error("pre-commit hook failed");
      }),
    });

    expect(() => runCapturingLogs(() => void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS))).toThrow(
      "git checkout -- package.json CHANGELOG.md",
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
