import { existsSync, readFileSync } from "node:fs";
import { posix, relative, resolve } from "node:path";
import { loadConfig } from "../../../../assets/config";
import { SITE_OUTPUTS } from "../../../../assets/types";
import { stripJsonc } from "../../../cf/config/jsonc";
import { type CheckResult, checkResult, type Finding, fail, warn } from "../finding";

/** What the asset-root check needs to find both halves of the coupling. @public */
export interface AssetRootCheckConfig {
  /** Application root. Both config paths resolve against it. */
  root: string;
  /** Assets config path, relative to `root`. */
  assetConfig: string;
  /** Wrangler config path, relative to `root`. Defaults to `wrangler.jsonc`. */
  workerConfig?: string;
}

interface WranglerAssets {
  directory?: string;
  run_worker_first?: unknown;
}

/** Normalises a wrangler `assets.directory` or a build `outDir` to a root-relative path. @internal */
function normaliseDir(root: string, dir: string): string {
  return relative(root, resolve(root, dir));
}

/**
 * The URL path a file lands on, given the asset root and the directory the build step wrote it to.
 * Returns `null` when the step writes outside the served tree, which is not this check's business.
 *
 * @internal
 */
function servedPath(assetsDir: string, outDir: string, file: string): string | null {
  const within = relative(assetsDir, outDir);
  if (within.startsWith("..")) return null;
  return `/${posix.join(within, file)}`;
}

/**
 * Compares the files the assets pipeline writes into the asset-tree root against the `!`-prefixed
 * entries of `assets.run_worker_first`.
 *
 * The two lists are otherwise kept in step by hand, and the failure is silent: an emitted root file
 * that nothing excludes is fetched through the Worker on every page load, which is an invocation
 * bought for nothing — and for a generated `robots.txt` or `sitemap.xml`, a 404 rather than the
 * file.
 *
 * **The two directions are not equally serious.** A missing exclusion fails: it is the cost this
 * coupling exists to avoid. A `!` entry naming nothing the pipeline emits only warns — an app may
 * legitimately exclude a hand-authored static file — but it is usually a name left behind by an
 * outputs list that moved on.
 *
 * @public
 */
export async function checkAssetRoot(config: AssetRootCheckConfig): Promise<CheckResult> {
  const { root } = config;
  const workerConfig = config.workerConfig ?? "wrangler.jsonc";
  const workerPath = resolve(root, workerConfig);

  if (!existsSync(workerPath)) {
    return checkResult([fail(`\`${workerConfig}\` not found`, { file: workerConfig })], "asset-root exclusions: no worker config");
  }

  let assets: WranglerAssets;
  try {
    const parsed = JSON.parse(stripJsonc(readFileSync(workerPath, "utf-8"))) as { assets?: WranglerAssets };
    assets = parsed.assets ?? {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return checkResult([fail(`\`${workerConfig}\` is not parseable: ${message}`, { file: workerConfig })], "asset-root exclusions: unparseable");
  }

  if (assets.directory === undefined) {
    return checkResult([], "asset-root exclusions: no static assets configured");
  }

  const resolved = await loadConfig({ root, configPath: config.assetConfig });
  const assetsDir = normaliseDir(root, assets.directory);

  const emitted = new Map<string, string>();
  const record = (outDir: string, file: string, step: string): void => {
    const path = servedPath(assetsDir, normaliseDir(root, outDir), file);
    if (path !== null) emitted.set(path, step);
  };

  for (const output of resolved.icons?.outputs ?? []) record(resolved.icons?.outDir ?? "", output.file, "icons.outputs");
  for (const file of resolved.site ? SITE_OUTPUTS : []) record(resolved.site?.outDir ?? "", file, "site");

  const rules = Array.isArray(assets.run_worker_first) ? assets.run_worker_first.filter((rule): rule is string => typeof rule === "string") : [];
  const excluded = new Set(rules.filter((rule) => rule.startsWith("!")).map((rule) => rule.slice(1)));

  // A prefix exclusion such as `!/assets/*` covers everything beneath it, so a file it already
  // reaches needs no name of its own.
  const coveredByGlob = (path: string): boolean =>
    [...excluded].some((rule) => rule.endsWith("*") && path.startsWith(rule.slice(0, -1)) && rule.length > 1);

  const findings: Finding[] = [];

  for (const [path, step] of [...emitted].sort()) {
    if (excluded.has(path) || coveredByGlob(path)) continue;
    findings.push(
      fail(`\`${path}\` is written to the asset root by \`${step}\` but \`run_worker_first\` does not exclude it`, {
        file: workerConfig,
        detail: [`add "!${path}" to assets.run_worker_first`],
      }),
    );
  }

  for (const rule of [...excluded].sort()) {
    if (rule.endsWith("*") || emitted.has(rule)) continue;
    findings.push(
      warn(`\`!${rule}\` excludes a path no build step writes to the asset root`, {
        file: workerConfig,
        detail: ["remove it, or leave it if a hand-authored file lives there"],
      }),
    );
  }

  return checkResult(findings, `asset-root exclusions: ${emitted.size} emitted, ${excluded.size} excluded`);
}
