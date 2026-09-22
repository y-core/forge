import { afterAll, describe, expect, it, mock } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { missingWranglerExport, realDbIo, wranglerUnreachable } from "./io";
import type { Home, Spawned } from "./types";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-io-"));
  roots.push(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// A child bun, so the assertion is about a real spawn's own outcome rather than about anything this
// process has arranged around it.
function spawnFresh(root: string, cmd: string, args: readonly string[], cwd: string): Spawned {
  const script = `import { realDbIo } from ${JSON.stringify(new URL("./io.ts", import.meta.url).pathname)};
console.log(JSON.stringify(realDbIo(${JSON.stringify(root)}).spawn(${JSON.stringify(cmd)}, ${JSON.stringify(args)}, { cwd: ${JSON.stringify(cwd)} })));`;
  const child = Bun.spawnSync(["bun", "-e", script], { cwd: root });
  return JSON.parse(child.stdout.toString()) as Spawned;
}

describe("realDbIo() — filesystem", () => {
  it("reads back what it wrote", () => {
    const root = tempRoot();
    const io = realDbIo(root);
    io.writeText(join(root, "a.sql"), "CREATE TABLE t (a);");
    expect(io.readText(join(root, "a.sql"))).toBe("CREATE TABLE t (a);");
  });

  it("writes a file and a directory readable by the owner alone, since a scratch may hold an expanded seed", () => {
    const root = tempRoot();
    const io = realDbIo(root);
    io.mkdir(join(root, "scratch"));
    io.writeText(join(root, "scratch", "seed.sql"), "x");
    io.createExclusive(join(root, "scratch", "lock"), "x");
    const mode = (path: string) => statSync(path).mode & 0o777;
    expect([mode(join(root, "scratch")), mode(join(root, "scratch", "seed.sql")), mode(join(root, "scratch", "lock"))]).toEqual([
      0o700, 0o600, 0o600,
    ]);
  });

  it("reports a present path and an absent one", () => {
    const root = tempRoot();
    const io = realDbIo(root);
    io.writeText(join(root, "a.sql"), "x");
    expect([io.exists(join(root, "a.sql")), io.exists(join(root, "b.sql"))]).toEqual([true, false]);
  });

  it("creates a nested directory in one call and lists what is in it", () => {
    const root = tempRoot();
    const io = realDbIo(root);
    io.mkdir(join(root, "deep", "nested"));
    io.writeText(join(root, "deep", "nested", "0001_init.sql"), "A");
    io.writeText(join(root, "deep", "nested", "0002_next.sql"), "B");
    expect(io.readDir(join(root, "deep", "nested")).sort()).toEqual(["0001_init.sql", "0002_next.sql"]);
  });

  it("removes a directory and everything under it, and is silent about one that is not there", () => {
    const root = tempRoot();
    const io = realDbIo(root);
    io.mkdir(join(root, "state", "d1"));
    io.writeText(join(root, "state", "d1", "db.sqlite"), "x");
    io.remove(join(root, "state"));
    expect(io.exists(join(root, "state"))).toBe(false);
    expect(() => io.remove(join(root, "state"))).not.toThrow();
  });

  it("dates a file it can see and answers null for one it cannot", () => {
    const root = tempRoot();
    const io = realDbIo(root);
    const before = Date.now();
    io.writeText(join(root, "a.sql"), "x");
    const stamped = io.mtime(join(root, "a.sql"));
    expect(stamped === null ? -1 : Math.round(stamped)).toBeGreaterThanOrEqual(before - 1000);
    expect(io.mtime(join(root, "absent.sql"))).toBeNull();
  });
});

describe("realDbIo() — spawn", () => {
  it("keeps the two streams apart, so --json output is never mixed with progress", () => {
    const root = tempRoot();
    const run = spawnFresh(root, "bun", ["-e", "console.log('out'); console.error('err')"], root);
    expect(run).toEqual({ code: 0, stdout: "out\n", stderr: "err\n" });
  });

  it("carries the failing exit code through", () => {
    const root = tempRoot();
    const run = spawnFresh(root, "bun", ["-e", "process.exit(3)"], root);
    expect([run.code, run.stdout, run.stderr]).toEqual([3, "", ""]);
  });

  it("reports a command that is not on the path as a failure with the reason on stderr", () => {
    const root = tempRoot();
    const run = spawnFresh(root, "forge-db-not-a-real-command", [], root);
    expect(run).toEqual({ code: 1, stdout: "", stderr: 'Executable not found in $PATH: "forge-db-not-a-real-command"\n' });
  });

  it("resolves the app's own node_modules/.bin ahead of the ambient path", () => {
    const root = tempRoot();
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(root, "node_modules", ".bin", "forge-db-fixture"), "#!/bin/sh\necho local-copy\n", "utf-8");
    chmodSync(join(root, "node_modules", ".bin", "forge-db-fixture"), 0o755);
    expect(spawnFresh(root, "forge-db-fixture", [], root)).toEqual({ code: 0, stdout: "local-copy\n", stderr: "" });
  });

  it("turns wrangler's metrics prompt off in the child's environment", () => {
    const root = tempRoot();
    const run = spawnFresh(root, "bun", ["-e", "console.log(process.env.WRANGLER_SEND_METRICS)"], root);
    expect(run.stdout).toBe("false\n");
  });

  it("runs in the directory it was given, not the one the test process is in", () => {
    const root = tempRoot();
    const run = spawnFresh(tempRoot(), "bun", ["-e", "console.log(process.cwd())"], root);
    expect(run.stdout.trim()).toBe(root);
  });
});

