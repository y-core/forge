import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { stripJsonc } from "../cli/jsonc";
import { jsBuildOptions } from "./js";
import { assetUrlBase } from "./paths";
import { bundler } from "./peers";
import type { EsbuildBuildOptions, EsbuildPlugin, ResolvedServiceWorkerBuild, ServiceWorkerRecord } from "./types";

// At the deploy root, so it is served from `/sw.js` and its default scope is the whole origin.
/** The worker's filename in the deploy root. @internal */
export const SERVICE_WORKER_FILE = "sw.js";
/** The file beside the generated assets module that records what the last build read for the worker and wrote. @internal */
export const SERVICE_WORKER_RECORD = "sw.inputs.json";
const PRECACHE_NAMESPACE = "forge-precache";
const VIRTUAL_MODULE = /^[\w-]+:/;
/** The digest a record gives a resolution file that did not exist when the worker was built. @internal */
export const ABSENT_FILE = "absent";
const TSCONFIG = "tsconfig.json";
const PACKAGE_JSON = "package.json";
/** The first line of every `sw.js` this build writes, which marks it as safe to delete. @internal */
export const SERVICE_WORKER_BANNER = "/* @y-core/forge service worker */";

/** Turns paths under the asset root into the URLs a page requests them by, sorted and without repeats. @internal */
export function precacheUrls(publicPrefix: string, paths: Iterable<string>): string[] {
  const base = assetUrlBase(publicPrefix);
  return [...new Set([...paths].map((path) => `${base}/${path}`))].sort();
}

function listFilesSorted(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return listFilesSorted(path);
      return entry.isFile() ? [path] : [];
    });
}

