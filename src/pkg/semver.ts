import type { BumpKind, SemVer } from "./types";

export function parseSemVer(str: string): SemVer | null {
  const normalized = str.startsWith("v") ? str.slice(1) : str;
  const parts = normalized.split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map(Number);
  const [major, minor, patch] = nums;
  if (major === undefined || minor === undefined || patch === undefined) return null;
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) return null;
  if (major < 0 || minor < 0 || patch < 0) return null;
  // Reject leading zeros ("01.2.3") and empty parts ("1..3")
  if (parts.some((p) => p !== String(Number(p)))) return null;
  return { major, minor, patch };
}

export function formatSemVer(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

export function isGreaterThan(next: SemVer, prev: SemVer): boolean {
  return compareSemVer(next, prev) === 1;
}

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
