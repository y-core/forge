import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { installedAppRoot } from "../../src/tooling/cli/app-root";

/** The installed `warden/` directory — the parent of `src/`, since this module lives inside it.
 *  Derived from this module's own path and never from cwd. @public */
export const WARDEN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The canon root — the fleet corpus, served rather than copied. @public */
export const CANON_ROOT = resolve(WARDEN_ROOT, "canon");

/** The only tree a sync writes from. @public */
export const CLAUDE_ROOT = resolve(WARDEN_ROOT, "claude");

/** The nearest ancestor of `from` holding a `package.json`, or `undefined` when there is none. @public */
export function walkUpToRepo(from: string): string | undefined {
  let current = resolve(from);
  for (;;) {
    if (existsSync(resolve(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** The name a repository publishes under, or `undefined` when it declares none.
 *
 *  Read at each call site rather than threaded through `OpenOptions`: the field would then reach
 *  every `openIndex` and `rebuild` caller, and each of the four builds already holds the root. @public */
export function packageNameOf(root: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
    const name = (parsed as { name?: unknown }).name;
    return typeof name === "string" && name !== "" ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Resolves the repository warden acts on: `--root`, then `WARDEN_REPO_ROOT`, then the app warden
 *  is installed into, then the nearest package root above `cwd`.
 *
 *  The variable is `WARDEN_REPO_ROOT`, not `WARDEN_ROOT`: that name belongs to the installed
 *  `warden/` directory above, and exporting its value into the environment would silently point
 *  every command at the library instead of the repository. @public */
export function resolveRepoRoot(explicit?: string, env: Record<string, string | undefined> = process.env, cwd = process.cwd()): string {
  if (explicit !== undefined && explicit !== "") return resolve(explicit);
  const stated = env.WARDEN_REPO_ROOT;
  if (stated !== undefined && stated !== "") return resolve(stated);
  const installed = installedAppRoot();
  if (installed !== undefined) return installed;
  const walked = walkUpToRepo(cwd);
  if (walked !== undefined) return walked;
  throw new Error(
    "Cannot determine the repository root: warden is not installed under a node_modules directory and no package.json was found above the working directory. Pass it explicitly — warden <command> --root=<path>.",
  );
}
