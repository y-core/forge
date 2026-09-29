import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { DEV_SERVER_ATTEMPT_TIMEOUT_MS, spawnDevServer } from "./dev-server-start";
import type { DevServer } from "./workerd";

const servers: DevServer[] = [];
const saved = { path: process.env.PATH, tmpdir: process.env.TMPDIR };
let dir = "";

const HANG_THEN_ANSWER = `const earlier = existsSync(log) ? readFileSync(log, "utf-8").split("\\n").filter(Boolean).length : 0;
appendFileSync(log, process.pid + " " + port + "\\n");
if (earlier === 0) setInterval(() => {}, 1 << 30);
else require("node:http").createServer((_, res) => res.end("answered by start " + (earlier + 1))).listen(port, "127.0.0.1");`;

const EXIT_AT_ONCE = `appendFileSync(log, process.pid + " " + port + "\\n");
process.exit(1);`;

/** Puts a `node` first on `PATH` that runs `behaviour` in place of the wrangler CLI, logging each start's pid and port. */
function fakeNode(behaviour: string): void {
  const script = join(dir, "fake-wrangler.cjs");
  writeFileSync(
    script,
    `const { appendFileSync, existsSync, readFileSync } = require("node:fs");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const log = ${JSON.stringify(join(dir, "starts"))};
${behaviour}
`,
    "utf-8",
  );
  const shim = join(dir, "node");
  writeFileSync(shim, `#!/bin/sh\nPATH=${JSON.stringify(saved.path ?? "")} exec node ${JSON.stringify(script)} "$@"\n`, "utf-8");
  chmodSync(shim, 0o755);
  process.env.PATH = `${dir}${delimiter}${saved.path ?? ""}`;
}

function starts(): number[][] {
  return readFileSync(join(dir, "starts"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => line.split(" ").map(Number));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "forge-dev-server-start-"));
  // A private temp directory gives the case its own start lock, so a workerd run elsewhere never holds it up.
  process.env.TMPDIR = dir;
});

afterEach(() => {
  process.env.PATH = saved.path;
  if (saved.tmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = saved.tmpdir;
  rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  for (const server of servers) server.stop();
});

describe("spawnDevServer()", () => {
  it("kills a start that never answers and serves from a second start on a fresh port", async () => {
    fakeNode(HANG_THEN_ANSWER);

    const server = await spawnDevServer({}, { attemptTimeoutMs: 3_000 });
    servers.push(server);
    const [[firstPid, firstPort] = [], [, secondPort] = []] = starts();

    expect(starts().length).toBe(2);
    expect(secondPort).not.toBe(firstPort);
    expect(server.origin).toBe(`http://127.0.0.1:${secondPort}`);
    expect(await fetch(server.origin).then((res) => res.text())).toBe("answered by start 2");
    expect(isAlive(firstPid ?? 0)).toBe(false);
  }, 30_000);

  it("rejects once wrangler exits, without waiting out the readiness budget", async () => {
    fakeNode(EXIT_AT_ONCE);
    const startedAt = Date.now();

    await expect(spawnDevServer({}, { attemptTimeoutMs: DEV_SERVER_ATTEMPT_TIMEOUT_MS })).rejects.toThrow(
      /wrangler exited \(1\) before it was ready/,
    );
    expect(Date.now() - startedAt).toBeLessThan(15_000);
  }, 30_000);
});
