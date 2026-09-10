import { describe, expect, it, mock } from "bun:test";
import type { Mock } from "bun:test";

import { createReleaseCommand } from "./release";
import { ReleaseError } from "./types";
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
  readRepositoryUrl: Mock<(cwd: string) => string | null>;
  removedSurfaceSince: Mock<(cwd: string, ref: string) => string[]>;
  tagIsAncestorOfHead: Mock<(cwd: string, tag: string) => boolean>;
  remoteTags: Mock<(cwd: string) => string[] | null>;
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
    removedSurfaceSince: mock((_cwd: string, _ref: string): string[] => []),
    tagIsAncestorOfHead: mock((_cwd: string, _tag: string): boolean => true),
    remoteTags: mock((_cwd: string): string[] | null => ["v1.0.0"]),
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
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
    expect(deps.resolveVersion.mock.calls[0]![0]).toMatchObject({ tagPrefix: "pkg-v" });
  });

  it("passes cwd to resolveVersion", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/my/project" }, deps);
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
    expect(deps.resolveVersion.mock.calls[0]![0]).toMatchObject({ cwd: "/my/project" });
  });

  it("dry-run mode does not call updatePackageVersion, commit, or createTag", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], { dry: true, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(0);
    expect(deps.commit.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("non-dry-run calls updatePackageVersion, commit, and createTag", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
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
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
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
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
    expect(callOrder).toEqual(["updatePackageVersion", "writeChangelog", "commit", "createTag"]);
  });

  it("commit receives the correct message and stageFiles", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project", stageFiles: ["package.json", "bun.lock"] }, deps);
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
    const [cwd, message, files] = deps.commit.mock.calls[0]!;
    expect(cwd).toBe("/project");
    expect(message).toBe("chore: release 1.1.0");
    expect(files).toEqual(["package.json", "bun.lock"]);
  });

  it("in-sync returns early without tagging", () => {
    const deps = makeDeps({ resolveVersion: mock(() => ({ version: "1.0.0", reason: "in-sync" as const, previous: "v1.0.0" })) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
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
      void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
    } finally {
      console.log = origLog;
    }
    expect(logs.some((l) => l.includes("git push && git push --tags"))).toBe(true);
    expect(logs.some((l) => l.includes("git add"))).toBe(false);
  });

  it("checks dirty tree when allow-dirty is false", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], { dry: false, "allow-dirty": false, "allow-empty-changelog": false, "allow-semver": false });
    expect(deps.isWorkingTreeClean.mock.calls).toHaveLength(1);
  });

  it("skips dirty tree check when allow-dirty is true", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
    expect(deps.isWorkingTreeClean.mock.calls).toHaveLength(0);
  });

  it("skips dirty tree check in dry-run mode", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], { dry: true, "allow-dirty": false, "allow-empty-changelog": false, "allow-semver": false });
    expect(deps.isWorkingTreeClean.mock.calls).toHaveLength(0);
  });

  it("tag already exists — skips all mutations", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);
    const deps = makeDeps({ tagExists: mock((_cwd: string, _tag: string): boolean => true) });
    try {
      const cmd = createReleaseCommand({ cwd: "/project" }, deps);
      void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
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
      void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
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
      void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
    } finally {
      console.log = origLog;
    }
    expect(deps.createTag.mock.calls).toHaveLength(1);
    expect(logs.some((l) => l.includes("skipping commit"))).toBe(false);
  });
});

