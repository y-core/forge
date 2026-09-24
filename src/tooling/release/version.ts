import { bumpSemVer, formatSemVer, isGreaterThan, parseSemVer } from "../gate/semver";
import type { BumpKind } from "../gate/types";
import { getCommitsSinceTag, getLatestTag } from "./git";
import { readPackageVersion } from "./pkg-json";
import type { BumpEvidence, ResolveVersionOptions, VersionDeps, VersionResult } from "./types";
import { ReleaseError } from "./types";

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

function stripPrefix(tag: string, prefix: string): string {
  return tag.startsWith(prefix) ? tag.slice(prefix.length) : tag;
}

/** Resolves the next release version from an explicit override or the commits since the latest tag. */
export function resolveVersion(
  { explicit, cwd, tagPrefix }: ResolveVersionOptions,
  deps: VersionDeps = { getLatestTag, getCommitsSinceTag, readPackageVersion },
): VersionResult {
  const latestTag = deps.getLatestTag(cwd, tagPrefix);
  // Parsed once, and a failure is fatal rather than skipped: the not-greater guard below is written
  // `prev !== null && …`, so a tag nothing can parse would make it vacuous and wave a downgrade through.
  const prev = latestTag === null ? null : parseSemVer(stripPrefix(latestTag, tagPrefix));
  if (latestTag !== null && prev === null) {
    throw new ReleaseError("invalid-version", `Cannot parse version from tag: ${latestTag}`);
  }

  if (explicit !== undefined) {
    const parsed = parseSemVer(explicit);
    if (!parsed) {
      throw new ReleaseError("invalid-version", `Invalid semver: "${explicit}"`);
    }
    const version = formatSemVer(parsed);

    if (prev !== null && !isGreaterThan(parsed, prev)) {
      throw new ReleaseError("version-not-greater", `Version ${version} is not greater than the current tag ${latestTag}`);
    }

    return { version, reason: "explicit", previous: latestTag };
  }

  if (latestTag === null || prev === null) {
    return { version: "0.0.1", reason: "first-release", previous: null };
  }

  const commits = deps.getCommitsSinceTag(cwd, latestTag);

  if (commits.length === 0) {
    const pkgVersion = deps.readPackageVersion(cwd);
    if (pkgVersion !== formatSemVer(prev)) {
      throw new ReleaseError("version-mismatch", `package.json version (${pkgVersion}) does not match latest tag (${latestTag})`);
    }
    return { version: pkgVersion, reason: "in-sync", previous: latestTag };
  }

  const { kind, evidence } = highestBump(commits);
  const bumped = bumpSemVer(prev, kind);
  return { version: formatSemVer(bumped), reason: `auto-${kind}`, previous: latestTag, evidence };
}
