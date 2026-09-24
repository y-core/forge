import { existsSync, lstatSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { curateTree, listWorkingTree, runCommand, skeletonEnv, withLinkedModules } from "../../curate/commands";
import { DEFAULT_FEATURE_MANIFEST, loadFeatures } from "../../curate/config";
import { resolveFeatures } from "../../curate/graph";
import type { CurateRunner, FeatureManifest } from "../../curate/types";
import { checkResult, fail } from "../finding";
import type { CheckResult, Finding } from "../types";
import type { FeaturesCheckConfig } from "./types";

const TAIL = 120;

function tail(output: string): string[] {
  return output.trimEnd().split("\n").slice(-TAIL);
}

/** Each feature dropped alone, then every feature together; the graph resolves each and the check proves each resolved set once. @internal */
export function defaultFeatureProfiles(features: readonly string[]): string[][] {
  return [...features.map((feature) => [feature]), [...features]];
}

interface ResolvedProfile {
  drop: readonly string[];
  label: string;
  dropped: readonly string[];
}

function resolveProfile(config: FeatureManifest, drop: readonly string[]): ResolvedProfile | Finding {
  const named = `--drop ${drop.join(",")}`;
  try {
    const { dropped, added } = resolveFeatures(config, { drop });
    const label = added.length === 0 ? named : `${named} (+ ${added.map(({ feature }) => feature).join(", ")})`;
    return { drop, label, dropped };
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    return fail(`${named}: ${error.message}`);
  }
}

/** A manifest the curation kept must name exactly the features it kept, or the skeleton's own curation would reach for what is gone. */
async function checkKeptManifest(tree: string, expected: readonly string[]): Promise<string | undefined> {
  if (!existsSync(join(tree, DEFAULT_FEATURE_MANIFEST))) return undefined;
  let named: string[];
  try {
    named = Object.keys(await loadFeatures({ root: tree }));
  } catch (error) {
    return `the skeleton's manifest does not load: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (named.length === expected.length && named.every((feature) => expected.includes(feature))) return undefined;
  return `the skeleton's manifest names ${named.join(", ") || "nothing"} where the skeleton keeps ${expected.join(", ")} — wrap each feature's entry in a \`feature:<feature>\` region`;
}

async function gateSkeleton(
  check: FeaturesCheckConfig,
  config: FeatureManifest,
  profile: ResolvedProfile,
  tree: string,
  run: CurateRunner,
): Promise<Finding | undefined> {
  const { root } = check;
  const { label } = profile;
  let kept: readonly string[];
  try {
    kept = curateTree(
      { root, target: tree, config, selection: { drop: profile.drop }, manifest: DEFAULT_FEATURE_MANIFEST },
      listWorkingTree,
      run,
    ).kept;
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    return fail(`${label}: ${error.message}`);
  }
  return withLinkedModules(root, tree, () => proveSkeleton(check, label, kept, tree, run));
}

async function proveSkeleton(
  check: FeaturesCheckConfig,
  label: string,
  kept: readonly string[],
  tree: string,
  run: CurateRunner,
): Promise<Finding | undefined> {
  const stale = await checkKeptManifest(tree, kept);
  if (stale !== undefined) return fail(`${label}: ${stale}`);

  const env = skeletonEnv(check.root, tree);

  if (check.assetConfig !== undefined) {
    const out = check.assetOut ?? ".forge/assets.ts";
    const build = run(["forge", "assets", "build", "all", "--minify", "--root", tree, "--config", check.assetConfig, "--out", out], tree, env);
    if (build.code !== 0) return fail(`${label}: the skeleton's asset build failed`, { detail: tail(build.output) });
  }

  const verify = run(["forge", "verify", "--mode", "standard"], tree, env);
  if (verify.code !== 0) return fail(`${label}: the skeleton's standard gate failed`, { detail: tail(verify.output) });
  return undefined;
}

/** An empty list proves no skeleton and an empty drop proves only a plain copy, so either would pass green having proved nothing. */
function refuseProfiles(profiles: readonly (readonly string[])[]): Finding | undefined {
  if (profiles.length === 0) return fail("`profiles` is empty — the check would prove no skeleton; omit it for the defaults");
  const empty = profiles.findIndex((drop) => drop.length === 0);
  return empty === -1 ? undefined : fail(`profile ${empty + 1} drops no feature — it would prove a plain copy, not a skeleton`);
}

async function gateProfile(
  check: FeaturesCheckConfig,
  config: FeatureManifest,
  profile: ResolvedProfile,
  run: CurateRunner,
): Promise<Finding | undefined> {
  const tree = mkdtempSync(join(tmpdir(), "forge-curate-"));
  try {
    return await gateSkeleton(check, config, profile, tree, run);
  } finally {
    const link = join(tree, "node_modules");
    if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() === true) unlinkSync(link);
    rmSync(tree, { recursive: true, force: true });
  }
}

function sameDropped(a: ResolvedProfile, b: ResolvedProfile): boolean {
  return a.dropped.length === b.dropped.length && a.dropped.every((feature) => b.dropped.includes(feature));
}

/** Curates the working tree once per distinct resolved profile, each into its own temporary directory, and runs that skeleton's `standard` gate there. @public */
export async function checkFeatures(check: FeaturesCheckConfig, run: CurateRunner = runCommand): Promise<CheckResult> {
  let config: FeatureManifest;
  try {
    config = await loadFeatures({ root: check.root });
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    return checkResult([fail(error.message)], "features: no skeleton produced");
  }
  if (!existsSync(join(check.root, "node_modules"))) return checkResult([fail("no node_modules under the root to link — run `bun install`")], "");

  const profiles = check.profiles ?? defaultFeatureProfiles(Object.keys(config));
  const refusal = refuseProfiles(profiles);
  if (refusal !== undefined) return checkResult([refusal], "features: no skeleton produced");
  const distinct: ResolvedProfile[] = [];
  for (const drop of profiles) {
    const profile = resolveProfile(config, drop);
    if ("level" in profile) return checkResult([profile], "features: no skeleton produced");
    if (!distinct.some((other) => sameDropped(other, profile))) distinct.push(profile);
  }
  for (const profile of distinct) {
    const finding = await gateProfile(check, config, profile, run);
    if (finding !== undefined) return checkResult([finding], "");
  }
  return checkResult([], `features: ${distinct.map((profile) => profile.label).join("; ")} each passed its standard gate`);
}
