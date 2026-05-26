import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CssBuild } from "../types";

export function buildCSS(cssBuild: CssBuild, opts: { outDir: string; minify?: boolean }): void {
  const output = join(opts.outDir, cssBuild.output);
  mkdirSync(dirname(output), { recursive: true });

  const args = ["-i", cssBuild.input, "-o", output];
  if (opts.minify) args.push("--minify");

  execFileSync("tailwindcss", args, { stdio: "inherit" });
}
