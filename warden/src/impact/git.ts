import { execFileSync } from "node:child_process";

import { CliError } from "../../../src/tooling/cli/errors";

/** One file a diff touched, with the line ranges it changed on the new side. @public */
export interface ChangedFile {
  /** Repository-relative path, as git spells it. */
  path: string;
  /** 1-indexed inclusive `[start, end]` ranges. */
  ranges: readonly { start: number; end: number }[];
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const NEW_PATH = /^\+\+\+ (?:b\/)?(.+)$/;

/** Parses a `--unified=0` diff into the changed line ranges of each surviving file.
 *
 *  A deleted file is skipped: `+++ /dev/null` names no new side, and a range on it would resolve
 *  against a document the index no longer holds. A zero-length hunk — `@@ -210,5 +209,0 @@`, which
 *  is what a pure deletion produces — is kept as the single line it sits at, because deleting a rule
 *  out of a section is exactly the change this tool exists to report. @public */
export function parseDiff(text: string): ChangedFile[] {
  const files = new Map<string, { start: number; end: number }[]>();
  let current: string | undefined;

  for (const line of text.split("\n")) {
    const header = line.match(NEW_PATH);
    if (header !== null) {
      const path = header[1] ?? "";
      current = path === "/dev/null" ? undefined : path;
      if (current !== undefined && !files.has(current)) files.set(current, []);
      continue;
    }

    const hunk = line.match(HUNK);
    if (hunk === null || current === undefined) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    files.get(current)?.push({ start: Math.max(1, start), end: Math.max(1, start + Math.max(count, 1) - 1) });
  }

  return [...files].map(([path, ranges]) => ({ path, ranges }));
}

/** Every markdown file `ref` changed, with its changed line ranges.
 *
 *  `stdio` pipes stderr separately rather than interleaving it: a `warning: LF will be replaced by
 *  CRLF` line landing mid-hunk is corruption the parser would eat silently. @public */
export function changed(root: string, ref: string, paths: readonly string[] = ["*.md"]): ChangedFile[] {
  const run = (args: string[]): string => {
    try {
      return execFileSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }) as string;
    } catch {
      throw new CliError("invalid-args", `git ${args[0]} failed for ref \`${ref}\` — is it a commit in this repository?`);
    }
  };

  run(["rev-parse", "--verify", `${ref}^{commit}`]);
  return parseDiff(run(["diff", "--unified=0", "--no-color", "--no-ext-diff", "-M", ref, "--", ...paths]));
}
