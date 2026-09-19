import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { realDbIo } from "./io";
import type { Spawned } from "./types";

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
