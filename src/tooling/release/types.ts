/** What asking the gate answered: it passed, it ran and failed, or it never ran at all. */
export type GateOutcome = "passed" | "failed" | "unrunnable";

/** The category of failure a release operation raised. */
export type ReleaseErrorKind =
  | "invalid-version"
  | "version-not-greater"
  | "version-mismatch"
  | "git-error"
  | "pkg-update"
  | "working-tree-dirty"
  | "changelog-empty"
  | "changelog-malformed"
  | "manifest-malformed"
  | "surface-shrink"
  | "history-rewritten"
  | "tag-unpushed"
  | "wrong-branch"
  | "gate-failed"
  | "gate-unrunnable"
  | "release-part-written"
  | "release-partial"
  | "index-stale"
  | "commit-mismatch"
  | "publishing-mismatch"
  | "tag-push-failed";

/** An error raised by the release pipeline, tagged with its {@link ReleaseErrorKind}. */
export class ReleaseError extends Error {
  readonly kind: ReleaseErrorKind;

  constructor(kind: ReleaseErrorKind, message: string) {
    super(message);
    this.name = "ReleaseError";
    this.kind = kind;
  }
}

/** Why an automatic bump came out the way it did. */
export interface BumpEvidence {
  /** The commit whose subject prefix won the bump; absent for a patch, which no commit asks for. */
  commit?: { sha: string; subject: string };
  /** How many commits `<latest-tag>..HEAD` held. */
  commitCount: number;
}

/** The version {@link resolveVersion} resolved to, and why. */
export interface VersionResult {
  version: string;
  reason: "explicit" | "auto-patch" | "auto-minor" | "auto-major" | "first-release" | "in-sync";
  previous: string | null;
  /** Set only on an `auto-*` reason — no other path derives a bump from commits. */
  evidence?: BumpEvidence;
}

/** Configuration for {@link createReleaseCommand}. */
export interface ReleaseCommandConfig {
  cwd: string;
  tagPrefix?: string;
  /** Files staged into the release commit. Defaults to what the release itself wrote. */
  stageFiles?: string[];
  /** Changelog to promote, relative to `cwd`. Defaults to `"CHANGELOG.md"`. */
  changelogFile?: string;
  /** Where the released sections' digests are recorded. Defaults to `config/changelog-sections.json`. */
  sectionsFile?: string;
  /** The gate run before the tag is cut, as argv. Defaults to `["bun", "run", "verify"]`. */
  gateCommand?: string[];
  /** Where the release tag is cut: `"here"` on HEAD, or `"pushed"` for a clone whose push flow may replace the release commit's sha — it commits, and a later run tags the publishing branch's tip once that carries the gated tree and the release subject, and pushes only that tag. Defaults to `"here"`. */
  tagOn?: "here" | "pushed";
}

/** A green gate on `baseTree`, with the release files forge derived from it, so a resumed release on the same bytes can skip running it again. */
export interface GateRecord {
  version: string;
  /** The tree the gate passed on: HEAD's, or the release commit's parent's for _committed_. */
  baseTree: string;
  /** Each staged path's sha256, as it is committed. */
  files: Record<string, string>;
  gateCommand: string[];
  passedAt: string;
}

/** A commit's sha, tree and subject line, as {@link ReleaseDeps.commitSummary} reads them. */
export interface CommitSummary {
  commit: string;
  tree: string;
  subject: string;
}

