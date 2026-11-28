import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import { v } from "../../../validation/mod";
import type { EvalTask, EvalTaskSpec } from "./types";

const ID = /^[a-z][a-z0-9-]*$/;

function isTreePath(path: string): boolean {
  return !path.startsWith("/") && !path.startsWith("./") && !path.split("/").includes("..");
}

const TreePathSchema = v.pipe(v.string(), v.nonEmpty(), v.check(isTreePath, "must be relative with no `..` segment"));

const IdSchema = v.pipe(v.string(), v.regex(ID, "must be lowercase letters, digits and `-`, starting with a letter"));

const DetectorSchema = v.variant("kind", [
  v.strictObject({
    kind: v.literal("rg"),
    pattern: v.pipe(v.string(), v.nonEmpty()),
    paths: v.pipe(v.array(TreePathSchema), v.nonEmpty()),
    pcre: v.optional(v.boolean()),
  }),
  v.strictObject({ kind: v.literal("step"), label: v.pipe(v.string(), v.nonEmpty()) }),
  v.strictObject({ kind: v.literal("test"), file: TreePathSchema }),
]);

const TaskSpecSchema = v.pipe(
  v.strictObject({
    id: IdSchema,
    tree: v.picklist(["forge", "consumer"]),
    model: v.pipe(v.string(), v.nonEmpty()),
    timeoutMinutes: v.pipe(v.number(), v.integer(), v.minValue(1)),
    bait: v.optional(v.array(TreePathSchema), []),
    accept: v.pipe(v.array(TreePathSchema), v.nonEmpty()),
    traps: v.array(
      v.strictObject({ id: IdSchema, rules: v.pipe(v.array(v.pipe(v.string(), v.nonEmpty())), v.nonEmpty()), detector: DetectorSchema }),
    ),
  }),
  v.check((spec) => new Set(spec.traps.map((trap) => trap.id)).size === spec.traps.length, "trap ids must be unique"),
);

function requiredFiles(dir: string, spec: EvalTaskSpec): string[] {
  const testDetectors = spec.traps.flatMap((trap) => (trap.detector.kind === "test" ? [trap.detector.file] : []));
  return [
    "prompt.md",
    "reference.patch",
    ...spec.traps.map((trap) => join("plants", `${trap.id}.patch`)),
    ...spec.bait,
    ...[...spec.accept, ...testDetectors].map((file) => join("accept", file)),
  ].filter((file) => !existsSync(join(dir, file)));
}

/** Reads and validates `<dir>/task.json`, refusing a spec that names a file the directory does not hold. */
export function loadTask(dir: string): EvalTask {
  const root = resolve(dir);
  const specPath = join(root, "task.json");
  if (!existsSync(specPath)) throw new Error(`${specPath} is missing`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(specPath, "utf-8"));
  } catch (error) {
    throw new Error(`${specPath} is not JSON`, { cause: error });
  }
  const parsed = v.safeParse(TaskSpecSchema, json);
  if (!parsed.success) {
    const detail = parsed.issues.map((issue) => `${v.getDotPath(issue) ?? "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`${specPath}: ${detail}`);
  }
  const spec: EvalTaskSpec = parsed.output;
  if (spec.id !== basename(root)) throw new Error(`${specPath}: id ${spec.id} does not match its directory ${basename(root)}`);
  const missing = requiredFiles(root, spec);
  if (missing.length > 0) throw new Error(`${root} is missing ${missing.join(", ")}`);
  return { ...spec, dir: root };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/** Hashes every file in a task directory, path and content, so a changed spec is never compared as the same task. */
export function specHash(dir: string): string {
  const hash = createHash("sha256");
  for (const file of filesUnder(dir)) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(join(dir, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
