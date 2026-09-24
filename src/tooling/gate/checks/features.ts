import { existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { capture } from "../../cli/proc";
import { curateTree } from "../../curate/commands";
import { DEFAULT_FEATURE_MANIFEST, loadFeatures } from "../../curate/config";
import type { FeatureManifest } from "../../curate/types";
import { checkResult, fail } from "../finding";
import type { CheckResult, Finding } from "../types";
import type { CurateRunner, FeaturesCheckConfig } from "./types";

const TAIL = 120;

const runInTree: CurateRunner = (argv, cwd, env) => capture(argv[0], argv.slice(1), { cwd, env });

function tail(output: string): string[] {
  return output.trimEnd().split("\n").slice(-TAIL);
}

/** Each feature dropped alone, then every feature together when the manifest names more than one. @internal */
export function defaultFeatureProfiles(features: readonly string[]): string[][] {
  const each = features.map((feature) => [feature]);
  return features.length > 1 ? [...each, [...features]] : each;
}

function describeProfile(drop: readonly string[]): string {
  return `--drop ${drop.join(",")}`;
}

/** A manifest the curation kept must name exactly the features it kept, or the skeleton's own curation would reach for what is gone. */
async function checkKeptManifest(tree: string, config: FeatureManifest, drop: readonly string[]): Promise<string | undefined> {
  if (!existsSync(join(tree, DEFAULT_FEATURE_MANIFEST))) return undefined;
  const expected = Object.keys(config).filter((feature) => !drop.includes(feature));
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
  drop: readonly string[],
  tree: string,
  run: CurateRunner,
): Promise<Finding | undefined> {
  const { root } = check;
  const label = describeProfile(drop);
  try {
    curateTree({ root, target: tree, config, drop, manifest: DEFAULT_FEATURE_MANIFEST });
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    return fail(`${label}: ${error.message}`);
  }
  symlinkSync(join(root, "node_modules"), join(tree, "node_modules"), "dir");

  const stale = await checkKeptManifest(tree, config, drop);
  if (stale !== undefined) return fail(`${label}: ${stale}`);

  // Bun resolves a module through the linked node_modules to its real path, which lies outside the tree; a config deriving a
  // repository-relative path from `import.meta.resolve` would then name the demonstrator's copy and not the skeleton's.
  const env = { ...process.env, FORGE_APP_ROOT: tree, NODE_PRESERVE_SYMLINKS: "1" };

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
  drop: readonly string[],
  run: CurateRunner,
): Promise<Finding | undefined> {
  const tree = mkdtempSync(join(tmpdir(), "forge-curate-"));
  try {
    return await gateSkeleton(check, config, drop, tree, run);
  } finally {
    const link = join(tree, "node_modules");
    if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() === true) unlinkSync(link);
    rmSync(tree, { recursive: true, force: true });
  }
}

/** Curates the working tree once per profile, each into its own temporary directory, and runs that skeleton's `standard` gate there. @public */
export async function checkFeatures(check: FeaturesCheckConfig, run: CurateRunner = runInTree): Promise<CheckResult> {
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
  for (const drop of profiles) {
    const finding = await gateProfile(check, config, drop, run);
    if (finding !== undefined) return checkResult([finding], "");
  }
  return checkResult([], `features: ${profiles.map(describeProfile).join("; ")} each passed its standard gate`);
}
