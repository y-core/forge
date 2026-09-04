import { getCommitsSinceTag, getLatestTag } from "../internal/git";
import { readPackageVersion } from "../internal/pkg-json";
import type { BumpEvidence, BumpKind, ResolveVersionOptions, VersionDeps, VersionResult } from "../types";
import { ReleaseError } from "../types";
import { bumpSemVer, formatSemVer, isGreaterThan, parseSemVer } from "./semver";

// `git log --oneline` is exactly `%h %s`; this splits off only the sha token so a subject starting with a hex word survives.
function splitEntry(entry: string): { sha: string; subject: string } {
  const match = entry.match(/^([0-9a-f]+) /);
  const sha = match?.[1];
  return sha === undefined ? { sha: "", subject: entry } : { sha, subject: entry.slice(sha.length + 1) };
}

// `git log` is newest-first, so the first match is the newest commit asking for that bump.
function highestBump(entries: readonly string[]): { kind: BumpKind; evidence: BumpEvidence } {
  let kind: BumpKind = "patch";
  let winner: { sha: string; subject: string } | undefined;
  for (const entry of entries) {
    const { sha, subject } = splitEntry(entry);
    if (subject.startsWith("major:")) return { kind: "major", evidence: { commit: { sha, subject }, commitCount: entries.length } };
    if (subject.startsWith("minor:") && kind !== "minor") {
      kind = "minor";
      winner = { sha, subject };
    }
  }
  return { kind, evidence: { ...(winner !== undefined ? { commit: winner } : {}), commitCount: entries.length } };
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

  const { kind, evidence } = highestBump(commits);
  const bumped = bumpSemVer(prev, kind);
  return { version: formatSemVer(bumped), reason: `auto-${kind}`, previous: latestTag, evidence };
}
