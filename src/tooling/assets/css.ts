import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import { hashFile } from "./hash";
import { safeJoin } from "./paths";
import type { CssBuild } from "./types";

/** Builds a Tailwind CSS bundle and writes it to `opts.outDir`. */
export function buildCSS(cssBuild: CssBuild, opts: { outDir: string; minify?: boolean; hash?: boolean }): Record<string, string> {
  const output = safeJoin(opts.outDir, cssBuild.output);
  const outDirPath = dirname(output);
  const shouldHash = opts.hash ?? false;
  const ext = extname(cssBuild.output);
  const targetStem = basename(cssBuild.output, ext);

  try {
    // Only this entry's own files: a sibling entry writing into the same directory must survive.
    for (const entry of readdirSync(outDirPath, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name.endsWith(ext) &&
        !entry.name.startsWith(".") &&
        (entry.name === `${targetStem}${ext}` || entry.name.startsWith(`${targetStem}.`))
      ) {
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
  const stem = cssBuild.output.slice(0, cssBuild.output.length - ext.length);
  const hashedRelative = `${stem}.${hash}${ext}`;

  renameSync(output, safeJoin(opts.outDir, hashedRelative));

  return { [cssBuild.output]: hashedRelative };
}
