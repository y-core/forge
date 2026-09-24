import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** What a finished `wrangler` run leaves for an assertion. */
export interface WranglerRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `wrangler` against `cwd` and collects both streams. */
export function wrangler(args: readonly string[], cwd: string): Promise<WranglerRun> {
  // `node`, never `process.execPath`: under `bun test` that is bun, which the CLI refuses. Resolved
  // through the package, never `bunx`, which on a cold cache or against a racing install dies mid-copy.
  const cli = fileURLToPath(new URL("./bin/wrangler.js", import.meta.resolve("wrangler/package.json")));
  const child = spawn("node", [cli, ...args], { cwd, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf-8")));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf-8")));
  return new Promise((resolve) => child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr })));
}
