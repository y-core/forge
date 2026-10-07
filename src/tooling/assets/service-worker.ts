import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import type { Plugin } from "esbuild";

import { assetUrlBase } from "./paths";
import { bundler } from "./peers";
import type { ResolvedServiceWorkerBuild } from "./types";

// At the deploy root, so it is served from `/sw.js` and its default scope is the whole origin.
/** The worker's filename in the deploy root. @internal */
export const SERVICE_WORKER_FILE = "sw.js";
const PRECACHE_NAMESPACE = "forge-precache";
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

function precachePlugin(precache: readonly string[], version: string): Plugin {
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

/** Bundles the service worker, unhashed, to `sw.js` in `opts.outDir`, with `precache` and `version` as the `PRECACHE_URLS` and `PRECACHE_VERSION` it imports. @public */
export async function buildServiceWorker(
  serviceWorker: ResolvedServiceWorkerBuild,
  opts: { outDir: string; precache: readonly string[]; version: string; minify?: boolean },
): Promise<string> {
  const esbuild = await bundler("js.serviceWorker");
  const outfile = resolve(opts.outDir, SERVICE_WORKER_FILE);
  await esbuild.build({
    entryPoints: [serviceWorker.entry],
    outfile,
    bundle: true,
    format: "iife",
    minify: serviceWorker.minify ?? opts.minify ?? false,
    platform: "browser",
    jsx: "automatic",
    jsxImportSource: "@y-core/forge/render/jsx",
    banner: { js: SERVICE_WORKER_BANNER },
    plugins: [precachePlugin(opts.precache, opts.version)],
    ...(serviceWorker.define !== undefined ? { define: serviceWorker.define } : {}),
    ...(serviceWorker.conditions !== undefined ? { conditions: serviceWorker.conditions } : {}),
  });
  return outfile;
}

/** Deletes `sw.js` from `outDir` when this build wrote it, leaving a hand-written one in place. @internal */
export function removeServiceWorker(outDir: string): void {
  const file = resolve(outDir, SERVICE_WORKER_FILE);
  if (!existsSync(file) || !readFileSync(file, "utf-8").startsWith(SERVICE_WORKER_BANNER)) return;
  rmSync(file);
}
