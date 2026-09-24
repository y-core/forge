import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { createCommand } from "../cli/command";
import { CliError } from "../cli/errors";
import type { Command } from "../cli/types";
import { definitionList } from "../term/grid";
import { DEFAULT_FEATURE_MANIFEST, loadFeatures } from "./config";
import type { CurateReport, CurateRequest, SeamEdit } from "./types";

/** The working tree's files, root-relative: tracked and untracked alike, minus what `.gitignore` excludes and what is no longer on disk. @internal */
export function listWorkingTree(root: string): string[] {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf-8" });
  if (result.error !== undefined || result.status !== 0) {
    throw new CliError("external", `git ls-files failed in ${root} — forge curate copies a git working tree`);
  }
  const listed = [...new Set((result.stdout ?? "").split("\0").filter((path) => path !== ""))];
  return listed.filter((path) => lstatSync(join(root, path), { throwIfNoEntry: false }) !== undefined);
}

function assertFreshTarget(target: string): void {
  if (!existsSync(target)) return;
  if (!statSync(target).isDirectory()) throw new CliError("invalid-args", `${target} is not a directory`);
  if (readdirSync(target).length > 0)
    throw new CliError("invalid-args", `${target} is not empty — forge curate writes only into a fresh directory`);
}

function isUnder(path: string, directory: string): boolean {
  return path.startsWith(`${directory}/`);
}

function assertNoDirectoryEntry(root: string, kept: readonly string[]): void {
  const directory = kept.find((file) => lstatSync(join(root, file), { throwIfNoEntry: false })?.isDirectory() === true);
  if (directory === undefined) return;
  throw new CliError(
    "invalid-args",
    `\`${directory}\` is a directory git does not list inside — a nested repository or a submodule, which forge curate cannot copy`,
  );
}

function assertNoLinkedAncestor(root: string, paths: readonly string[]): void {
  const real = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth++) {
      const ancestor = segments.slice(0, depth).join("/");
      if (real.has(ancestor)) continue;
      if (lstatSync(join(root, ancestor), { throwIfNoEntry: false })?.isSymbolicLink() === true) {
        throw new CliError(
          "invalid-args",
          `\`${path}\` lies under \`${ancestor}\`, a symbolic link — forge curate reads and writes only through real directories`,
        );
      }
      real.add(ancestor);
    }
  }
}

