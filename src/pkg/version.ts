import { getCommitsSinceTag, getLastCommitMessage, getLatestTag } from "./git";
import { readPackageVersion } from "./pkg";
import { bumpSemVer, formatSemVer, isGreaterThan, parseSemVer } from "./semver";
import type { VersionResult } from "./types";
import { ReleaseError } from "./types";

interface ResolveVersionOptions {
  explicit?: string;
  cwd: string;
  tagPrefix: string;
}

interface VersionDeps {
  getLatestTag: (cwd: string, prefix: string) => string | null;
  getCommitsSinceTag: (cwd: string, tag: string) => string[];
  getLastCommitMessage: (cwd: string) => string;
  readPackageVersion: (cwd: string) => string;
}

export function resolveVersion(
  { explicit, cwd, tagPrefix }: ResolveVersionOptions,
  deps: VersionDeps = { getLatestTag, getCommitsSinceTag, getLastCommitMessage, readPackageVersion },
): VersionResult {
  const latestTag = deps.getLatestTag(cwd, tagPrefix);

  if (explicit !== undefined) {
    const parsed = parseSemVer(explicit);
    if (!parsed) {
      throw new ReleaseError("invalid-version", `Invalid semver: "${explicit}"`);
    }
    const version = formatSemVer(parsed);

    if (latestTag !== null) {
      const prevStr = latestTag.startsWith(tagPrefix) ? latestTag.slice(tagPrefix.length) : latestTag;
      const prev = parseSemVer(prevStr);
      if (prev !== null && !isGreaterThan(parsed, prev)) {
        throw new ReleaseError(
          "version-not-greater",
          `Version ${version} is not greater than the current tag ${latestTag}`,
        );
      }
    }

    return { version, reason: "explicit", previous: latestTag };
  }

  if (latestTag === null) {
    return { version: "0.0.1", reason: "first-release", previous: null };
  }

  const commits = deps.getCommitsSinceTag(cwd, latestTag);

  if (commits.length === 0) {
    const pkgVersion = deps.readPackageVersion(cwd);
    const tagVersion = latestTag.startsWith(tagPrefix) ? latestTag.slice(tagPrefix.length) : latestTag;
    if (pkgVersion !== tagVersion) {
      throw new ReleaseError(
        "version-mismatch",
        `package.json version (${pkgVersion}) does not match latest tag (${latestTag})`,
      );
    }
    return { version: pkgVersion, reason: "in-sync", previous: latestTag };
  }

  const prevStr = latestTag.startsWith(tagPrefix) ? latestTag.slice(tagPrefix.length) : latestTag;
  const prev = parseSemVer(prevStr);
  if (prev === null) {
    throw new ReleaseError("invalid-version", `Cannot parse version from tag: ${latestTag}`);
  }

  const lastMsg = deps.getLastCommitMessage(cwd);
  let bumpKind: "major" | "minor" | "patch" = "patch";
  let reason: VersionResult["reason"] = "auto-patch";

  if (lastMsg.startsWith("major:")) {
    bumpKind = "major";
    reason = "auto-major";
  } else if (lastMsg.startsWith("minor:")) {
    bumpKind = "minor";
    reason = "auto-minor";
  }

  const bumped = bumpSemVer(prev, bumpKind);
  return { version: formatSemVer(bumped), reason, previous: latestTag };
}
