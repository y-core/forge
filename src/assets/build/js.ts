import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import type { JsBundle } from "../types";

export async function buildJS(
  bundle: JsBundle,
  opts: { outDir: string; minify?: boolean; hash?: boolean },
): Promise<Record<string, string>> {
  const outdir = join(opts.outDir, bundle.outdir);
  const shouldHash = opts.hash ?? false;

  // Clean up previous entry files (hashed or not) before rebuild.
  try {
    for (const entry of readdirSync(outdir, { withFileTypes: true })) {
      if (entry.isFile() && !entry.name.startsWith(".")) {
        rmSync(join(outdir, entry.name));
      }
    }
  } catch {
    /* dir may not exist yet */
  }

  // Remove stale chunk files; esbuild generates content-hashed chunk names that accumulate.
  rmSync(join(outdir, "chunks"), { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });

  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [bundle.entry],
    outdir,
    bundle: true,
    splitting: bundle.splitting ?? false,
    format: (bundle.format ?? "esm") as "esm" | "cjs" | "iife",
    minify: opts.minify ?? bundle.minify ?? false,
    platform: "browser",
    chunkNames: "chunks/[name]-[hash]",
    entryNames: shouldHash ? "[name]-[hash]" : "[name]",
    metafile: true,
  });

  const mapping: Record<string, string> = {};
  const absPublicDir = resolve(opts.outDir);

  for (const [outPath, meta] of Object.entries(result.metafile.outputs)) {
    if (meta.entryPoint === bundle.entry) {
      const relPath = relative(absPublicDir, resolve(outPath)).replace(/\\/g, "/");
      const logicalName = `${basename(bundle.entry, extname(bundle.entry))}.js`;
      mapping[`${bundle.outdir}/${logicalName}`] = relPath;
    }
  }

  return mapping;
}
