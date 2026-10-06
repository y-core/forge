import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { acquireDevServerLock, DEV_SERVER_LOCK } from "./dev-server-lock";
import type { DevServer, DevServerOptions } from "./workerd";

interface DevServerStartBudget {
  attemptTimeoutMs: number;
}

const READY_ATTEMPTS = 3;

/** The per-attempt budget `startDevServer` runs under, and the floor of every holder's lock staleness. @internal */
export const DEV_SERVER_ATTEMPT_TIMEOUT_MS = 60_000;

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

async function waitForReady(origin: string, readyPath: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exit = child.exitCode ?? child.signalCode;
    if (exit !== null) throw new Error(`dev server: wrangler exited (${exit}) before it was ready`);
    try {
      await fetch(`${origin}${readyPath}`, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`dev server: not ready after ${timeoutMs}ms`);
}

/** One `KEY="value"` line per var, quoted so a newline or a quote in a value survives the round trip. */
function dotenv(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
}

/** `startDevServer` under a caller-chosen per-attempt budget. @internal */
export async function spawnDevServer(options: DevServerOptions, budget: DevServerStartBudget): Promise<DevServer> {
  sweepOnExit();
  // Wrangler binds a port of its own choosing while it starts, so two starting at once can collide on it.
  // Staleness judges other holders, so it never falls below the full budget one of them may be spending.
  const staleAfterMs = READY_ATTEMPTS * Math.max(DEV_SERVER_ATTEMPT_TIMEOUT_MS, budget.attemptTimeoutMs);
  const release = await acquireDevServerLock({ path: join(tmpdir(), DEV_SERVER_LOCK), staleAfterMs });
  const unlock = (): void => {
    live.delete(unlock);
    release();
  };
  live.add(unlock);
  try {
    return await retryDevServerStart(options, budget.attemptTimeoutMs);
  } finally {
    unlock();
  }
}

async function retryDevServerStart(options: DevServerOptions, attemptTimeoutMs: number): Promise<DevServer> {
  const failures: string[] = [];
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
    try {
      return await spawnDevServerOnce(options, attemptTimeoutMs);
    } catch (error) {
      failures.push(String(error));
    }
  }
  throw new Error(`dev server: no start of ${READY_ATTEMPTS} became ready\n${failures.join("\n")}`);
}

async function spawnDevServerOnce(options: DevServerOptions, attemptTimeoutMs: number): Promise<DevServer> {
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
  // serves https once it detects it runs under an agent, and every `fetch` then meets a TLS handshake.
  args.push("--env-file", envFile, "--persist-to", options.persistTo ?? join(varsDir, "state"));
  args.push("--port", String(port), "--ip", "127.0.0.1", "--local-protocol", "http");

  // Resolved through the package, never a path relative to this file: in a consumer this module sits
  // under `node_modules/@y-core/forge/`, whose sibling `node_modules` holds no wrangler.
  const cli = fileURLToPath(new URL("./bin/wrangler.js", import.meta.resolve("wrangler/package.json")));
  // `detached`: wrangler spawns workerd and esbuild as children, so its own process group is what
  // makes the tree one signal target. `node`, never `process.execPath`: under `bun test` that is bun.
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

  const stop = killer(child.pid, varsDir);
  live.add(stop);

  try {
    await waitForReady(origin, options.readyPath ?? "/", child, attemptTimeoutMs);
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