describe("createReleaseCommand() — the bump's evidence", () => {
  const FLAGS = { dry: true, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false };

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
  const FLAGS = { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false };

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
  const FLAGS = { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false };

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
  const FLAGS = { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false };

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
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
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
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
    expect(deps.now.mock.calls).toHaveLength(1);
  });

  it("omits the link definition when the repository URL is unknown", () => {
    const deps = makeDeps({ readRepositoryUrl: mock((_cwd: string): string | null => null) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
    const [, , source] = deps.writeChangelog.mock.calls[0] as [string, string, string];
    expect(source.includes("[1.1.0]: ")).toBe(false);
  });

  it("honours a configured changelogFile", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project", changelogFile: "docs/CHANGES.md" }, deps);
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
    expect(deps.readChangelog.mock.calls[0]?.[1]).toBe("docs/CHANGES.md");
    expect(deps.writeChangelog.mock.calls[0]?.[1]).toBe("docs/CHANGES.md");
  });

  it("refuses an empty [Unreleased] and names the escape hatch", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => EMPTY) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false })).toThrow(
      "CHANGELOG.md has an empty [Unreleased] section, but commits exist since v1.0.0. " +
        "Write the entry, or use --allow-empty-changelog for a genuinely entry-free release.",
    );
  });

  it("the empty refusal precedes every mutation", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => EMPTY) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false })).toThrow(ReleaseError);
    expect(deps.updatePackageVersion.mock.calls).toHaveLength(0);
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
    expect(deps.commit.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(0);
  });

  it("refuses an empty [Unreleased] under --dry too, before reporting anything", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => EMPTY) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { dry: true, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false })).toThrow(ReleaseError);
  });

  it("--allow-empty-changelog proceeds and still promotes, carrying the placeholder through", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => EMPTY) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": true, "allow-semver": false });
    expect(deps.writeChangelog.mock.calls).toHaveLength(1);
    const [, , source] = deps.writeChangelog.mock.calls[0] as [string, string, string];
    expect(source.split("\n")[8]).toBe("## [1.1.0] — 2026-02-03");
    expect(source.split("\n")[10]).toBe("_Nothing yet._");
  });

  it("refuses a malformed changelog", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => MALFORMED) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false })).toThrow(ReleaseError);
  });

  it("--allow-empty-changelog does not license a malformed changelog", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => MALFORMED) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": true, "allow-semver": false })).toThrow(ReleaseError);
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
  });

  it("a repository with no changelog releases unchanged", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => null) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    const logs = runCapturingLogs(
      () => void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false }),
    );
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
    expect(deps.createTag.mock.calls).toHaveLength(1);
    expect(logs.some((l) => l === "  changelog: (no CHANGELOG.md — skipped)")).toBe(true);
  });

  it("--dry reports the promotion and writes nothing", () => {
    const deps = makeDeps();
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    const logs = runCapturingLogs(
      () => void cmd.run?.([], { dry: true, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false }),
    );
    expect(deps.readChangelog.mock.calls).toHaveLength(1);
    expect(deps.writeChangelog.mock.calls).toHaveLength(0);
    expect(logs.some((l) => l === "  changelog: [Unreleased] → [1.1.0] — 2026-02-03")).toBe(true);
  });

  it("in-sync returns before the changelog is read", () => {
    const deps = makeDeps({ resolveVersion: mock(() => ({ version: "1.0.0", reason: "in-sync" as const, previous: "v1.0.0" })) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    void cmd.run?.([], { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false });
    expect(deps.readChangelog.mock.calls).toHaveLength(0);
  });

  it("a dirty working tree refuses before the changelog is read", () => {
    const deps = makeDeps({ isWorkingTreeClean: mock((_cwd: string): boolean => false) });
    const cmd = createReleaseCommand({ cwd: "/project" }, deps);
    expect(() => cmd.run?.([], { dry: false, "allow-dirty": false, "allow-empty-changelog": false, "allow-semver": false })).toThrow(
      "Working tree is not clean. Commit or stash changes first, or use --allow-dirty.",
    );
    expect(deps.readChangelog.mock.calls).toHaveLength(0);
  });
});

describe("createReleaseCommand — the derived stageFiles default", () => {
  const FLAGS = { dry: false, "allow-dirty": true, "allow-empty-changelog": false, "allow-semver": false };

  it("stages the changelog it promoted, so the bump and the promotion land in one commit", () => {
    const deps = makeDeps();

    void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json", "CHANGELOG.md"]);
  });

  it("follows a renamed changelog rather than staging a `CHANGELOG.md` that was never written", () => {
    const deps = makeDeps();

    void createReleaseCommand({ cwd: "/project", changelogFile: "docs/CHANGES.md" }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json", "docs/CHANGES.md"]);
  });

  it("stages package.json alone when there is no changelog, since `git add` fails on a missing path", () => {
    const deps = makeDeps({ readChangelog: mock((_cwd: string, _file: string): string | null => null) });

    void createReleaseCommand({ cwd: "/project" }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json"]);
  });

  it("takes an explicit list verbatim, for a lockfile or a monorepo's sibling manifests", () => {
    const deps = makeDeps();

    void createReleaseCommand({ cwd: "/project", stageFiles: ["package.json", "bun.lock"] }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json", "bun.lock"]);
  });

  it("lets an explicit list drop the changelog, since the field is an override and not an addition", () => {
    const deps = makeDeps();

    void createReleaseCommand({ cwd: "/project", stageFiles: ["package.json"] }, deps).run?.([], FLAGS);

    expect(deps.commit.mock.calls[0]?.[2]).toEqual(["package.json"]);
  });
});
