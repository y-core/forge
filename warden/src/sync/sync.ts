import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import type { Kind, SyncTree } from "../types";

/** The trees a sync replaces wholesale; the canon is read from the installed package, never copied. @public */
export function syncTrees(claudeRoot: string, kind: Kind): SyncTree[] {
  return [
    { tree: ".claude/agents", from: [join(claudeRoot, "agents", "shared"), join(claudeRoot, "agents", kind)] },
    { tree: ".claude/skills", from: [join(claudeRoot, "skills", "shared"), join(claudeRoot, "skills", kind)] },
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
    const sources = from.filter((source) => existsSync(source));
    if (sources.length === 0) continue;
    const to = resolve(repo, tree);
    // Staged into a sibling and renamed over, so a copy failing midway leaves the previous tree
    // whole; copying over it instead would silently keep a file the corpus dropped.
    const staged = `${to}.warden-staging`;
    rmSync(staged, { recursive: true, force: true });
    try {
      for (const source of sources) copyTree(source, staged);
      rmSync(to, { recursive: true, force: true });
      renameSync(staged, to);
    } finally {
      rmSync(staged, { recursive: true, force: true });
    }
    written.push(tree);
  }
  return written;
}
