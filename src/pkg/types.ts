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
  | "git-error";

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
