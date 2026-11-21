import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { CorpusFile, Kind, SyncOutcome } from "../types";
import { render } from "./sync";

/** The files `--init` writes when they are absent. @public */
export function seedFiles(claudeRoot: string, kind: Kind): CorpusFile[] {
  const dir = join(claudeRoot, "seed");
  return [
    { file: "CLAUDE.md", from: join(dir, `CLAUDE.${kind}.md`) },
    { file: "AGENTS.md", from: join(dir, "AGENTS.md") },
  ];
}

/** Writes each absent seed file, rendered for `slug`, reporting what happened to every one. @public */
export function seed(repo: string, files: readonly CorpusFile[], slug: string): Array<{ file: string; outcome: SyncOutcome }> {
  const results: Array<{ file: string; outcome: SyncOutcome }> = [];
  for (const { file, from } of files) {
    if (!existsSync(from)) continue;
    const to = resolve(repo, file);
    if (existsSync(to)) {
      results.push({ file, outcome: "kept" });
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, render(from, slug));
    results.push({ file, outcome: "seeded" });
  }
  return results;
}
