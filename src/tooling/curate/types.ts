import { v } from "../../validation/mod";
import type { CaptureResult } from "../cli/types";

/** Whether `path` stays inside the root it is read against: relative, with no `..` segment and no leading `./`. */
function isTreePath(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("./")) return false;
  return !path.split("/").includes("..");
}

const TreePathSchema = v.pipe(v.string(), v.nonEmpty(), v.check(isTreePath, "must be root-relative with no `..` segment"));

/** The spelling a feature name takes in the manifest and in every marker that names it. @internal */
export const FEATURE_NAME = /^[a-z][a-z0-9-]*$/;

const FeatureNameSchema = v.pipe(v.string(), v.regex(FEATURE_NAME, "must be lowercase letters, digits and `-`, starting with a letter"));

const RegenerateSchema = v.strictObject({
  remove: v.optional(v.array(TreePathSchema)),
  run: v.pipe(
    v.array(v.pipe(v.string(), v.nonEmpty())),
    v.check((argv) => argv.length > 0, "must name a command"),
  ),
});

/** One feature: the directories and files it owns outright, its `package.json` scripts, the files holding its `feature:<feature>` markers, the features it needs, and how it regenerates. */
const FeatureSchema = v.pipe(
  v.strictObject({
    directories: v.array(TreePathSchema),
    files: v.optional(v.array(TreePathSchema)),
    scripts: v.optional(v.array(v.pipe(v.string(), v.nonEmpty()))),
    seams: v.array(TreePathSchema),
    requires: v.optional(v.array(FeatureNameSchema)),
    regenerate: v.optional(RegenerateSchema),
  }),
  v.check(
    (feature) => feature.directories.length + (feature.files?.length ?? 0) + (feature.scripts?.length ?? 0) + feature.seams.length > 0,
    "a feature must name something to remove",
  ),
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

/** A feature's post-copy regeneration step as validated. @public */
export type FeatureRegeneration = v.InferOutput<typeof RegenerateSchema>;

/** The features a curation names: those it keeps, with what they require, or those it drops, with what requires them. @public */
export type FeatureSelection = { readonly keep: readonly string[] } | { readonly drop: readonly string[] };

/** A feature the graph added to a selection, and the selected features that brought it in. @public */
export interface FeatureAddition {
  feature: string;
  because: readonly string[];
}

/** Runs one command inside the curated tree and answers how it exited. @public */
export type CurateRunner = (argv: readonly [string, ...string[]], cwd: string, env: typeof process.env) => CaptureResult;

/** One curation: which working tree, where its copy goes, and which features the copy leaves out. @public */
export interface CurateRequest {
  /** The working tree copied from. */
  root: string;
  /** A directory that is absent or empty. */
  target: string;
  config: FeatureManifest;
  /** `{ drop: [] }` copies every feature; `{ keep: [] }` drops every one. */
  selection: FeatureSelection;
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
  /** The features the copy holds, in manifest order. */
  kept: readonly string[];
  /** The features the copy leaves out once the graph has resolved the selection, in manifest order. */
  dropped: readonly string[];
  /** Features the graph added to the selection, in manifest order. */
  added: readonly FeatureAddition[];
  /** The dropped features' directories, each with its trailing `/` dropped. */
  directories: readonly string[];
  /** The files the dropped features own, left out of the copy. */
  ownedFiles: readonly string[];
  /** The dropped features' `package.json` scripts, removed from the copy's. */
  scripts: readonly string[];
  /** Every file that lost a line, in working-tree order. */
  seams: readonly SeamEdit[];
  /** The root-relative manifest path left out of the copy, or `undefined` when the copy keeps it or the working tree does not hold it. */
  manifest: string | undefined;
  /** The kept features whose regeneration ran, in the order they ran. */
  regenerated: readonly string[];
}

/** The requirement edges a manifest declares: a topological order, each feature's direct dependents, and each one's transitive requirements. @internal */
export interface FeatureGraph {
  order: readonly string[];
  requiredBy: ReadonlyMap<string, readonly string[]>;
  closure: ReadonlyMap<string, ReadonlySet<string>>;
}

/** A selection resolved against the graph: what the copy keeps and drops, each in manifest order, and why the graph added what was not named. @internal */
export interface FeatureResolution {
  mode: "keep" | "drop";
  kept: readonly string[];
  dropped: readonly string[];
  added: readonly FeatureAddition[];
}
