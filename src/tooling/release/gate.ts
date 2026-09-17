import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { GateOutcome } from "./types";

/** The gate a release runs when its config names none. @internal */
export const DEFAULT_GATE_COMMAND: readonly string[] = ["bun", "run", "verify"];

const SCRIPT_RUNNERS = new Set(["bun", "npm", "pnpm", "yarn"]);

/** True when the command asks a package runner for a script the manifest does not declare — which every runner reports as exit 1, like a failing gate. */
function namesMissingScript(cwd: string, command: readonly string[]): boolean {
  const [runner, verb, script] = command;
  if (runner === undefined || !SCRIPT_RUNNERS.has(runner) || verb !== "run" || script === undefined) return false;
  const manifest = join(cwd, "package.json");
  if (!existsSync(manifest)) return true;
  try {
    const scripts = (JSON.parse(readFileSync(manifest, "utf-8")) as { scripts?: Record<string, string> }).scripts;
    return scripts === undefined || !Object.hasOwn(scripts, script);
  } catch {
    return false;
  }
}

/** Runs the gate command in `cwd`, streaming its output, and answers what it did. @internal */
export function runGate(cwd: string, command: readonly string[] = DEFAULT_GATE_COMMAND): GateOutcome {
  if (namesMissingScript(cwd, command)) return "unrunnable";
  const [bin, ...args] = command;
  if (bin === undefined) return "unrunnable";
  const result = spawnSync(bin, args, { cwd, stdio: "inherit" });
  if (result.error !== undefined) return "unrunnable";
  return result.status === 0 ? "passed" : "failed";
}
