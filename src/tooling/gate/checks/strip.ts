import { existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../../cli/errors";
import { capture } from "../../cli/proc";
import { stripTree } from "../../strip/commands";
import { DEFAULT_STRIP_CONFIG, loadStripConfig } from "../../strip/config";
import { checkResult, fail } from "../finding";
import type { CheckResult, Finding } from "../types";
import type { StripCheckConfig, StripRunner } from "./types";

const TAIL = 120;

const runInTree: StripRunner = (argv, cwd, env) => capture(argv[0], argv.slice(1), { cwd, env });

function tail(output: string): string[] {
  return output.trimEnd().split("\n").slice(-TAIL);
}

async function gateSkeleton(config: StripCheckConfig, tree: string, run: StripRunner): Promise<CheckResult> {
  const { root } = config;
  let files: number;
  try {
    files = stripTree({ root, target: tree, config: await loadStripConfig({ root }), manifest: DEFAULT_STRIP_CONFIG }).files.length;
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    return checkResult([fail(error.message)], "strip: no skeleton produced");
  }

  const modules = join(root, "node_modules");
  if (!existsSync(modules)) return checkResult([fail("no node_modules under the root to link — run `bun install`")], "");
  symlinkSync(modules, join(tree, "node_modules"), "dir");

  // Bun resolves a module through the linked node_modules to its real path, which lies outside the tree; a config deriving a
  // repository-relative path from `import.meta.resolve` would then name the demonstrator's copy and not the skeleton's.
  const env = { ...process.env, FORGE_APP_ROOT: tree, NODE_PRESERVE_SYMLINKS: "1" };
  const failed = (message: string, output: string): Finding => fail(message, { detail: tail(output) });

  if (config.assetConfig !== undefined) {
    const out = config.assetOut ?? ".forge/assets.ts";
    const build = run(["forge", "assets", "build", "all", "--minify", "--root", tree, "--config", config.assetConfig, "--out", out], tree, env);
    if (build.code !== 0) return checkResult([failed("the skeleton's asset build failed", build.output)], "");
  }

  const verify = run(["forge", "verify", "--mode", "standard"], tree, env);
  if (verify.code !== 0) return checkResult([failed("the skeleton's standard gate failed", verify.output)], "");
  return checkResult([], `strip: a ${files}-file skeleton passed its standard gate`);
}

/** Strips the working tree into a temporary directory and runs the skeleton's own `standard` gate there. @public */
export async function checkStrip(config: StripCheckConfig, run: StripRunner = runInTree): Promise<CheckResult> {
  const tree = mkdtempSync(join(tmpdir(), "forge-strip-"));
  try {
    return await gateSkeleton(config, tree, run);
  } finally {
    const link = join(tree, "node_modules");
    if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink() === true) unlinkSync(link);
    rmSync(tree, { recursive: true, force: true });
  }
}
