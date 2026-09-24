import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { createCommand } from "../cli/command";
import { CliError } from "../cli/errors";
import { capture } from "../cli/proc";
import type { Command } from "../cli/types";
import { definitionList } from "../term/grid";
import { DEFAULT_FEATURE_MANIFEST, loadFeatures } from "./config";
import { describeFeatureGraph, featureGraph, quoteList, resolveFeatures } from "./graph";
import type { CurateReport, CurateRequest, CurateRunner, FeatureManifest, FeatureSelection, SeamEdit } from "./types";

const REGENERATE_TAIL = 40;

/** Runs one command through `capture`, never throwing on a non-zero exit. @internal */
export const runCommand: CurateRunner = (argv, cwd, env) => capture(argv[0], argv.slice(1), { cwd, env });

/** The environment a command run inside a curated tree needs: the tree as the app root, and the root's installed binaries on `PATH`. @internal */
export function skeletonEnv(root: string, tree: string): typeof process.env {
  // Bun resolves a module through the linked node_modules to its real path, which lies outside the tree; a config deriving a
  // repository-relative path from `import.meta.resolve` would then name the demonstrator's copy and not the skeleton's.
  return {
    ...process.env,
    FORGE_APP_ROOT: tree,
    NODE_PRESERVE_SYMLINKS: "1",
    PATH: join(root, "node_modules", ".bin") + delimiter + (process.env.PATH ?? ""),
  };
}

function unlinkModules(tree: string): void {
  const link = join(tree, "node_modules");
  if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() === true) unlinkSync(link);
}

/** Runs `body` with the tree's `node_modules` linked to the root's, unlinking it once `body` returns or its promise settles. @internal */
export function withLinkedModules<T>(root: string, tree: string, body: () => T): T {
  symlinkSync(join(root, "node_modules"), join(tree, "node_modules"), "dir");
  let result: T;
  try {
    result = body();
  } catch (error) {
    unlinkModules(tree);
    throw error;
  }
  if (result instanceof Promise) return result.finally(() => unlinkModules(tree)) as T;
  unlinkModules(tree);
  return result;
}

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

function withoutTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}

function describeCommand(argv: readonly string[]): string {
  return `\`${argv.join(" ")}\``;
}

function assertRegenerable(root: string, files: readonly string[], config: FeatureManifest, regenerating: readonly string[]): void {
  for (const feature of regenerating) {
    const regenerate = config[feature]?.regenerate;
    if (regenerate === undefined) continue;
    for (const path of regenerate.remove ?? []) {
      const removed = withoutTrailingSlash(path);
      if (!files.some((file) => file === removed || isUnder(file, removed))) {
        throw new CliError("invalid-args", `feature \`${feature}\` regenerates by removing \`${path}\`, which names nothing in the working tree`);
      }
    }
    if (!existsSync(join(root, "node_modules"))) {
      throw new CliError(
        "invalid-args",
        `feature \`${feature}\` regenerates with ${describeCommand(regenerate.run)}, which needs the root's node_modules — run \`bun install\``,
      );
    }
  }
}

function regenerateTree(root: string, target: string, config: FeatureManifest, regenerating: readonly string[], run: CurateRunner): void {
  if (regenerating.length === 0) return;
  withLinkedModules(root, target, () => {
    for (const feature of regenerating) {
      const regenerate = config[feature]?.regenerate;
      if (regenerate === undefined) continue;
      const [command, ...rest] = regenerate.run;
      if (command === undefined) continue;
      const result = run([command, ...rest], target, skeletonEnv(root, target));
      if (result.code === 0) continue;
      const tail = result.output.trimEnd().split("\n").slice(-REGENERATE_TAIL);
      throw new CliError(
        "external",
        [`feature \`${feature}\` failed to regenerate: ${describeCommand(regenerate.run)} exited ${result.code}`, ...tail].join("\n"),
      );
    }
  });
}

