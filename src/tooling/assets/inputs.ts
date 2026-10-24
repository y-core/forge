import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { BuildOptions } from "esbuild";

import { importClosure } from "./closure";
import { loadConfig } from "./config";
import { isCssSourceCovered, readCssDeclaration } from "./css-declaration";
import { jsBuildOptions, jsBuildShape } from "./js";
import { safeJoin } from "./paths";
import { bundler } from "./peers";
import { SERVICE_WORKER_FILE, serviceWorkerBuildOptions } from "./service-worker";
import type { ResolvedConfig } from "./types";

const REMOTE_SOURCE = /^https?:\/\//i;
const VIRTUAL_MODULE = /^[\w-]+:/;

function repoRelative(root: string, path: string): string | undefined {
  const rel = relative(root, resolve(root, path)).split(sep).join("/");
  if (rel === "" || rel.startsWith("../") || isAbsolute(rel)) return undefined;
  return rel.split("/").includes("node_modules") ? undefined : rel;
}

async function bundleInputs(root: string, configKey: string, options: BuildOptions): Promise<string[]> {
  const esbuild = await bundler(configKey);
  const result = await esbuild.build({ ...options, absWorkingDir: root, write: false, metafile: true, logLevel: "silent" });
  return Object.keys(result.metafile.inputs)
    .filter((path) => !VIRTUAL_MODULE.test(path))
    .map((path) => resolve(root, path));
}

async function jsInputs(config: ResolvedConfig): Promise<string[]> {
  const bundles = config.js.bundles.map((bundle) =>
    bundleInputs(config.root, "js.bundles", {
      ...jsBuildOptions(jsBuildShape(bundle, undefined)),
      entryPoints: [bundle.entry],
      outdir: safeJoin(config.paths.publicDir, bundle.outdir),
    }),
  );
  const serviceWorker = config.js.serviceWorker;
  const worker =
    serviceWorker === null
      ? []
      : [
          bundleInputs(config.root, "js.serviceWorker", {
            ...serviceWorkerBuildOptions(serviceWorker, { precache: [], version: "" }),
            outfile: resolve(config.paths.publicDir, SERVICE_WORKER_FILE),
          }),
        ];
  return (await Promise.all([...bundles, ...worker])).flat();
}

async function cssInputs(config: ResolvedConfig, files: readonly string[]): Promise<string[]> {
  const declarations = await Promise.all(config.css.map((build) => readCssDeclaration(build.input)));
  return declarations.flatMap((declaration) => {
    const listed = files.map((file) => resolve(config.root, file));
    const covered = declaration.root === "none" ? listed.filter((path) => isCssSourceCovered(declaration.sources, path)) : listed;
    return [...declaration.stylesheets, ...covered];
  });
}

function statedInputs(config: ResolvedConfig): string[] {
  const local = (source: { path: string; files: readonly (string | { file: string })[] }): string[] =>
    REMOTE_SOURCE.test(source.path) ? [] : source.files.map((entry) => join(source.path, typeof entry === "string" ? entry : entry.file));
  const stated = [
    ...config.copy.map((entry) => entry.from),
    ...config.rasters.map((entry) => entry.from),
    ...Object.values(config.sprites).flatMap((group) => group.sources.flatMap(local)),
    ...(config.icons === null ? [] : [config.icons.src]),
    ...config.fonts.subsets.map((subset) => resolve(config.root, subset.from)),
    ...config.marks.map((mark) => resolve(config.root, mark.from)),
    ...(config.cursors?.sources ?? []).flatMap((source) => [...local(source), join(source.template.path, source.template.file)]),
  ];
  const missing = stated.find((path) => !existsSync(path));
  if (missing !== undefined) throw new Error(`[forge-assets] the asset config names ${missing}, which does not exist`);
  return stated;
}

/** Every repository file the asset build under `assetConfigPath` reads, relative to `root` and without `node_modules`, matched against the work-tree listing `files`; rejects on an input that does not resolve. @public */
export async function assetInputs(root: string, assetConfigPath: string, files: readonly string[]): Promise<string[]> {
  const config = await loadConfig({ root, configPath: assetConfigPath });
  const [closure, js, css] = await Promise.all([importClosure(root, [resolve(root, assetConfigPath)]), jsInputs(config), cssInputs(config, files)]);
  const inputs = [...closure, ...js, ...css, ...statedInputs(config)].map((path) => repoRelative(root, path));
  return [...new Set(inputs.filter((path) => path !== undefined))].sort();
}
