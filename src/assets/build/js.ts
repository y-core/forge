import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { JsBundle } from "../types";

export async function buildJS(bundle: JsBundle, opts: { outDir: string; minify?: boolean }): Promise<void> {
  const outdir = join(opts.outDir, bundle.outdir);
  // Remove stale chunk files before rebuild; esbuild generates content-hashed chunk names
  // that accumulate across builds without this cleanup.
  rmSync(join(outdir, "chunks"), { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });

  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: [bundle.entry],
    outdir,
    bundle: true,
    splitting: bundle.splitting ?? false,
    format: (bundle.format ?? "esm") as "esm" | "cjs" | "iife",
    minify: opts.minify ?? bundle.minify ?? false,
    platform: "browser",
    chunkNames: "chunks/[name]-[hash]",
  });
}