/** Copies the working tree at `root` into `target` minus the dropped features' directories and marked lines, then runs each kept feature's regeneration, refusing before writing anything and removing what it wrote when the copy fails. @public */
export function curateTree(
  request: CurateRequest,
  list: (root: string) => string[] = listWorkingTree,
  run: CurateRunner = runCommand,
): CurateReport {
  const { root, target, config } = request;
  const features = Object.keys(config);
  const plan = resolveFeatures(config, request.selection);
  const dropped = new Set(plan.dropped);
  const regenerating =
    plan.dropped.length === 0
      ? []
      : featureGraph(config).order.filter((feature) => plan.kept.includes(feature) && config[feature]?.regenerate !== undefined);
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
  assertRegenerable(root, files, config, regenerating);
  const manifest = locateManifest(root, files, request.manifest);
  const leavesManifest = plan.kept.length === 0;
  const directories = owned.filter(({ feature }) => dropped.has(feature)).map(({ directory }) => directory);
  const regenerated = regenerating.flatMap((feature) => (config[feature]?.regenerate?.remove ?? []).map(withoutTrailingSlash));
  const kept = files.filter(
    (file) =>
      !(file === manifest && leavesManifest) &&
      !directories.some((directory) => isUnder(file, directory)) &&
      !regenerated.some((path) => file === path || isUnder(file, path)),
  );

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
    regenerateTree(root, target, config, regenerating, run);
  } catch (error) {
    removeWritten(target, created);
    throw error;
  }

  return {
    files: kept,
    kept: plan.kept,
    dropped: plan.dropped,
    added: plan.added,
    directories,
    seams,
    manifest: leavesManifest ? manifest : undefined,
    regenerated: regenerating,
  };
}

const curateFlags = {
  keep: { type: "string" as const, description: "Comma-separated features to keep, with what they require; every other feature is dropped" },
  drop: { type: "string" as const, description: "Comma-separated features to leave out, with what requires them (default: none, a plain copy)" },
  list: { type: "boolean" as const, description: "Print the feature graph and copy nothing" },
  config: { type: "string" as const, description: `Feature manifest module (default: ${DEFAULT_FEATURE_MANIFEST})` },
  root: { type: "string" as const, description: "Repository working directory (default: the working directory)" },
};

function parseFeatureNames(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((feature) => feature.trim())
    .filter((feature) => feature !== "");
}

function describeAdditions(report: CurateReport, selection: FeatureSelection): string {
  const reason = "keep" in selection ? "required by" : "requires";
  return report.added.map(({ feature, because }) => `${feature} (${reason} ${because.join(", ")})`).join(", ") || "(none)";
}

function describeRegenerated(report: CurateReport, config: FeatureManifest): string {
  const runs = report.regenerated.map((feature) => `${feature} (${describeCommand(config[feature]?.regenerate?.run ?? [])})`);
  return runs.join(", ") || "(none)";
}

/** Builds the `forge curate <dir>` CLI `Command`. @public */
export function createCurateCommand(): Command<typeof curateFlags> {
  return createCommand({
    name: "curate",
    description: "Copy the working tree into a fresh directory, keeping the features --keep names or leaving out the ones --drop names",
    flags: curateFlags,
    args: { kind: "max", max: 1 },
    async run(args, flags, ctx) {
      if (flags.keep !== undefined && flags.drop !== undefined) {
        throw new CliError("invalid-args", "--keep and --drop cannot be combined — name the features to keep, or the ones to drop");
      }
      if (flags.list === true && (args.length > 0 || flags.keep !== undefined || flags.drop !== undefined)) {
        throw new CliError("invalid-args", "--list prints the feature graph and copies nothing — it takes no target, --keep or --drop");
      }
      if (flags.list !== true && args.length === 0) {
        throw new CliError("invalid-args", "forge curate needs a target directory, or --list to print the feature graph");
      }
      const cwd = process.cwd();
      const root = resolve(cwd, flags.root ?? ".");
      const config = await loadFeatures({ root, ...(flags.config === undefined ? {} : { path: flags.config }) });
      const print = ctx?.io.stdout ?? console.log;
      if (flags.list === true) {
        for (const line of describeFeatureGraph(config)) print(line);
        return;
      }

      const target = resolve(cwd, args[0] ?? "");
      const selection: FeatureSelection =
        flags.keep === undefined ? { drop: parseFeatureNames(flags.drop) } : { keep: parseFeatureNames(flags.keep) };
      const report = curateTree({ root, target, config, selection, manifest: flags.config ?? DEFAULT_FEATURE_MANIFEST });

      for (const line of definitionList(
        [
          { term: "files:", description: `${report.files.length} copied to ${target}` },
          { term: "kept:", description: report.kept.join(", ") || "(none)" },
          { term: "dropped:", description: report.dropped.join(", ") || "(none — a plain copy)" },
          { term: "added:", description: describeAdditions(report, selection) },
          { term: "removed:", description: report.directories.join(", ") || "(no directories)" },
          { term: "seams:", description: report.seams.map((seam) => `${seam.file} −${seam.removed}`).join(", ") || "(no lines)" },
          { term: "regenerated:", description: describeRegenerated(report, config) },
          { term: "manifest:", description: report.manifest === undefined ? "(kept, or outside the working tree)" : `${report.manifest} left out` },
        ],
        { indent: 2, gap: 1 },
      )) {
        print(line);
      }
    },
  });
}
