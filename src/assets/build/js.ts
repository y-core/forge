import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import type { ResolvedJsBundle } from "../types";
import { safeJoin } from "./paths";

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
    const group = byOutdir.get(key) ?? [];
    group.push(bundle);
    byOutdir.set(key, group);
  }

  const esbuild = await import("esbuild");
  const mapping: Record<string, string> = {};

  for (const [outdir, group] of byOutdir) {
    try {
      for (const entry of readdirSync(outdir, { withFileTypes: true })) {
        if (entry.isFile() && !entry.name.startsWith(".")) {
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
