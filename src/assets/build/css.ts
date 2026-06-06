import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { CssBuild } from "../types";
import { hashFile } from "./hash";
import { safeJoin } from "./paths";

/**
 * Builds a Tailwind CSS bundle and writes it to `opts.outDir`.
 *
 * **Output directory ownership:** `buildCSS` removes all `.css` files in `dirname(output)`
 * on each rebuild (to purge stale hashed filenames). Do not place hand-authored `.css` files
 * alongside generated output — they will be deleted. The path containment guard ensures
 * deletions stay within `opts.outDir`.
 */
export function buildCSS(cssBuild: CssBuild, opts: { outDir: string; minify?: boolean; hash?: boolean }): Record<string, string> {
  const output = safeJoin(opts.outDir, cssBuild.output);
  const outDirPath = dirname(output);
  const shouldHash = opts.hash ?? false;

  // Clean up previous CSS files (hashed or not) before rebuild.
  try {
    for (const entry of readdirSync(outDirPath, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".css")) {
        rmSync(join(outDirPath, entry.name));
      }
    }
  } catch {
    /* dir may not exist yet */
  }

  mkdirSync(outDirPath, { recursive: true });

  const args = ["-i", cssBuild.input, "-o", output];
  if (opts.minify) args.push("--minify");

  execFileSync("tailwindcss", args, { stdio: "inherit" });

  if (!shouldHash) {
    return { [cssBuild.output]: cssBuild.output };
  }

  const hash = hashFile(output);
  const ext = extname(cssBuild.output);
  const stem = cssBuild.output.slice(0, cssBuild.output.length - ext.length);
  const hashedRelative = `${stem}.${hash}${ext}`;

  renameSync(output, join(opts.outDir, hashedRelative));

  return { [cssBuild.output]: hashedRelative };
}