describe("realDbIo() — ambient", () => {
  it("exposes the process environment unchanged, so a seed reads the same variables the shell has", () => {
    expect(realDbIo(tempRoot()).env.PATH).toBe(process.env.PATH);
  });

  it("routes progress to the sink it was handed rather than to stdout", () => {
    const lines: string[] = [];
    realDbIo(tempRoot(), (line) => lines.push(line)).log("copying 0001_init.sql");
    expect(lines).toEqual(["copying 0001_init.sql"]);
  });

  it("reads the clock rather than a fixed instant", () => {
    const now = realDbIo(tempRoot()).now();
    expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(5000);
  });
});

/** A binding that answers every statement with no rows, so the port's own behaviour is what is read. */
const stubDb = () => ({ prepare: (sql: string) => sql, batch: (statements: string[]) => Promise.resolve(statements.map(() => ({ results: [] }))) });

const opened: Record<string, unknown>[] = [];
let opens = 0;
let disposals = 0;
let refuseOpen = false;
let holdOpen: ((error: Error) => void) | null = null;

// One registration for the file: `mock.module` re-registered later does not reach an import another
// module already made.
void mock.module("wrangler", () => ({ getPlatformProxy: platformProxy, unstable_splitSqlQuery: (sql: string) => [sql] }));

function platformProxy(options: Record<string, unknown>) {
  opened.push(options);
  opens += 1;
  if (refuseOpen) return Promise.reject(new Error("Unexpected token } in JSON at position 0"));
  // Left pending until the test rejects it, so a sweep can reach an open that has not settled.
  if (holdOpen !== null) return new Promise((_resolve, reject) => (holdOpen = reject));
  return Promise.resolve({
    env: { DB: stubDb() },
    dispose: () => {
      disposals += 1;
      return Promise.resolve();
    },
  });
}

function localHome(root: string): Home {
  return {
    label: "local",
    database: "app-db",
    binding: "DB",
    dir: root,
    configPath: join(root, "wrangler.jsonc"),
    persistTo: join(root, ".wrangler", "state"),
    place: "local",
    env: null,
    synthesized: false,
  };
}

