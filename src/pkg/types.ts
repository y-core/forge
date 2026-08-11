export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export type BumpKind = "major" | "minor" | "patch";

export type ReleaseErrorKind =
  | "invalid-version"
  | "version-not-greater"
  | "version-mismatch"
  | "git-error"
  | "pkg-update"
  | "working-tree-dirty"
  | "changelog-empty"
  | "changelog-malformed";

export class ReleaseError extends Error {
  readonly kind: ReleaseErrorKind;

  constructor(kind: ReleaseErrorKind, message: string) {
    super(message);
    this.name = "ReleaseError";
    this.kind = kind;
  }
}

export interface VersionResult {
  version: string;
  reason: "explicit" | "auto-patch" | "auto-minor" | "auto-major" | "first-release" | "in-sync";
  previous: string | null;
}

export interface ReleaseCommandConfig {
  cwd: string;
  tagPrefix?: string;
  stageFiles?: string[];
  /** Changelog to promote, relative to `cwd`. Defaults to `"CHANGELOG.md"`. A repository without
   *  one is not an error — the promotion step is skipped and the release proceeds. */
  changelogFile?: string;
}

export interface ReleaseDeps {
  isWorkingTreeClean: (cwd: string) => boolean;
  resolveVersion: (opts: { explicit?: string; cwd: string; tagPrefix: string }) => VersionResult;
  updatePackageVersion: (version: string, cwd: string) => void;
  /** Stages `files` and commits. Returns `false` (no error) when nothing was staged. */
  commit: (cwd: string, message: string, files: string[]) => boolean;
  tagExists: (cwd: string, tag: string) => boolean;
  createTag: (cwd: string, tag: string) => void;
  /** Reads the changelog, or `null` when the file does not exist. */
  readChangelog: (cwd: string, file: string) => string | null;
  writeChangelog: (cwd: string, file: string, source: string) => void;
  /** The repository's normalised base URL for compare links, or `null` when unknown. */
  readRepositoryUrl: (cwd: string) => string | null;
  /** The release moment. Injected so a test needs no clock. */
  now: () => Date;
}

export interface ResolveVersionOptions {
  explicit?: string;
  cwd: string;
  tagPrefix: string;
}

export interface VersionDeps {
  getLatestTag: (cwd: string, prefix: string) => string | null;
  getCommitsSinceTag: (cwd: string, tag: string) => string[];
  readPackageVersion: (cwd: string) => string;
}
