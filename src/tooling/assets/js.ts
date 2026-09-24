import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

import { safeJoin } from "./paths";
import { bundler } from "./peers";
import type { ResolvedJsBundle } from "./types";

/** Whether a file in the output directory is one of this group's own, hashed (`main-A1B2.js`) or not. */
function ownsOutput(name: string, stems: ReadonlySet<string>): boolean {
  const stem = basename(name, extname(name));
  return stems.has(stem) || [...stems].some((own) => stem.startsWith(`${own}-`));
}

/** Bundles JavaScript entries with esbuild and writes them to `opts.outDir`. */
export async function buildJS(
  bundles: ResolvedJsBundle[],
  opts: { outDir: string; minify?: boolean; hash?: boolean },
): Promise<Record<string, string>> {
  if (bundles.length === 0) return {};

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

    const bySubKey = new Map<string, ResolvedJsBundle[]>();
    for (const bundle of group) {
      const subKey = `${bundle.format ?? "esm"}:${bundle.splitting ?? false}:${JSON.stringify(bundle.define ?? {})}`;
      const sub = bySubKey.get(subKey) ?? [];
      sub.push(bundle);
      bySubKey.set(subKey, sub);
    }

    for (const [subKey, subGroup] of bySubKey) {
      const [format = "esm", splittingStr = "false"] = subKey.split(":");
      const splitting = splittingStr === "true";
      const define = subGroup[0]?.define;

      const result = await esbuild.build({
        entryPoints: subGroup.map((b) => b.entry),
        outdir,
        bundle: true,
        splitting,
        format: format as "esm" | "cjs" | "iife",
        minify: opts.minify ?? false,
        platform: "browser",
        jsx: "automatic",
        jsxImportSource: "@y-core/forge/jsx",
        chunkNames: "chunks/[name]-[hash]",
        entryNames: shouldHash ? "[name]-[hash]" : "[name]",
        metafile: true,
        ...(define !== undefined ? { define } : {}),
      });

      for (const bundle of subGroup) {
        const absEntry = resolve(bundle.entry);
        for (const [outPath, meta] of Object.entries(result.metafile?.outputs ?? {})) {
          if (meta.entryPoint && resolve(meta.entryPoint) === absEntry) {
            const relPath = relative(absPublicDir, resolve(outPath)).replace(/\\/g, "/");
            const logicalName = `${basename(bundle.entry, extname(bundle.entry))}.js`;
            mapping[`${bundle.outdir}/${logicalName}`] = relPath;
          }
        }
      }
    }
  }

  return mapping;
}
