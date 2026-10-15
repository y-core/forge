import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { captureStreams } from "../cli/proc";
import type { SpawnSync } from "../cli/types";

const PACKAGE = "@y-core/forge";

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function runStep(command: string, args: string[], cwd: string, spawn?: SpawnSync): void {
  const { code, stderr } = captureStreams(command, args, { cwd }, spawn);
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited ${code}\n${stderr}`);
}

/** Replaces the forge installed under `root` with this checkout, packed as it would be published. */
export function syncForge(root: string, spawn?: SpawnSync): void {
  const installed = join(root, "node_modules", PACKAGE);
  if (!existsSync(installed)) throw new Error(`no ${PACKAGE} installed under ${root} — run \`bun i\` first`);

  const staging = mkdtempSync(join(tmpdir(), "forge-sync-"));
  const tarball = join(staging, "forge.tgz");
  try {
    runStep("bun", ["pm", "pack", "--ignore-scripts", "--quiet", "--filename", tarball], CHECKOUT, spawn);
    rmSync(installed, { force: true, recursive: true });
    mkdirSync(installed, { recursive: true });
    runStep("tar", ["-xzf", tarball, "-C", installed, "--strip-components=1"], root, spawn);
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  const root = process.cwd();
  const name = (JSON.parse(readFileSync(join(CHECKOUT, "package.json"), "utf-8")) as { name: string }).name;
  if (name !== PACKAGE) throw new Error(`${CHECKOUT} is ${name}, not ${PACKAGE}`);
  syncForge(root);
  console.log(`synced ${PACKAGE} into ${root} from ${CHECKOUT}`);
}
