import { getCommitsSinceTag, getLatestTag } from "../internal/git";
import { readPackageVersion } from "../internal/pkg-json";
import type { BumpKind, ResolveVersionOptions, VersionDeps, VersionResult } from "../types";
import { ReleaseError } from "../types";
import { bumpSemVer, formatSemVer, isGreaterThan, parseSemVer } from "./semver";

// `git log --oneline` is exactly `%h %s`; this strips only the sha token so a subject starting with a hex word survives.
function subjectOf(entry: string): string {
  return entry.replace(/^[0-9a-f]+ /, "");
}

function highestBump(entries: readonly string[]): BumpKind {
  let kind: BumpKind = "patch";
  for (const entry of entries) {
    const subject = subjectOf(entry);
    if (subject.startsWith("major:")) return "major";
    if (subject.startsWith("minor:")) kind = "minor";
  }
  return kind;
}

/** Resolves the next release version from an explicit override or the commits since the latest tag. */
export function resolveVersion(
  { explicit, cwd, tagPrefix }: ResolveVersionOptions,
  deps: VersionDeps = { getLatestTag, getCommitsSinceTag, readPackageVersion },
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
        throw new ReleaseError("version-not-greater", `Version ${version} is not greater than the current tag ${latestTag}`);
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
      throw new ReleaseError("version-mismatch", `package.json version (${pkgVersion}) does not match latest tag (${latestTag})`);
    }
    return { version: pkgVersion, reason: "in-sync", previous: latestTag };
  }

  const prevStr = latestTag.startsWith(tagPrefix) ? latestTag.slice(tagPrefix.length) : latestTag;
  const prev = parseSemVer(prevStr);
  if (prev === null) {
    throw new ReleaseError("invalid-version", `Cannot parse version from tag: ${latestTag}`);
  }

  const bumpKind = highestBump(commits);
  const bumped = bumpSemVer(prev, bumpKind);
  return { version: formatSemVer(bumped), reason: `auto-${bumpKind}`, previous: latestTag };
}
