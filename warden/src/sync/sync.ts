import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import type { Kind, SyncTree } from "../types";

/** The trees a sync replaces wholesale. The canon is not among them — it is read from the installed
 *  package, never copied into a consumer. @public */
export function syncTrees(claudeRoot: string, kind: Kind): SyncTree[] {
  return [
    { tree: ".claude/agents", from: join(claudeRoot, "agents", kind) },
    { tree: ".claude/commands", from: join(claudeRoot, "commands") },
  ];
}

/** Every file under `dir`, as paths relative to it, sorted. @public */
export function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? walk(full, base) : [relative(base, full)];
    })
    .sort();
}

/** True when both paths hold the same bytes. @public */
export function identical(a: string, b: string): boolean {
  const left = readFileSync(a);
  const right = readFileSync(b);
  return left.equals(right);
}

/** Copies every file under `from` into `to`, creating directories as it goes. @public */
export function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const destination = join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, destination);
    else copyFileSync(source, destination);
  }
}

/** Replaces each synced tree wholesale, returning the destinations written. @public */
export function sync(repo: string, trees: readonly SyncTree[]): string[] {
  const written: string[] = [];
  for (const { tree, from } of trees) {
    if (!existsSync(from)) continue;
    const to = resolve(repo, tree);
    // Staged into a sibling and renamed over, so a copy that fails midway leaves the previous tree
    // whole: the destination is only ever a complete tree or the one that was already there. It is
    // replaced rather than copied over, because a copy-over silently keeps a file the corpus
    // dropped — and the rename is what makes replacing it survivable.
    const staged = `${to}.warden-staging`;
    rmSync(staged, { recursive: true, force: true });
    try {
      copyTree(from, staged);
      rmSync(to, { recursive: true, force: true });
      renameSync(staged, to);
    } finally {
      rmSync(staged, { recursive: true, force: true });
    }
    written.push(tree);
  }
  return written;
}
