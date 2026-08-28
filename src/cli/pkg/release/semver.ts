import type { BumpKind, SemVer } from "../types";

const isCanonicalDecimal = (part: string): boolean => part === String(Number(part));

/** Parses a `major.minor.patch` string (with an optional leading `v`) into a {@link SemVer}, or `null` if it is malformed. */
export function parseSemVer(str: string): SemVer | null {
  const normalized = str.startsWith("v") ? str.slice(1) : str;
  const parts = normalized.split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map(Number);
  const [major, minor, patch] = nums;
  if (major === undefined || minor === undefined || patch === undefined) return null;
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) return null;
  if (major < 0 || minor < 0 || patch < 0) return null;
  if (!parts.every(isCanonicalDecimal)) return null;
  return { major, minor, patch };
}

/** Formats a {@link SemVer} as `major.minor.patch`. */
export function formatSemVer(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** Compares two {@link SemVer} values by precedence, returning -1, 0, or 1. */
export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

/** True when `next` has greater precedence than `prev`. */
export function isGreaterThan(next: SemVer, prev: SemVer): boolean {
  return compareSemVer(next, prev) === 1;
}

/** Returns `v` bumped by `kind`, resetting the lower components to zero. */
export function bumpSemVer(v: SemVer, kind: BumpKind): SemVer {
  switch (kind) {
    case "major":
      return { major: v.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: v.major, minor: v.minor + 1, patch: 0 };
    case "patch":
      return { major: v.major, minor: v.minor, patch: v.patch + 1 };
  }
}
