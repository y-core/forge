import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
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
    // Delete first rather than copy over: a copy-over silently keeps a file the corpus has dropped.
    rmSync(to, { recursive: true, force: true });
    copyTree(from, to);
    written.push(tree);
  }
  return written;
}
