import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { Kind, SeedFile, SyncOutcome } from "../types";

/** The files `--init` writes when they are absent — the repository owns each one after the first
 *  write, and a sync never touches one again. @public */
export function seedFiles(claudeRoot: string, kind: Kind): SeedFile[] {
  const dir = join(claudeRoot, "seed");
  return [
    { file: "CLAUDE.md", from: join(dir, `CLAUDE.${kind}.md`) },
    { file: "AGENTS.md", from: join(dir, "AGENTS.md") },
    { file: ".claude/settings.local.json", from: join(dir, "settings.local.json") },
  ];
}

/** Writes each absent seed file, reporting what happened to every one. @public */
export function seed(repo: string, files: readonly SeedFile[]): Array<{ file: string; outcome: SyncOutcome }> {
  const results: Array<{ file: string; outcome: SyncOutcome }> = [];
  for (const { file, from } of files) {
    if (!existsSync(from)) continue;
    const to = resolve(repo, file);
    if (existsSync(to)) {
      results.push({ file, outcome: "kept" });
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    results.push({ file, outcome: "seeded" });
  }
  return results;
}
