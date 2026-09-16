import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "@y-core/forge";

/** This checkout, derived from this file rather than from the consumer's working directory. */
const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function run(command: string, args: string[], cwd: string): void {
  const { status, stderr } = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${status}\n${stderr}`);
}

/** Replaces the forge installed under `root` with this checkout, packed as it would be published. */
export function syncForge(root: string): void {
  const installed = join(root, "node_modules", PACKAGE);
  if (!existsSync(installed)) throw new Error(`no ${PACKAGE} installed under ${root} — run \`bun i\` first`);

  const staging = mkdtempSync(join(tmpdir(), "forge-sync-"));
  const tarball = join(staging, "forge.tgz");
  try {
    run("bun", ["pm", "pack", "--ignore-scripts", "--quiet", "--filename", tarball], CHECKOUT);
    rmSync(installed, { force: true, recursive: true });
    mkdirSync(installed, { recursive: true });
    run("tar", ["-xzf", tarball, "-C", installed, "--strip-components=1"], root);
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
