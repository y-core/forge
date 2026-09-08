import { spawn } from "node:child_process";
import { createServer } from "node:net";

/** A `wrangler dev` process serving one fixture, and the origin it answers on. */
export interface DevServer {
  origin: string;
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

async function waitForReady(origin: string, child: { killed: boolean }): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.killed) throw new Error("dev server: the wrangler process exited before it was ready");
    try {
      await fetch(`${origin}/api/contact`, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`dev server: not ready after ${READY_TIMEOUT_MS}ms`);
}

// Under node, not bun: `wrangler`'s in-process test harness starts under bun but never answers a
// request, and the CLI refuses bun outright. Spawning it keeps `bun test` the only test runner
// while the code under test still executes inside workerd.
/** Starts `wrangler dev` over a fixture's config and resolves once it answers. @internal */
export async function startDevServer(configPath: string): Promise<DevServer> {
  const port = await freePort();
  // `node`, never `process.execPath`: under `bun test` that is the bun binary, which wrangler refuses.
  const cli = new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url).pathname;
  const child = spawn("node", [cli, "dev", "--config", configPath, "--port", String(port), "--ip", "127.0.0.1"], {
    stdio: "ignore",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });

  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(origin, child);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }

  return { origin, stop: () => void child.kill("SIGKILL") };
}
