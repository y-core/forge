/** A parsed `major.minor.patch` version. */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Which component of a {@link SemVer} to increment. */
export type BumpKind = "major" | "minor" | "patch";

/** The category of failure a release operation raised. */
export type ReleaseErrorKind =
  | "invalid-version"
  | "version-not-greater"
  | "version-mismatch"
  | "git-error"
  | "pkg-update"
  | "working-tree-dirty"
  | "changelog-empty"
  | "changelog-malformed";

/** An error raised by the release pipeline, tagged with its {@link ReleaseErrorKind}. */
export class ReleaseError extends Error {
  readonly kind: ReleaseErrorKind;

  constructor(kind: ReleaseErrorKind, message: string) {
    super(message);
    this.name = "ReleaseError";
    this.kind = kind;
  }
}

/** The version {@link resolveVersion} resolved to, and why. */
export interface VersionResult {
  version: string;
  reason: "explicit" | "auto-patch" | "auto-minor" | "auto-major" | "first-release" | "in-sync";
  previous: string | null;
}

/** Configuration for {@link createReleaseCommand}. */
export interface ReleaseCommandConfig {
  cwd: string;
  tagPrefix?: string;
  /** Files staged into the release commit. Defaults to what the release itself wrote — `package.json`,
   *  plus `changelogFile` when a changelog was promoted. Name it only to stage something else too. */
  stageFiles?: string[];
  /** Changelog to promote, relative to `cwd`. Defaults to `"CHANGELOG.md"`. */
  changelogFile?: string;
}

/** Injectable dependencies of {@link createReleaseCommand}, faked in tests. */
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