/** Digests the relative path and bytes of every file under `publicDir` but the absolute paths in `exclude`, so any change to what is deployed changes it. @internal */
export function precacheVersion(publicDir: string, exclude: Iterable<string>): string {
  const excluded = new Set([...exclude].map((path) => resolve(path)));
  const hash = createHash("sha256");
  for (const file of listFilesSorted(publicDir).filter((path) => !excluded.has(resolve(path)))) {
    const bytes = readFileSync(file);
    hash.update(`${relative(publicDir, file).replace(/\\/g, "/")}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function precachePlugin(precache: readonly string[], version: string): EsbuildPlugin {
  return {
    name: PRECACHE_NAMESPACE,
    setup(build) {
      build.onResolve({ filter: /^@y-core\/forge\/assets\/precache$/ }, () => ({ path: "precache", namespace: PRECACHE_NAMESPACE }));
      build.onLoad({ filter: /.*/, namespace: PRECACHE_NAMESPACE }, () => ({
        contents: `export const PRECACHE_URLS = ${JSON.stringify(precache)};\nexport const PRECACHE_VERSION = ${JSON.stringify(version)};`,
        loader: "js",
      }));
    },
  };
}

/** The esbuild options the service worker builds with, its output file aside. @internal */
export function serviceWorkerBuildOptions(
  serviceWorker: ResolvedServiceWorkerBuild,
  opts: { precache: readonly string[]; version: string; minify?: boolean | undefined },
): EsbuildBuildOptions {
  return {
    ...jsBuildOptions({
      format: "iife",
      splitting: false,
      define: serviceWorker.define,
      conditions: serviceWorker.conditions,
      minify: serviceWorker.minify ?? opts.minify ?? false,
    }),
    entryPoints: [serviceWorker.entry],
    banner: { js: SERVICE_WORKER_BANNER },
    plugins: [precachePlugin(opts.precache, opts.version)],
  };
}

type ServiceWorkerBuildOpts = { outDir: string; precache: readonly string[]; version: string; minify?: boolean | undefined };

async function bundleServiceWorker(
  serviceWorker: ResolvedServiceWorkerBuild,
  opts: ServiceWorkerBuildOpts,
): Promise<{ outfile: string; inputs: string[] }> {
  const esbuild = await bundler("js.serviceWorker");
  const outfile = resolve(opts.outDir, SERVICE_WORKER_FILE);
  const result = await esbuild.build({ ...serviceWorkerBuildOptions(serviceWorker, opts), outfile, metafile: true });
  const inputs = Object.keys(result.metafile?.inputs ?? {}).filter((path) => !VIRTUAL_MODULE.test(path));
  return { outfile, inputs: inputs.map((path) => resolve(path)) };
}

/** Bundles the service worker, unhashed, to `sw.js` in `opts.outDir`, with `precache` and `version` as the `PRECACHE_URLS` and `PRECACHE_VERSION` it imports. @public */
export async function buildServiceWorker(
  serviceWorker: ResolvedServiceWorkerBuild,
  opts: { outDir: string; precache: readonly string[]; version: string; minify?: boolean },
): Promise<string> {
  return (await bundleServiceWorker(serviceWorker, opts)).outfile;
}

/** The SHA-256 hex digest of a file's bytes. @internal */
export function fileDigest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** A path relative to `root`, with forward slashes, as a service-worker record names it. @internal */
export function recordedPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

/** Where the build records the worker's inputs, beside the generated assets module at `assetsPath`. @internal */
export function serviceWorkerRecordPath(assetsPath: string): string {
  return join(dirname(assetsPath), SERVICE_WORKER_RECORD);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, inner]) => [key, canonical(inner)]));
}

/** The SHA-256 of every esbuild option the worker builds with but its precache data and output path, with `minify` as the build was given it. @internal */
export function serviceWorkerOptionsDigest(serviceWorker: ResolvedServiceWorkerBuild, root: string, minify: boolean): string {
  const options = Object.entries(serviceWorkerBuildOptions(serviceWorker, { precache: [], version: "", minify })).filter(
    ([key]) => key !== "plugins" && key !== "entryPoints",
  );
  const shaped = { ...Object.fromEntries(options), entry: recordedPath(root, serviceWorker.entry) };
  return createHash("sha256")
    .update(JSON.stringify(canonical(shaped)))
    .digest("hex");
}

function nearestManifest(from: string, top?: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const manifest = join(dir, PACKAGE_JSON);
    if (existsSync(manifest)) return manifest;
    if (dir === top || dirname(dir) === dir) return undefined;
  }
}

function packageManifest(root: string, input: string): string | undefined {
  const segments = input.split(sep);
  const at = segments.lastIndexOf("node_modules");
  if (at === -1) return nearestManifest(dirname(input), resolve(root));
  const depth = segments[at + 1]?.startsWith("@") ? 3 : 2;
  const manifest = join(segments.slice(0, at + depth).join(sep), PACKAGE_JSON);
  return existsSync(manifest) ? manifest : undefined;
}

function resolveExtends(dir: string, specifier: string): string | undefined {
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    const path = resolve(dir, specifier);
    return [path, `${path}.json`].find((candidate) => existsSync(candidate));
  }
  try {
    return createRequire(join(dir, TSCONFIG)).resolve(specifier);
  } catch (error) {
    if (error instanceof Error) return undefined;
    throw error;
  }
}

function extendsOf(path: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stripJsonc(readFileSync(path, "utf-8")));
    const named = parsed !== null && typeof parsed === "object" && "extends" in parsed ? parsed.extends : undefined;
    const specifiers = typeof named === "string" ? [named] : Array.isArray(named) ? named.filter((entry) => typeof entry === "string") : [];
    return specifiers.flatMap((specifier) => resolveExtends(dirname(path), specifier) ?? []);
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

function tsconfigChain(root: string): string[] {
  const chain: string[] = [];
  const pending = [resolve(root, TSCONFIG)];
  for (let path = pending.shift(); path !== undefined; path = pending.shift()) {
    if (chain.includes(path) || !existsSync(path)) continue;
    chain.push(path);
    pending.push(...extendsOf(path));
  }
  return chain;
}

function resolutionFiles(root: string, inputs: readonly string[]): Record<string, string> {
  const tsconfigs = tsconfigChain(root);
  const appManifest = nearestManifest(resolve(root));
  const manifests = [...(appManifest === undefined ? [] : [appManifest]), ...inputs.flatMap((input) => packageManifest(root, input) ?? [])];
  const files = [...new Set([...tsconfigs, ...manifests])].map((path) => [recordedPath(root, path), fileDigest(path)] as const);
  const absent = [
    ...(tsconfigs.length === 0 ? [[TSCONFIG, ABSENT_FILE] as const] : []),
    ...(existsSync(resolve(root, PACKAGE_JSON)) ? [] : [[PACKAGE_JSON, ABSENT_FILE] as const]),
  ];
  return Object.fromEntries([...files, ...absent].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Bundles the service worker as `buildServiceWorker` does, then records at `recordPath` the digest of it, of its build options, of every file its bundle read and of the files that steered how those resolved. @internal */
export async function buildRecordedServiceWorker(
  serviceWorker: ResolvedServiceWorkerBuild,
  opts: ServiceWorkerBuildOpts & { root: string; recordPath: string },
): Promise<ServiceWorkerRecord> {
  const { outfile, inputs } = await bundleServiceWorker(serviceWorker, opts);
  const minify = opts.minify ?? false;
  const record: ServiceWorkerRecord = {
    entry: recordedPath(opts.root, serviceWorker.entry),
    worker: recordedPath(opts.root, outfile),
    sha256: fileDigest(outfile),
    minify,
    options: serviceWorkerOptionsDigest(serviceWorker, opts.root, minify),
    inputs: Object.fromEntries(
      inputs.map((path) => [recordedPath(opts.root, path), fileDigest(path)] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
    resolution: resolutionFiles(opts.root, inputs),
  };
  writeFileSync(opts.recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** Deletes `sw.js` from `outDir` when this build wrote it, leaving a hand-written one in place. @internal */
export function removeServiceWorker(outDir: string): void {
  const file = resolve(outDir, SERVICE_WORKER_FILE);
  if (!existsSync(file) || !readFileSync(file, "utf-8").startsWith(SERVICE_WORKER_BANNER)) return;
  rmSync(file);
}
