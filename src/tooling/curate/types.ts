import { v } from "../../validation/mod";

/** Whether `path` stays inside the root it is read against: relative, with no `..` segment and no leading `./`. */
function isTreePath(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("./")) return false;
  return !path.split("/").includes("..");
}

const TreePathSchema = v.pipe(v.string(), v.nonEmpty(), v.check(isTreePath, "must be root-relative with no `..` segment"));

/** The spelling a feature name takes in the manifest and in every marker that names it. @internal */
export const FEATURE_NAME = /^[a-z][a-z0-9-]*$/;

const FeatureNameSchema = v.pipe(v.string(), v.regex(FEATURE_NAME, "must be lowercase letters, digits and `-`, starting with a letter"));

/** One feature: the directories it owns outright, and the files holding its `feature:<feature>` markers. */
const FeatureSchema = v.pipe(
  v.strictObject({ directories: v.array(TreePathSchema), seams: v.array(TreePathSchema) }),
  v.check((feature) => feature.directories.length + feature.seams.length > 0, "a feature must name something to remove"),
);

/** The feature manifest `config/features.ts` default-exports. @public */
export const FeatureManifestSchema = v.pipe(
  v.record(FeatureNameSchema, FeatureSchema),
  v.check((features) => Object.keys(features).length > 0, "a manifest must name a feature"),
);

/** The manifest as written, before validation. @public */
export type FeatureManifest = v.InferInput<typeof FeatureManifestSchema>;

/** One feature as validated. @public */
export type Feature = v.InferOutput<typeof FeatureSchema>;

/** One curation: which working tree, where its copy goes, and which features the copy leaves out. @public */
export interface CurateRequest {
  /** The working tree copied from. */
  root: string;
  /** A directory that is absent or empty. */
  target: string;
  config: FeatureManifest;
  /** Feature names; an empty list copies every feature. */
  drop: readonly string[];
  /** The manifest module `config` was loaded from, resolved against `root`; left out of the copy once every feature is dropped. */
  manifest?: string;
}

/** The lines the curation removed from one file. @public */
export interface SeamEdit {
  file: string;
  removed: number;
}

/** What a curation wrote. @public */
export interface CurateReport {
  /** Root-relative paths copied into the target. */
  files: readonly string[];
  dropped: readonly string[];
  /** The dropped features' directories, each with its trailing `/` dropped. */
  directories: readonly string[];
  /** Every file that lost a line, in working-tree order. */
  seams: readonly SeamEdit[];
  /** The root-relative manifest path left out of the copy, or `undefined` when the copy keeps it or the working tree does not hold it. */
  manifest: string | undefined;
}
