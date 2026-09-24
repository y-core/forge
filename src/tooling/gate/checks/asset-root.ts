import { existsSync, readFileSync } from "node:fs";
import { posix, relative, resolve } from "node:path";

import { loadConfig } from "../../assets/config";
import { iconTarget } from "../../assets/icons";
import { SITE_OUTPUTS } from "../../assets/types";
import { stripJsonc } from "../../cli/jsonc";
import { checkResult, fail, warn } from "../finding";
import type { CheckResult, Finding } from "../types";
import type { AssetRootCheckConfig } from "./types";

interface WranglerAssets {
  directory?: string;
  run_worker_first?: unknown;
}

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

/** Compares the files the assets pipeline writes into the asset-tree root against the `!`-prefixed entries of `assets.run_worker_first`. @public */
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

  // A Worker with no static assets is a valid project, so this green is deliberate.
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

  const icons = resolved.icons;
  if (icons) for (const output of icons.outputs) record(iconTarget(icons, output).dir, output.file, "icons.outputs");
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
    // A file under a directory is asked for by that directory, so the rule set stops growing with
    // the file set; only a root-level output is named one by one.
    const dir = posix.dirname(path);
    const rule = dir === "/" ? path : `${dir}/*`;
    findings.push(
      fail(`\`${path}\` is written to the asset tree by \`${step}\` but \`run_worker_first\` does not exclude it`, {
        file: workerConfig,
        detail: [`add "!${rule}" to assets.run_worker_first`],
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
