import { spawn } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const FORGE = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(FORGE, "src", "tooling", "root", "bin.ts");

/** What a finished command leaves for an assertion. */
export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** What `collect` runs a command under besides its directory. */
export interface CollectOptions {
  readonly env?: Record<string, string | undefined>;
  /** Kills the command once this long has passed, so the run answers a failing code instead of hanging the spec. */
  readonly timeoutMs?: number;
}

/** Runs `command` from `cwd` and collects both streams. */
export function collect(command: string, args: readonly string[], cwd: string, options: CollectOptions = {}): Promise<CliRun> {
  const child = spawn(command, [...args], { cwd, env: options.env ?? process.env });
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => child.kill(), options.timeoutMs);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf-8")));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf-8")));
  return new Promise((resolve) =>
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    }),
  );
}

/** Runs `wrangler` against `cwd`. */
export function wrangler(args: readonly string[], cwd: string): Promise<CliRun> {
  // `node`, never `process.execPath`: under `bun test` that is bun, which the CLI refuses. Resolved
  // through the package, never `bunx`, which on a cold cache or against a racing install dies mid-copy.
  const cli = fileURLToPath(new URL("./bin/wrangler.js", import.meta.resolve("wrangler/package.json")));
  return collect("node", [cli, ...args], cwd, { env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
}

/** Runs `forge db` against the app at `root`, from forge's own checkout. */
export function forgeDb(root: string, args: readonly string[]): Promise<CliRun> {
  return collect("bun", ["run", BIN, "db", ...args, "--root", root], FORGE);
}
