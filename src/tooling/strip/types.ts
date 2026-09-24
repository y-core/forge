import { v } from "../../validation/mod";

/** Whether `path` stays inside the root it is read against: relative, with no `..` segment and no leading `./`. */
function isTreePath(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("./")) return false;
  return !path.split("/").includes("..");
}

const TreePathSchema = v.pipe(v.string(), v.nonEmpty(), v.check(isTreePath, "must be root-relative with no `..` segment"));

function isCommentMarker(marker: string): boolean {
  if (marker.startsWith("/*") && marker.endsWith("*/")) return true;
  return marker.startsWith("//") || marker.startsWith("#");
}

const MarkerSchema = v.pipe(v.string(), v.check(isCommentMarker, "must be a comment — `/* … */`, or starting `//` or `#`"));

/** One line-level edit point: every line of `file` ending with `marker` is deleted. */
const StripSeamSchema = v.strictObject({ file: TreePathSchema, marker: MarkerSchema });

/** The strip manifest `config/strip.ts` default-exports. @public */
export const StripConfigSchema = v.pipe(
  v.strictObject({ directories: v.array(TreePathSchema), seams: v.array(StripSeamSchema) }),
  v.check((config) => config.directories.length + config.seams.length > 0, "a manifest must name something to remove"),
);

/** The manifest as written, before validation. @public */
export type StripConfig = v.InferInput<typeof StripConfigSchema>;

/** A seam as validated. @public */
export type StripSeam = v.InferOutput<typeof StripSeamSchema>;

/** One strip: which working tree, where its copy goes, and what the copy leaves out. @public */
export interface StripRequest {
  /** The working tree copied from. */
  root: string;
  /** A directory that is absent or empty. */
  target: string;
  config: StripConfig;
  /** The manifest module `config` was loaded from, resolved against `root` and left out of the copy. */
  manifest?: string;
}

/** The lines one seam removed from its file. @public */
export interface SeamEdit {
  file: string;
  marker: string;
  removed: number;
}

/** What a strip wrote. @public */
export interface StripReport {
  /** Root-relative paths copied into the target. */
  files: readonly string[];
  /** The manifest's directories, each with its trailing `/` dropped. */
  directories: readonly string[];
  seams: readonly SeamEdit[];
  /** The root-relative manifest path left out of the copy, or `undefined` when the working tree does not hold it. */
  manifest: string | undefined;
}