describe("wranglerUnreachable()", () => {
  // A broken install reported as an absent one sends the user to reinstall a package that is there.
  it("keeps the module's own error text for a wrangler that would not load", () => {
    const cause = new Error("Cannot find module '@cloudflare/workerd-linux-64'");
    const error = wranglerUnreachable(localHome("/app"), { error: cause });
    expect(error.kind).toBe("external");
    expect(error.message).toContain("wrangler would not load");
    expect(error.message).toContain("Cannot find module '@cloudflare/workerd-linux-64'");
    expect(error.cause).toBe(cause);
  });

  it("reserves the not-installed wording for a module that loaded without the export", () => {
    const error = wranglerUnreachable(localHome("/app"), { missing: "getPlatformProxy" });
    expect(error.message).toBe(
      "wrangler is not installed, or is too old to export getPlatformProxy — `forge db` reaches local (app-db) through it",
    );
    expect(error.cause).toBeUndefined();
  });
});

// `unstable_splitSqlQuery` used to be read at query time, where its absence surfaced as "query
// `SELECT …` failed" and the version diagnostic was lost. Both exports are now read at the open.
describe("missingWranglerExport()", () => {
  it("names the half a wrangler exporting only getPlatformProxy is missing", () => {
    const missing = missingWranglerExport({ getPlatformProxy: () => undefined });
    expect(wranglerUnreachable(localHome("/app"), { missing: missing ?? "" }).message).toBe(
      "wrangler is not installed, or is too old to export unstable_splitSqlQuery — `forge db` reaches local (app-db) through it",
    );
  });

  it("names getPlatformProxy first, and answers null for a wrangler exporting both", () => {
    expect([
      missingWranglerExport({ unstable_splitSqlQuery: () => [] }),
      missingWranglerExport({ getPlatformProxy: () => undefined, unstable_splitSqlQuery: () => [] }),
    ]).toEqual(["getPlatformProxy", null]);
  });
});

describe("realDbIo() — the local D1 port", () => {
  it("opens the binding over the home's own `v3` state, with remote bindings off", async () => {
    const root = tempRoot();
    const io = realDbIo(root);
    await io.d1(localHome(root), ["SELECT 1"]);
    await io.closeD1(null);

    // `remoteBindings` defaults to true, and a binding marked remote would open a network session
    // from a handle that answers for local state alone.
    expect(opened.at(-1)).toMatchObject({
      configPath: join(root, "wrangler.jsonc"),
      persist: { path: join(root, ".wrangler", "state", "v3") },
      remoteBindings: false,
      envFiles: [],
    });
  });

  it("opens one handle for repeated calls against the same state, and none after it is closed", async () => {
    const root = tempRoot();
    const io = realDbIo(root);
    const before = opens;
    await io.d1(localHome(root), ["SELECT 1"]);
    await io.d1(localHome(root), ["SELECT 2"]);
    expect(opens - before).toBe(1);

    const closed = disposals;
    await io.closeD1(localHome(root));
    expect(disposals - closed).toBe(1);
    await io.closeD1(localHome(root));
    expect(disposals - closed).toBe(1);
  });

  // A failed open is a bad `wrangler.jsonc` away, and every caller releases from a `finally`: the
  // sweep must reach the handles after it, and must not replace the error the run is failing on.
  it("keeps no handle for an open that failed, and sweeps past it to release the ones that opened", async () => {
    const failing = tempRoot();
    const working = tempRoot();
    const io = realDbIo(failing);

    refuseOpen = true;
    await expect(io.d1(localHome(failing), ["SELECT 1"])).rejects.toThrow("Unexpected token }");
    refuseOpen = false;

    // Nothing was kept, so this opens again rather than meeting the first failure a second time.
    await io.d1(localHome(failing), ["SELECT 1"]);
    const disposedBefore = disposals;
    await io.d1(localHome(working), ["SELECT 1"]);

    await expect(io.closeD1(null)).resolves.toBeUndefined();
    expect(disposals - disposedBefore).toBe(2);
  });

  it("refuses a deployed home, which nothing reaches in process", async () => {
    const root = tempRoot();
    const io = realDbIo(root);
    await expect(io.d1({ ...localHome(root), persistTo: null, place: "remote", label: "remote" }, ["SELECT 1"])).rejects.toThrow(
      "remote (app-db) is deployed, and nothing reaches a deployed database in process",
    );
  });
});