/** Injectable dependencies of {@link createReleaseCommand}, faked in tests. */
export interface ReleaseDeps {
  isWorkingTreeClean: (cwd: string) => boolean;
  resolveVersion: (opts: { explicit?: string; cwd: string; tagPrefix: string }) => VersionResult;
  updatePackageVersion: (version: string, cwd: string) => void;
  /** Commits `files` on HEAD. Returns `false` (no error) when none of them changed. */
  commit: (cwd: string, message: string, files: string[]) => boolean;
  /** Every path the HEAD commit changed against its parent. */
  committedPaths: (cwd: string) => string[];
  tagExists: (cwd: string, tag: string) => boolean;
  /** Creates `tag` on `commit`, or on HEAD when none is named. */
  createTag: (cwd: string, tag: string, commit?: string) => void;
  /** Fetches `origin`, so its remote-tracking branches are current. */
  fetchRemote: (cwd: string) => void;
  /** The commit, tree and subject `ref` names, or `null` when it does not resolve. */
  commitSummary: (cwd: string, ref: string) => CommitSummary | null;
  /** The newest commit in `since..ref`, or all of `ref` when `since` is `null`, whose subject is exactly `subject`, or `null`. */
  commitWithSubject: (cwd: string, ref: string, subject: string, since: string | null) => string | null;
  /** Pushes `refs/tags/<tag>` to `origin`, and nothing else. */
  pushTag: (cwd: string, tag: string) => void;
  /** Deletes the local `tag`. */
  deleteTag: (cwd: string, tag: string) => void;
  /** Reads the changelog, or `null` when the file does not exist. */
  readChangelog: (cwd: string, file: string) => string | null;
  writeChangelog: (cwd: string, file: string, source: string) => void;
  writeChangelogSections: (cwd: string, file: string, source: string) => void;
  /** The repository's normalised base URL for compare links, or `null` when unknown. */
  readRepositoryUrl: (cwd: string) => string | null;
  /** Public-surface entries present at `ref` and gone from the working tree. */
  removedSurfaceSince: (cwd: string, ref: string) => string[];
  /** False when `tag` is no longer an ancestor of HEAD, i.e. published history was rewritten. */
  tagIsAncestorOfHead: (cwd: string, tag: string) => boolean;
  /** Tag names the remote carries, or `null` when it could not be reached. */
  remoteTags: (cwd: string) => string[] | null;
  /** The branch HEAD is on, or `null` in a detached HEAD. */
  currentBranch: (cwd: string) => string | null;
  /** The branch the remote publishes from, or `null` when the remote names none. */
  defaultBranch: (cwd: string) => string | null;
  /** Runs the verification gate and answers what it did. */
  runGate: (cwd: string, command: readonly string[]) => GateOutcome;
  /** The release moment. */
  now: () => Date;
  /** False when `.git` is read-only, so the commit and the tag are left to the host. */
  gitWritable: (cwd: string) => boolean;
  /** The file's exact contents at `ref`, `path` relative to `cwd`, or `null` when it did not exist there. */
  readFileAtRef: (cwd: string, ref: string, path: string) => string | null;
  /** The subject line of the HEAD commit. */
  lastCommitSubject: (cwd: string) => string;
  /** The commit sha `ref` names. */
  resolveCommit: (cwd: string, ref: string) => string;
  /** The tree sha `ref` names. */
  resolveTree: (cwd: string, ref: string) => string;
  /** Every path the working tree changes against HEAD, or `undefined` outside a work tree. */
  worktreeChanges: (cwd: string) => readonly string[] | undefined;
  /** Reads a working-tree file, or `null` when it does not exist. */
  readWorkingFile: (cwd: string, path: string) => string | null;
  /** The gate record kept for `tag`, or `null` when there is no valid one. */
  readGateRecord: (cwd: string, tag: string) => GateRecord | null;
  writeGateRecord: (cwd: string, tag: string, record: GateRecord) => void;
}

/** Options for {@link resolveVersion}. */
export interface ResolveVersionOptions {
  explicit?: string;
  cwd: string;
  tagPrefix: string;
}

/** Injectable dependencies of {@link resolveVersion}, faked in tests. */
export interface VersionDeps {
  getLatestTag: (cwd: string, prefix: string) => string | null;
  getCommitsSinceTag: (cwd: string, tag: string) => string[];
  readPackageVersion: (cwd: string) => string;
}

/** Reads a barrel's source at a repo-relative path, or `null` when it is absent. */
export type BarrelReader = (relPath: string) => string | null;
