import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { createCommand } from "../cli/command";
import { CliError } from "../cli/errors";
import type { Command } from "../cli/types";
import { definitionList } from "../term/grid";
import { DEFAULT_STRIP_CONFIG, loadStripConfig } from "./config";
import type { SeamEdit, StripReport, StripRequest, StripSeam } from "./types";

/** The working tree's files, root-relative: tracked and untracked alike, minus what `.gitignore` excludes and what is no longer on disk. @internal */
export function listWorkingTree(root: string): string[] {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf-8" });
  if (result.error !== undefined || result.status !== 0) {
    throw new CliError("external", `git ls-files failed in ${root} — forge strip copies a git working tree`);
  }
  const listed = [...new Set((result.stdout ?? "").split("\0").filter((path) => path !== ""))];
  return listed.filter((path) => lstatSync(join(root, path), { throwIfNoEntry: false }) !== undefined);
}

function assertFreshTarget(target: string): void {
  if (!existsSync(target)) return;
  if (!statSync(target).isDirectory()) throw new CliError("invalid-args", `${target} is not a directory`);
  if (readdirSync(target).length > 0) throw new CliError("invalid-args", `${target} is not empty — forge strip writes only into a fresh directory`);
}

function isUnder(path: string, directory: string): boolean {
  return path.startsWith(`${directory}/`);
}

function isMarked(line: string, marker: string): boolean {
  return line.trimEnd().endsWith(marker);
}

function assertNoDirectoryEntry(root: string, kept: readonly string[]): void {
  const directory = kept.find((file) => lstatSync(join(root, file), { throwIfNoEntry: false })?.isDirectory() === true);
  if (directory === undefined) return;
  throw new CliError(
    "invalid-args",
    `\`${directory}\` is a directory git does not list inside — a nested repository or a submodule, which forge strip cannot copy`,
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
          `\`${path}\` lies under \`${ancestor}\`, a symbolic link — forge strip reads and writes only through real directories`,
        );
      }
      real.add(ancestor);
    }
  }
}

function readSeamLines(root: string, file: string): string[] {
  if (lstatSync(join(root, file), { throwIfNoEntry: false })?.isSymbolicLink() === true) {
    throw new CliError("invalid-args", `seam file \`${file}\` is a symbolic link — forge strip edits only a regular file`);
  }
  return readFileSync(join(root, file), "utf-8").split("\n");
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

function assertNoUnlistedMarker(root: string, kept: readonly string[], seams: readonly StripSeam[]): void {
  const seamFiles = new Set(seams.map((seam) => seam.file));
  const markers = [...new Set(seams.map((seam) => seam.marker))];
  for (const file of kept) {
    if (seamFiles.has(file) || lstatSync(join(root, file), { throwIfNoEntry: false })?.isFile() !== true) continue;
    const lines = readText(join(root, file))?.split("\n") ?? [];
    for (const [index, line] of lines.entries()) {
      const marker = markers.find((candidate) => isMarked(line, candidate));
      if (marker === undefined) continue;
      throw new CliError(
        "invalid-args",
        `\`${file}:${index + 1}\` ends with seam marker \`${marker}\`, but \`${file}\` is not a seam in the manifest`,
      );
    }
  }
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

/** Copies the working tree at `root` into `target` minus the manifest's directories and marked lines, refusing before writing anything and removing what it wrote when the copy fails. @public */
export function stripTree(request: StripRequest, list: (root: string) => string[] = listWorkingTree): StripReport {
  const { root, target, config } = request;
  assertFreshTarget(target);

  const files = list(root);
  const directories = config.directories.map((directory) => directory.replace(/\/+$/, ""));
  for (const directory of directories) {
    if (!files.some((file) => isUnder(file, directory))) {
      throw new CliError("invalid-args", `directory \`${directory}\` names nothing in the working tree`);
    }
  }
  const manifest = locateManifest(root, files, request.manifest);
  const kept = files.filter((file) => file !== manifest && !directories.some((directory) => isUnder(file, directory)));
  assertNoLinkedAncestor(root, [...kept, ...config.seams.map((seam) => seam.file)]);
  assertNoDirectoryEntry(root, kept);

  const edited = new Map<string, string[]>();
  const seams: SeamEdit[] = [];
  for (const { file, marker } of config.seams) {
    if (!files.includes(file)) throw new CliError("invalid-args", `seam file \`${file}\` is not in the working tree`);
    if (file === manifest) throw new CliError("invalid-args", `seam file \`${file}\` is the strip manifest, which the strip leaves out`);
    const removedWith = directories.find((directory) => isUnder(file, directory));
    if (removedWith !== undefined) {
      throw new CliError("invalid-args", `seam file \`${file}\` lies inside removed directory \`${removedWith}\``);
    }
    const lines = edited.get(file) ?? readSeamLines(root, file);
    const remaining = lines.filter((line) => !isMarked(line, marker));
    if (remaining.length === lines.length) throw new CliError("invalid-args", `seam \`${marker}\` matches no line in \`${file}\``);
    edited.set(file, remaining);
    seams.push({ file, marker, removed: lines.length - remaining.length });
  }
  assertNoUnlistedMarker(root, kept, config.seams);

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

  return { files: kept, directories, seams, manifest };
}

const stripFlags = {
  config: { type: "string" as const, description: `Strip manifest module (default: ${DEFAULT_STRIP_CONFIG})` },
  root: { type: "string" as const, description: "Repository working directory (default: the working directory)" },
};

/** Builds the `forge strip <dir>` CLI `Command`. @public */
export function createStripCommand(): Command<typeof stripFlags> {
  return createCommand({
    name: "strip",
    description: "Copy the working tree into a fresh directory, minus the strip manifest's directories and marked lines",
    flags: stripFlags,
    args: { kind: "exact", count: 1 },
    async run(args, flags, ctx) {
      const cwd = process.cwd();
      const root = resolve(cwd, flags.root ?? ".");
      const config = await loadStripConfig({ root, ...(flags.config === undefined ? {} : { path: flags.config }) });
      const target = resolve(cwd, args[0] ?? "");
      const report = stripTree({ root, target, config, manifest: flags.config ?? DEFAULT_STRIP_CONFIG });

      const print = ctx?.io.stdout ?? console.log;
      for (const line of definitionList(
        [
          { term: "files:", description: `${report.files.length} copied to ${target}` },
          { term: "removed:", description: report.directories.join(", ") || "(no directories)" },
          { term: "seams:", description: report.seams.map((seam) => `${seam.file} −${seam.removed}`).join(", ") || "(no seams)" },
          { term: "manifest:", description: report.manifest === undefined ? "(outside the working tree)" : `${report.manifest} left out` },
        ],
        { indent: 2, gap: 1 },
      )) {
        print(line);
      }
    },
  });
}