/** A file's text, or `undefined` for one holding a NUL byte or bytes that are not UTF-8. */
function readText(path: string): string | undefined {
  const bytes = readFileSync(path);
  if (bytes.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** A line's trailing feature marker, in any of the comment forms a seam file's language offers. */
const MARKER = /(?:\/\*\s*feature:(\S+?)\s*\*\/|\/\/\s*feature:(\S+)|#\s*feature:(\S+)|<!--\s*feature:(\S+?)\s*-->)\s*$/;

/** A marker read off one line: the features it names, and whether it marks the line itself or opens or closes a region. */
interface Marker {
  features: readonly string[];
  edge: "line" | "begin" | "end";
}

/** Where a file's markers are read against: the manifest's features, and which of them list the file as a seam. */
interface MarkerScope {
  file: string;
  features: readonly string[];
  owners: ReadonlySet<string>;
}

function readMarker(line: string, at: string, scope: MarkerScope): Marker | undefined {
  const match = MARKER.exec(line);
  if (match === null) return undefined;
  const body = match.slice(1).find((group) => group !== undefined) ?? "";
  const [names = "", edge, ...rest] = body.split(":");
  if (rest.length > 0 || (edge !== undefined && edge !== "begin" && edge !== "end")) {
    throw new CliError(
      "invalid-args",
      `\`${at}\` ends with malformed marker \`feature:${body}\` — write \`feature:<feature>[,<feature>…][:begin|:end]\``,
    );
  }
  const features = names.split(",");
  const repeated = features.find((feature, index) => features.indexOf(feature) !== index);
  if (repeated !== undefined) throw new CliError("invalid-args", `\`${at}\` names feature \`${repeated}\` twice`);
  for (const feature of features) {
    if (!scope.features.includes(feature)) {
      throw new CliError("invalid-args", `\`${at}\` names unknown feature \`${feature}\` — the manifest names ${quoteList(scope.features)}`);
    }
    if (!scope.owners.has(feature)) {
      throw new CliError("invalid-args", `\`${at}\` marks feature \`${feature}\`, but \`${scope.file}\` is not one of its seams in the manifest`);
    }
  }
  return { features, edge: edge ?? "line" };
}

function quoteList(names: readonly string[]): string {
  return names.map((name) => `\`${name}\``).join(", ");
}

function sameFeatures(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((feature) => b.includes(feature));
}

/** The lines of one file that survive dropping `dropped`, and the features its markers name; refuses a malformed, nested or unclosed region. */
function curateLines(lines: readonly string[], scope: MarkerScope, dropped: ReadonlySet<string>): { remaining: string[]; marked: Set<string> } {
  const removes = (features: readonly string[]) => features.every((feature) => dropped.has(feature));
  const remaining: string[] = [];
  const marked = new Set<string>();
  let region: { features: readonly string[]; line: number } | undefined;
  for (const [index, line] of lines.entries()) {
    const at = `${scope.file}:${index + 1}`;
    const marker = readMarker(line, at, scope);
    for (const feature of marker?.features ?? []) marked.add(feature);
    const inRemovedRegion = region !== undefined && removes(region.features);
    if (marker?.edge === "begin") {
      if (region !== undefined) {
        throw new CliError("invalid-args", `\`${at}\` opens a region inside the one opened at line ${region.line} — regions do not nest`);
      }
      region = { features: marker.features, line: index + 1 };
      if (!removes(marker.features)) remaining.push(line);
      continue;
    }
    if (marker?.edge === "end") {
      if (region === undefined) throw new CliError("invalid-args", `\`${at}\` closes a region that no marker opened`);
      if (!sameFeatures(region.features, marker.features)) {
        throw new CliError(
          "invalid-args",
          `\`${at}\` closes \`feature:${marker.features.join(",")}\`, but the region open since line ${region.line} is \`feature:${region.features.join(",")}\``,
        );
      }
      region = undefined;
      if (!inRemovedRegion) remaining.push(line);
      continue;
    }
    if (inRemovedRegion || (marker !== undefined && removes(marker.features))) continue;
    remaining.push(line);
  }
  if (region !== undefined) throw new CliError("invalid-args", `\`${scope.file}:${region.line}\` opens a region that never closes`);
  return { remaining, marked };
}

/** The directories a recursive `mkdirSync(target)` would create, deepest first. */
function missingDirectories(target: string): string[] {
  const missing: string[] = [];
  for (let path = target; !existsSync(path); path = dirname(path)) missing.push(path);
  return missing;
}

function removeWritten(target: string, created: readonly string[]): void {
  if (created.length === 0) {
    for (const entry of readdirSync(target)) rmSync(join(target, entry), { recursive: true, force: true });
    return;
  }
  rmSync(target, { recursive: true, force: true });
  for (const parent of created.slice(1)) {
    if (readdirSync(parent).length > 0) return;
    rmdirSync(parent);
  }
}

function locateManifest(root: string, files: readonly string[], manifest: string | undefined): string | undefined {
  if (manifest === undefined) return undefined;
  const path = relative(root, resolve(root, manifest));
  if (isAbsolute(path) || path.startsWith("../")) return undefined;
  return files.includes(path) ? path : undefined;
}

/** Copies the working tree at `root` into `target` minus the dropped features' directories and marked lines, refusing before writing anything and removing what it wrote when the copy fails. @public */
export function curateTree(request: CurateRequest, list: (root: string) => string[] = listWorkingTree): CurateReport {
  const { root, target, config, drop } = request;
  const features = Object.keys(config);
  for (const feature of drop) {
    if (!features.includes(feature))
      throw new CliError("invalid-args", `cannot drop unknown feature \`${feature}\` — the manifest names ${quoteList(features)}`);
  }
  const dropped = new Set(drop);
  assertFreshTarget(target);

  const files = list(root);
  const owned = Object.entries(config).flatMap(([feature, { directories }]) =>
    directories.map((directory) => ({ feature, directory: directory.replace(/\/+$/, "") })),
  );
  for (const { directory } of owned) {
    if (!files.some((file) => isUnder(file, directory))) {
      throw new CliError("invalid-args", `directory \`${directory}\` names nothing in the working tree`);
    }
  }
  const manifest = locateManifest(root, files, request.manifest);
  const leavesManifest = features.every((feature) => dropped.has(feature));
  const directories = owned.filter(({ feature }) => dropped.has(feature)).map(({ directory }) => directory);
  const kept = files.filter((file) => !(file === manifest && leavesManifest) && !directories.some((directory) => isUnder(file, directory)));

  const owners = new Map<string, Set<string>>();
  for (const [feature, { seams }] of Object.entries(config)) {
    for (const file of seams) {
      if (!files.includes(file)) throw new CliError("invalid-args", `seam file \`${file}\` is not in the working tree`);
      if (file === manifest) {
        throw new CliError("invalid-args", `seam file \`${file}\` is the feature manifest, which every feature may mark without listing it`);
      }
      const inside = owned.find(({ directory }) => isUnder(file, directory));
      if (inside !== undefined) {
        throw new CliError(
          "invalid-args",
          `seam file \`${file}\` lies inside \`${inside.directory}\`, a directory of feature \`${inside.feature}\``,
        );
      }
      if (lstatSync(join(root, file), { throwIfNoEntry: false })?.isSymbolicLink() === true) {
        throw new CliError("invalid-args", `seam file \`${file}\` is a symbolic link — forge curate edits only a regular file`);
      }
      owners.set(file, (owners.get(file) ?? new Set()).add(feature));
    }
  }
  if (manifest !== undefined) owners.set(manifest, new Set(features));
  assertNoLinkedAncestor(root, [...kept, ...owners.keys()]);
  assertNoDirectoryEntry(root, kept);

  const edited = new Map<string, string[]>();
  const seams: SeamEdit[] = [];
  const marked = new Map<string, Set<string>>();
  for (const file of files) {
    if (lstatSync(join(root, file), { throwIfNoEntry: false })?.isFile() !== true) continue;
    const lines = readText(join(root, file))?.split("\n");
    if (lines === undefined) continue;
    const scope = { file, features, owners: owners.get(file) ?? new Set<string>() };
    const result = curateLines(lines, scope, dropped);
    marked.set(file, result.marked);
    if (result.remaining.length === lines.length || !kept.includes(file)) continue;
    edited.set(file, result.remaining);
    seams.push({ file, removed: lines.length - result.remaining.length });
  }
  for (const [feature, { seams: listed }] of Object.entries(config)) {
    const unmarked = listed.find((file) => marked.get(file)?.has(feature) !== true);
    if (unmarked !== undefined) throw new CliError("invalid-args", `seam file \`${unmarked}\` holds no \`feature:${feature}\` marker`);
  }

  const created = missingDirectories(target);
  mkdirSync(target, { recursive: true });
  try {
    for (const file of kept) {
      const destination = join(target, file);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(root, file), destination, { verbatimSymlinks: true, errorOnExist: true, force: false });
    }
    for (const [file, lines] of edited) writeFileSync(join(target, file), lines.join("\n"));
  } catch (error) {
    removeWritten(target, created);
    throw error;
  }

  return { files: kept, dropped: [...drop], directories, seams, manifest: leavesManifest ? manifest : undefined };
}

const curateFlags = {
  drop: { type: "string" as const, description: "Comma-separated features to leave out (default: none, a plain copy)" },
  config: { type: "string" as const, description: `Feature manifest module (default: ${DEFAULT_FEATURE_MANIFEST})` },
  root: { type: "string" as const, description: "Repository working directory (default: the working directory)" },
};

/** Builds the `forge curate <dir>` CLI `Command`. @public */
export function createCurateCommand(): Command<typeof curateFlags> {
  return createCommand({
    name: "curate",
    description: "Copy the working tree into a fresh directory, minus the directories and marked lines of the features --drop names",
    flags: curateFlags,
    args: { kind: "exact", count: 1 },
    async run(args, flags, ctx) {
      const cwd = process.cwd();
      const root = resolve(cwd, flags.root ?? ".");
      const config = await loadFeatures({ root, ...(flags.config === undefined ? {} : { path: flags.config }) });
      const target = resolve(cwd, args[0] ?? "");
      const drop = (flags.drop ?? "")
        .split(",")
        .map((feature) => feature.trim())
        .filter((feature) => feature !== "");
      const report = curateTree({ root, target, config, drop, manifest: flags.config ?? DEFAULT_FEATURE_MANIFEST });

      const print = ctx?.io.stdout ?? console.log;
      for (const line of definitionList(
        [
          { term: "files:", description: `${report.files.length} copied to ${target}` },
          { term: "dropped:", description: report.dropped.join(", ") || "(none — a plain copy)" },
          { term: "removed:", description: report.directories.join(", ") || "(no directories)" },
          { term: "seams:", description: report.seams.map((seam) => `${seam.file} −${seam.removed}`).join(", ") || "(no lines)" },
          { term: "manifest:", description: report.manifest === undefined ? "(kept, or outside the working tree)" : `${report.manifest} left out` },
        ],
        { indent: 2, gap: 1 },
      )) {
        print(line);
      }
    },
  });
}
