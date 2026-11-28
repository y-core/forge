import type { ChangelogHunk } from "./types";

/** The tree's changelog, whose patch hunks the harness applies by text inside `[Unreleased]` rather than by line. */
export const CHANGELOG = "CHANGELOG.md";

const SECTION = `diff --git a/${CHANGELOG} b/${CHANGELOG}`;

function sectionOf(patch: string): string[] {
  const lines = patch.split("\n");
  const start = lines.indexOf(SECTION);
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith("diff --git "));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

function hunkOf(body: readonly string[]): ChangelogHunk {
  const lastChange = body.findLastIndex((line) => line.startsWith("+") || line.startsWith("-"));
  const kept = body.slice(0, lastChange + 1);
  return {
    before: kept.filter((line) => !line.startsWith("+")).map((line) => line.slice(1)),
    after: kept.filter((line) => !line.startsWith("-")).map((line) => line.slice(1)),
  };
}

/** The hunks a patch makes to the root changelog, in order; none when it leaves the changelog alone. */
export function changelogHunks(patch: string): ChangelogHunk[] {
  const hunks: string[][] = [];
  for (const line of sectionOf(patch)) {
    if (line.startsWith("@@")) hunks.push([]);
    else if (/^[ +-]/.test(line)) hunks.at(-1)?.push(line);
  }
  return hunks.map(hunkOf);
}

function unreleasedRange(lines: readonly string[]): [number, number] | undefined {
  const start = lines.indexOf("## [Unreleased]");
  if (start === -1) return undefined;
  const next = lines.findIndex((line, index) => index > start && line.startsWith("## ["));
  return [start, next === -1 ? lines.length : next];
}

function blockAt(lines: readonly string[], block: readonly string[], [start, end]: [number, number]): number {
  for (let at = start; at + block.length <= end; at += 1) {
    if (block.every((line, offset) => lines[at + offset] === line)) return at;
  }
  return -1;
}

/** Applies each hunk where its leading context and removed lines stand inside `[Unreleased]`, answering `undefined` when one is not there. */
export function editUnreleased(changelog: string, hunks: readonly ChangelogHunk[]): string | undefined {
  const lines = changelog.split("\n");
  for (const hunk of hunks) {
    const range = unreleasedRange(lines);
    const at = range && hunk.before.length > 0 ? blockAt(lines, hunk.before, range) : -1;
    if (at === -1) return undefined;
    lines.splice(at, hunk.before.length, ...hunk.after);
  }
  return lines.join("\n");
}
