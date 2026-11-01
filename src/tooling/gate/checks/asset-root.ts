import { posix, relative, resolve } from "node:path";

import { loadConfig } from "../../assets/config";
import { iconTarget } from "../../assets/icons";
import { deployRoot } from "../../assets/paths";
import { SERVICE_WORKER_FILE } from "../../assets/service-worker";
import { SITE_OUTPUTS } from "../../assets/types";
import { listDeployments } from "../../cf/config/environment";
import type { WranglerAssetsConfig } from "../../cf/types";
import { checkResult, fail, warn } from "../finding";
import type { CheckResult, Finding } from "../types";
import type { AssetRootCheckConfig } from "./types";
import { readWorkerConfig } from "./worker-config";

/** Normalises a wrangler `assets.directory` or a build `outDir` to a root-relative path. @internal */
function normaliseDir(root: string, dir: string): string {
  return relative(root, resolve(root, dir));
}

/** The URL path a file lands on, given the asset root and the directory the build step wrote it to. @internal */
function servedPath(assetsDir: string, outDir: string, file: string): string | null {
  const within = relative(assetsDir, outDir);
  if (within.startsWith("..")) return null;
  return `/${posix.join(within, file)}`;
}

type AssetPipeline = Awaited<ReturnType<typeof loadConfig>>;

/** One deployment's `run_worker_first` exclusions against the files the pipeline writes into its asset root. */
function judgeAssets(
  root: string,
  resolved: AssetPipeline,
  assets: WranglerAssetsConfig & { directory: string },
  prefix: string,
  workerConfig: string,
): { findings: Finding[]; emitted: number; excluded: number } {
  const key = prefix === "" ? "run_worker_first" : `${prefix}assets.run_worker_first`;
  const assetsDir = normaliseDir(root, assets.directory);

  const emitted = new Map<string, string>();
  const record = (outDir: string, file: string, step: string): void => {
    const path = servedPath(assetsDir, normaliseDir(root, outDir), file);
    if (path !== null) emitted.set(path, step);
  };

  const icons = resolved.icons;
  if (icons) for (const output of icons.outputs) record(iconTarget(icons, output).dir, output.file, "icons.outputs");
  for (const file of resolved.site ? SITE_OUTPUTS : []) record(resolved.site?.outDir ?? "", file, "site");
  if (resolved.js.serviceWorker !== null) record(deployRoot(root, resolved.paths.publicDir), SERVICE_WORKER_FILE, "js.serviceWorker");

  const rules = Array.isArray(assets.run_worker_first) ? assets.run_worker_first : [];
  const excluded = new Set(rules.filter((rule) => rule.startsWith("!")).map((rule) => rule.slice(1)));

  const coveredByGlob = (path: string): boolean =>
    [...excluded].some((rule) => rule.endsWith("*") && path.startsWith(rule.slice(0, -1)) && rule.length > 1);

  const findings: Finding[] = [];

  for (const [path, step] of [...emitted].sort()) {
    if (excluded.has(path) || coveredByGlob(path)) continue;
    const dir = posix.dirname(path);
    const rule = dir === "/" ? path : `${dir}/*`;
    findings.push(
      fail(`\`${path}\` is written to the asset tree by \`${step}\` but \`${key}\` does not exclude it`, {
        file: workerConfig,
        detail: [`add "!${rule}" to ${prefix}assets.run_worker_first`],
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

  return { findings, emitted: emitted.size, excluded: excluded.size };
}

/** Compares the files the assets pipeline writes into each deployment's asset-tree root against the `!`-prefixed entries of its `assets.run_worker_first`. @public */
export async function checkAssetRoot(config: AssetRootCheckConfig): Promise<CheckResult> {
  const { root } = config;
  const workerConfig = config.workerConfig ?? "wrangler.jsonc";
  const read = readWorkerConfig(root, workerConfig, "asset-root exclusions");
  if (!("config" in read)) return read;

  const judged = listDeployments(read.config).flatMap(({ prefix, effective, inherited }) => {
    const directory = effective.assets?.directory;
    if (inherited.has("assets") || directory === undefined) return [];
    return [{ prefix, assets: { ...effective.assets, directory } }];
  });
  if (judged.length === 0) {
    return checkResult([], "asset-root exclusions: no static assets configured");
  }

  const resolved = await loadConfig({ root, configPath: config.assetConfig });
  const verdicts = judged.map(({ prefix, assets }) => judgeAssets(root, resolved, assets, prefix, workerConfig));
  const findings = verdicts.flatMap((verdict) => verdict.findings);
  const emitted = verdicts.reduce((sum, verdict) => sum + verdict.emitted, 0);
  const excluded = verdicts.reduce((sum, verdict) => sum + verdict.excluded, 0);
  return checkResult(findings, `asset-root exclusions: ${emitted} emitted, ${excluded} excluded`);
}
