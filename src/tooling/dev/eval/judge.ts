import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { capture, captureStreams } from "../../cli/proc";
import type { SpawnSync } from "../../cli/types";
import { headSha, step } from "./scaffold";
import type { AddedLine, EvalTask, EvalTrap, RunChange, TrapFiring } from "./types";

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const RG_HIT = /^(\d+):/;

function newPath(header: string): string | undefined {
  const path = header.slice("+++ ".length).split("\t")[0] ?? "";
  if (path === "/dev/null") return undefined;
  return path.startsWith("b/") ? path.slice(2) : path;
}

/** Every line a unified diff adds, with the file it lands in and its line number there. */
export function addedLines(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file: string | undefined;
  let line = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const text of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (text.startsWith("+")) {
        if (file !== undefined) added.push({ file, line, text: text.slice(1) });
        line += 1;
        newLeft -= 1;
      } else if (text.startsWith("-")) {
        oldLeft -= 1;
      } else if (!text.startsWith("\\")) {
        line += 1;
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    if (text.startsWith("+++ ")) {
      file = newPath(text);
      continue;
    }
    const hunk = HUNK.exec(text);
    if (hunk === null) continue;
    oldLeft = Number(hunk[1] ?? "1");
    line = Number(hunk[2]);
    newLeft = Number(hunk[3] ?? "1");
  }
  return added;
}

function underAny(file: string, paths: readonly string[]): boolean {
  return paths.some((path) => file === path || file.startsWith(path.endsWith("/") ? path : `${path}/`));
}

function rgHits(pattern: string, pcre: boolean, lines: readonly AddedLine[], spawn?: SpawnSync): AddedLine[] {
  if (lines.length === 0) return [];
  const args = ["--no-config", "--line-number", ...(pcre ? ["-P"] : []), "-e", pattern, "-"];
  const result = captureStreams("rg", args, { input: lines.map((line) => line.text).join("\n") + "\n" }, spawn);
  if (result.code === 1 && result.exited) return [];
  if (result.code !== 0) throw new Error(`rg ${args.join(" ")} exited ${result.code}\n${result.stderr}`);
  return result.stdout.split("\n").flatMap((out) => {
    const hit = RG_HIT.exec(out);
    const line = hit === null ? undefined : lines[Number(hit[1]) - 1];
    return line === undefined ? [] : [line];
  });
}

function withFilesCopiedIn<T>(task: EvalTask, tree: string, files: readonly string[], body: () => T): T {
  const displaced = new Map<string, Buffer>();
  try {
    for (const file of files) {
      const target = join(tree, file);
      if (existsSync(target)) displaced.set(target, readFileSync(target));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(task.dir, "accept", file), target);
    }
    return body();
  } finally {
    for (const file of files) {
      const target = join(tree, file);
      const original = displaced.get(target);
      if (original === undefined) rmSync(target, { force: true });
      else writeFileSync(target, original);
    }
  }
}

function testsPass(task: EvalTask, tree: string, files: readonly string[], spawn?: SpawnSync): boolean {
  return withFilesCopiedIn(task, tree, files, () => {
    const args = ["test", ...files.map((file) => `./${file}`)];
    return capture("bun", args, { cwd: tree }, spawn).code === 0;
  });
}

/** Runs a gate step with `HEAD` moved back to `base` and the tree left as it is, so a change-scoped row sees the run's whole change as pending. */
function stepPassesOnChange(label: string, tree: string, base: string, spawn?: SpawnSync): boolean {
  const head = headSha(tree, spawn);
  step("git", ["reset", "-q", "--soft", base], tree, spawn);
  try {
    return capture("bun", ["run", "verify", "--only", label], { cwd: tree }, spawn).code === 0;
  } finally {
    step("git", ["reset", "-q", "--soft", head], tree, spawn);
  }
}

/** Runs one trap's detector against a tree and the change its author made; `fires` means the trap was fallen into. */
export function runTrap(task: EvalTask, trap: EvalTrap, tree: string, change: RunChange, spawn?: SpawnSync): TrapFiring {
  const detector = trap.detector;
  switch (detector.kind) {
    case "rg": {
      const lines = addedLines(change.diff).filter((line) => underAny(line.file, detector.paths));
      const hits = rgHits(detector.pattern, detector.pcre === true, lines, spawn);
      return { fires: hits.length > 0, hits };
    }
    case "step":
      return { fires: !stepPassesOnChange(detector.label, tree, change.base, spawn), hits: [] };
    case "test":
      return { fires: !testsPass(task, tree, [detector.file], spawn), hits: [] };
  }
}

/** Copies the task's acceptance tests into the tree, runs them, and removes them again; true when every one passes. */
export function runAcceptance(task: EvalTask, tree: string, spawn?: SpawnSync): boolean {
  return testsPass(task, tree, task.accept, spawn);
}
