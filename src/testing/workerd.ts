import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** What `startDevServer` needs to know about the fixture it serves. @public */
export interface DevServerOptions {
  /** Worker entry, positional to `wrangler dev` — overrides the config's `main`. */
  entry?: string;
  /** A `wrangler.jsonc` to run under, passed as `--config`. */
  config?: string;
  /** Written to a temp env file, replacing `.dev.vars` discovery. */
  vars?: Record<string, string>;
  /** Path the readiness probe fetches; any answer counts, a 404 included. Defaults to `/`. */
  readyPath?: string;
  /** Pipe stdout and stderr into `logs()` instead of discarding them. */
  capture?: boolean;
}

/** A `wrangler dev` process, the origins it answers on, and what it printed. @public */
export interface DevServer {
  origin: string;
  siteOrigin: string;
  logs(): string;
  stop(): void;
}

const READY_TIMEOUT_MS = 180_000;

/** A port nothing holds, released before the caller binds it — the CLI takes a number, not a socket. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("dev server: could not reserve a port")));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForReady(origin: string, readyPath: string, child: { killed: boolean }): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.killed) throw new Error("dev server: the wrangler process exited before it was ready");
    try {
      await fetch(`${origin}${readyPath}`, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`dev server: not ready after ${READY_TIMEOUT_MS}ms`);
}

/** One `KEY="value"` line per var, quoted so a newline or a quote in a value survives the round trip. */
function dotenv(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
}

/** Starts `wrangler dev` over a fixture and resolves once it answers. @public */
export async function startDevServer(options: DevServerOptions = {}): Promise<DevServer> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  // The dev server stamps `https` onto every origin-bearing header before the Worker sees it, so an
  // app told the http origin refuses its own suite at the origin guard.
  const siteOrigin = `https://127.0.0.1:${port}`;

  const varsDir = mkdtempSync(join(tmpdir(), "forge-workerd-"));
  const envFile = join(varsDir, "dev.vars");
  writeFileSync(envFile, dotenv({ SITE_ORIGIN: siteOrigin, ...options.vars }), "utf-8");

  const args = ["dev"];
  if (options.entry !== undefined) args.push(options.entry);
  if (options.config !== undefined) args.push("--config", options.config);
  // `--local-protocol http` is stated, never defaulted: wrangler documents http as the default but
  // serves https once it detects it is running under an agent, and the fixture's own probe — and
  // every case's `fetch` — then meets a TLS handshake on a plain socket and never sees the server.
  args.push("--env-file", envFile, "--port", String(port), "--ip", "127.0.0.1", "--local-protocol", "http");

  // Resolved through the package, never a path relative to this file: in a consumer this module sits
  // under `node_modules/@y-core/forge/`, whose sibling `node_modules` holds no wrangler.
  const cli = fileURLToPath(new URL("./bin/wrangler.js", import.meta.resolve("wrangler/package.json")));
  // `detached`: wrangler spawns workerd and esbuild as its own children, and killing the CLI alone
  // orphans them. Its own process group makes the whole tree one signal target.
  // `node`, never `process.execPath`: under `bun test` that is the bun binary, which wrangler refuses.
  const child = spawn("node", [cli, ...args], {
    stdio: options.capture === true ? ["ignore", "pipe", "pipe"] : "ignore",
    detached: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  child.unref();

  let output = "";
  const record = (chunk: Buffer): void => {
    output += chunk.toString("utf-8");
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);

  sweepOnExit();
  const stop = killer(child.pid, varsDir);
  live.add(stop);

  try {
    await waitForReady(origin, options.readyPath ?? "/", child);
  } catch (error) {
    stop();
    if (output === "") throw error;
    throw new Error(`${String(error)}\n${output}`, { cause: error });
  }

  return { origin, siteOrigin, logs: () => output, stop };
}

const live = new Set<() => void>();

function killer(pid: number | undefined, varsDir: string): () => void {
  let done = false;
  const stop = (): void => {
    if (done) return;
    done = true;
    live.delete(stop);
    rmSync(varsDir, { recursive: true, force: true });
    if (pid === undefined) return;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // the group is already gone
    }
  };
  return stop;
}

// An interrupted run never reaches `afterAll`, so the sweep is bound to the runner's own exit too.
let bound = false;
function sweepOnExit(): void {
  if (bound) return;
  bound = true;
  const sweep = (): void => {
    for (const stop of [...live]) stop();
  };
  process.once("exit", sweep);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      sweep();
      process.exit(130);
    });
  }
}
