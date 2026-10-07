import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

import type { Metafile } from "esbuild";

import { safeJoin } from "./paths";
import { bundler } from "./peers";
import type { JsBuildResult, ResolvedJsBundle } from "./types";

type JsSubGroupOptions = {
  format: NonNullable<ResolvedJsBundle["format"]>;
  splitting: boolean;
  define: ResolvedJsBundle["define"];
  conditions: ResolvedJsBundle["conditions"];
  minify: boolean;
};

/** Whether a file in the output directory is one of this group's own, hashed (`main-A1B2.js`) or not. */
function ownsOutput(name: string, stems: ReadonlySet<string>): boolean {
  const stem = basename(name, extname(name));
  return stems.has(stem) || [...stems].some((own) => stem.startsWith(`${own}-`));
}

/** Every output reachable from `roots` through static imports, roots and CSS bundles included; a dynamic import ends the walk. @internal */
export function staticImportClosure(outputs: Metafile["outputs"], roots: Iterable<string>): Set<string> {
  const reached = new Set<string>();
  const pending = [...roots];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    const meta = outputs[path];
    if (meta === undefined || reached.has(path)) continue;
    reached.add(path);
    pending.push(...meta.imports.filter((imported) => imported.kind === "import-statement").map((imported) => imported.path));
    if (meta.cssBundle !== undefined) pending.push(meta.cssBundle);
  }
  return reached;
}

/** Bundles JavaScript entries with esbuild and writes them to `opts.outDir`, answering the entry mapping and the shell a service worker precaches. */
export async function buildJS(bundles: ResolvedJsBundle[], opts: { outDir: string; minify?: boolean; hash?: boolean }): Promise<JsBuildResult> {
  if (bundles.length === 0) return { mapping: {}, precache: [] };

  const shouldHash = opts.hash ?? false;
  const absPublicDir = resolve(opts.outDir);

  const byOutdir = new Map<string, ResolvedJsBundle[]>();
  for (const bundle of bundles) {
    const key = safeJoin(absPublicDir, bundle.outdir);
    // The schema rejects this too. Repeated here because the clean below is destructive and a
    // programmatic caller reaches this function without passing through the schema at all.
    if (key === absPublicDir) {
      throw new Error(`buildJS: outdir ${JSON.stringify(bundle.outdir)} resolves to the asset root, which this would clean before writing into it`);
    }
    const group = byOutdir.get(key) ?? [];
    group.push(bundle);
    byOutdir.set(key, group);
  }

  const esbuild = await bundler("js.bundles");
  const mapping: Record<string, string> = {};
  const precache: string[] = [];

  for (const [outdir, group] of byOutdir) {
    // Only this group's own outputs: a sibling writing into the same directory must survive, which
    // is what `css.ts` and `sprites.ts` already do.
    const stems = new Set(group.map((bundle) => basename(bundle.entry, extname(bundle.entry))));
    try {
      for (const entry of readdirSync(outdir, { withFileTypes: true })) {
        if (entry.isFile() && !entry.name.startsWith(".") && ownsOutput(entry.name, stems)) {
          rmSync(join(outdir, entry.name));
        }
      }
    } catch {
      /* dir may not exist yet */
    }
    rmSync(join(outdir, "chunks"), { recursive: true, force: true });
    mkdirSync(outdir, { recursive: true });

    const bySubKey = new Map<string, { options: JsSubGroupOptions; bundles: ResolvedJsBundle[] }>();
    for (const bundle of group) {
      const options: JsSubGroupOptions = {
        format: bundle.format ?? "esm",
        splitting: bundle.splitting ?? false,
        define: bundle.define,
        conditions: bundle.conditions,
        minify: bundle.minify ?? opts.minify ?? false,
      };
      const subKey = JSON.stringify([options.format, options.splitting, options.define ?? {}, options.conditions ?? null, options.minify]);
      const sub = bySubKey.get(subKey) ?? { options, bundles: [] };
      sub.bundles.push(bundle);
      bySubKey.set(subKey, sub);
    }

    for (const { options, bundles: subGroup } of bySubKey.values()) {
      const result = await esbuild.build({
        entryPoints: subGroup.map((b) => b.entry),
        outdir,
        bundle: true,
        splitting: options.splitting,
        format: options.format,
        minify: options.minify,
        platform: "browser",
        jsx: "automatic",
        jsxImportSource: "@y-core/forge/render/jsx",
        chunkNames: "chunks/[name]-[hash]",
        entryNames: shouldHash ? "[name]-[hash]" : "[name]",
        metafile: true,
        ...(options.define !== undefined ? { define: options.define } : {}),
        ...(options.conditions !== undefined ? { conditions: options.conditions } : {}),
      });

      const metaOutputs = result.metafile?.outputs ?? {};
      const toRelPath = (outPath: string): string => relative(absPublicDir, resolve(outPath)).replace(/\\/g, "/");
      const emitted = Object.entries(metaOutputs).map(([outPath, meta]) => ({
        outPath,
        relPath: toRelPath(outPath),
        entryPoint: meta.entryPoint === undefined ? undefined : resolve(meta.entryPoint),
      }));
      const shellEntries = new Set(subGroup.filter((bundle) => bundle.precache !== false).map((bundle) => resolve(bundle.entry)));
      const shellRoots = emitted.filter(({ entryPoint }) => entryPoint !== undefined && shellEntries.has(entryPoint)).map(({ outPath }) => outPath);
      precache.push(...[...staticImportClosure(metaOutputs, shellRoots)].map(toRelPath));
      for (const bundle of subGroup) {
        const absEntry = resolve(bundle.entry);
        for (const { relPath, entryPoint } of emitted) {
          if (entryPoint === absEntry) mapping[`${bundle.outdir}/${basename(bundle.entry, extname(bundle.entry))}.js`] = relPath;
        }
      }
    }
  }

  return { mapping, precache };
}
