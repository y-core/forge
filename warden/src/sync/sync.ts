import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { libraryPrefix } from "../paths";
import type { CorpusFile, Kind, SyncPlan, SyncTree } from "../types";

const REPO = /\{\{repo\}\}/g;
const OVERLAY = ".overlay.md";
const SLOT = /^\{\{slot:([a-z0-9-]+)\}\}$/;
const SLOT_OPEN = /^<!-- slot:([a-z0-9-]+) -->$/;
const SLOT_CLOSE = "<!-- /slot -->";

/** The trees a sync replaces wholesale; the canon is read from the installed package, never copied. @public */
export function syncTrees(claudeRoot: string, kind: Kind): SyncTree[] {
  return [
    { tree: ".claude/agents", from: [join(claudeRoot, "agents", "shared"), join(claudeRoot, "agents", kind)] },
    { tree: ".claude/skills", from: [join(claudeRoot, "skills", "shared"), join(claudeRoot, "skills", kind)] },
  ];
}

/** The single files a sync overwrites: the fleet's harness policy and the Codex example. A repository's own additions go in `settings.local.json`. @public */
export function syncFiles(claudeRoot: string): CorpusFile[] {
  return [
    { file: ".claude/settings.json", from: join(claudeRoot, "settings.json") },
    { file: ".codex/config.toml.example", from: join(claudeRoot, "codex", "config.toml.example") },
  ];
}

/** Everything a sync writes into `repo`, its slug read from the manifest's unscoped name. @public */
export function syncPlan(claudeRoot: string, kind: Kind, repo: string): SyncPlan {
  return { trees: syncTrees(claudeRoot, kind), files: syncFiles(claudeRoot), slug: libraryPrefix(repo) };
}

/** A corpus file's text with `{{repo}}` replaced by the repository's slug. @public */
export function render(source: string, slug: string): string {
  return readFileSync(source, "utf-8").replace(REPO, slug);
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

/** Each named block of an overlay, between `<!-- slot:name -->` and `<!-- /slot -->`; anything outside a block but blank lines is refused. */
function overlayBlocks(overlay: string, file: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let open: { name: string; lines: string[] } | undefined;
  for (const line of overlay.split("\n")) {
    const start = SLOT_OPEN.exec(line);
    if (open !== undefined) {
      if (line === SLOT_CLOSE) {
        blocks.set(open.name, open.lines.join("\n"));
        open = undefined;
      } else open.lines.push(line);
    } else if (start !== null) {
      if (blocks.has(start[1] ?? "")) throw new Error(`${file} fills {{slot:${start[1]}}} twice`);
      open = { name: start[1] ?? "", lines: [] };
    } else if (line.trim() !== "") throw new Error(`${file} has text outside a slot: ${line}`);
  }
  if (open !== undefined) throw new Error(`${file} never closes {{slot:${open.name}}}`);
  return blocks;
}

/** A shared body with each `{{slot:name}}` line replaced by the overlay's block of that name; a slot left empty or a block left unused is refused. @public */
export function mergeOverlay(body: string, overlay: string, file: string): string {
  const blocks = overlayBlocks(overlay, file);
  const used = new Set<string>();
  const merged = body.split("\n").flatMap((line) => {
    const name = SLOT.exec(line)?.[1];
    if (name === undefined) return [line];
    const block = blocks.get(name);
    if (block === undefined) throw new Error(`${file} does not fill {{slot:${name}}}`);
    used.add(name);
    return block === "" ? [] : block.split("\n");
  });
  const unused = [...blocks.keys()].filter((name) => !used.has(name));
  if (unused.length > 0) throw new Error(`${file} fills slots the body does not have: ${unused.join(", ")}`);
  return merged.join("\n");
}

/** Every file a layered tree holds, rendered for `slug`: a later source's file replaces an earlier one's, and `X.overlay.md` fills the slots of `X.md`. @public */
export function layerTree(from: readonly string[], slug: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const source of from) {
    for (const file of walk(source)) {
      if (!file.endsWith(OVERLAY)) {
        files.set(file, render(join(source, file), slug));
        continue;
      }
      const base = `${file.slice(0, -OVERLAY.length)}.md`;
      const body = files.get(base);
      if (body === undefined) throw new Error(`${join(source, file)} overlays ${base}, which no earlier source holds`);
      files.set(base, mergeOverlay(body, render(join(source, file), slug), join(source, file)));
    }
  }
  for (const [file, text] of files) {
    const slot = text.split("\n").find((line) => SLOT.test(line));
    if (slot !== undefined) throw new Error(`${file} has no overlay filling ${slot}`);
  }
  return files;
}

/** Writes each layered file under `to`, creating directories as it goes. @public */
export function writeTree(to: string, files: ReadonlyMap<string, string>): void {
  for (const [file, text] of files) {
    const destination = join(to, file);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, text);
  }
}

/** Replaces each synced tree wholesale and overwrites each synced file, returning the destinations written. @public */
export function sync(repo: string, { trees, files, slug }: SyncPlan): string[] {
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
      mkdirSync(staged, { recursive: true });
      writeTree(staged, layerTree(sources, slug));
      rmSync(to, { recursive: true, force: true });
      renameSync(staged, to);
    } finally {
      rmSync(staged, { recursive: true, force: true });
    }
    written.push(tree);
  }
  for (const { file, from } of files) {
    if (!existsSync(from)) continue;
    const to = resolve(repo, file);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, render(from, slug));
    written.push(file);
  }
  return written;
}
