import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { unstable_splitSqlQuery } from "wrangler";

import { cutSqlStatements } from "../../storage/backup/split";
import { installedWranglerVersion, isD1BusyRefusal, missingWranglerExport, realDbIo, wranglerUnreachable } from "./io";
import type { Home, WranglerD1Module } from "./types";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-db-io-"));
  roots.push(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("realDbIo() — filesystem", () => {
  it("reads back what it wrote", () => {
    const root = tempRoot();
    const io = realDbIo();
    io.writeText(join(root, "a.sql"), "CREATE TABLE t (a);");
    expect(io.readText(join(root, "a.sql"))).toBe("CREATE TABLE t (a);");
  });

  it("writes a file and a directory readable by the owner alone, since a scratch may hold an expanded seed", () => {
    const root = tempRoot();
    const io = realDbIo();
    io.mkdir(join(root, "scratch"));
    io.writeText(join(root, "scratch", "seed.sql"), "x");
    io.createExclusive(join(root, "scratch", "lock"), "x");
    const mode = (path: string) => statSync(path).mode & 0o777;
    expect([mode(join(root, "scratch")), mode(join(root, "scratch", "seed.sql")), mode(join(root, "scratch", "lock"))]).toEqual([
      0o700, 0o600, 0o600,
    ]);
  });

  it("streams a file out in chunks and back in byte for byte, owner-only", async () => {
    const root = tempRoot();
    const io = realDbIo();
    const bytes = Uint8Array.from({ length: 200_000 }, (_, index) => index % 251);
    writeFileSync(join(root, "dump.sql"), bytes);
    const chunks: number[] = [];
    const counted = io.readStream(join(root, "dump.sql")).pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          chunks.push(chunk.byteLength);
          controller.enqueue(chunk);
        },
      }),
    );
    await io.writeStream(join(root, "copy.sql"), counted);
    expect([chunks.length > 1, Math.max(...chunks) < bytes.byteLength]).toEqual([true, true]);
    expect(new Uint8Array(readFileSync(join(root, "copy.sql")))).toEqual(bytes);
    expect(statSync(join(root, "copy.sql")).mode & 0o777).toBe(0o600);
  });

  it("replaces a longer file whole, leaving none of its tail", async () => {
    const root = tempRoot();
    const io = realDbIo();
    io.writeText(join(root, "copy.sql"), "a much longer body than the next one");
    await io.writeStream(join(root, "copy.sql"), new Response("short").body as ReadableStream<Uint8Array>);
    expect(io.readText(join(root, "copy.sql"))).toBe("short");
  });

  it("cancels the body when the file cannot be opened, and throws the open's error", async () => {
    const root = tempRoot();
    const io = realDbIo();
    let cancelled: unknown = null;
    const body = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancelled = reason;
      },
    });
    await expect(io.writeStream(join(root, "absent", "copy.sql"), body)).rejects.toThrow("ENOENT");
    expect(String(cancelled)).toContain("ENOENT");
  });

  it("errors a read stream over a file that is not there", async () => {
    const root = tempRoot();
    await expect(new Response(realDbIo().readStream(join(root, "absent.sql"))).text()).rejects.toThrow("ENOENT");
  });

  it("reports a present path and an absent one", () => {
    const root = tempRoot();
    const io = realDbIo();
    io.writeText(join(root, "a.sql"), "x");
    expect([io.exists(join(root, "a.sql")), io.exists(join(root, "b.sql"))]).toEqual([true, false]);
  });

  it("creates a nested directory in one call and lists what is in it", () => {
    const root = tempRoot();
    const io = realDbIo();
    io.mkdir(join(root, "deep", "nested"));
    io.writeText(join(root, "deep", "nested", "0001_init.sql"), "A");
    io.writeText(join(root, "deep", "nested", "0002_next.sql"), "B");
    expect(io.readDir(join(root, "deep", "nested")).sort()).toEqual(["0001_init.sql", "0002_next.sql"]);
  });

  it("removes a directory and everything under it, and is silent about one that is not there", () => {
    const root = tempRoot();
    const io = realDbIo();
    io.mkdir(join(root, "state", "d1"));
    io.writeText(join(root, "state", "d1", "db.sqlite"), "x");
    io.remove(join(root, "state"));
    expect(io.exists(join(root, "state"))).toBe(false);
    expect(() => io.remove(join(root, "state"))).not.toThrow();
  });

  it("dates a file it can see and answers null for one it cannot", () => {
    const root = tempRoot();
    const io = realDbIo();
    const before = Date.now();
    io.writeText(join(root, "a.sql"), "x");
    const stamped = io.mtime(join(root, "a.sql"));
    expect(stamped === null ? -1 : Math.round(stamped)).toBeGreaterThanOrEqual(before - 1000);
    expect(io.mtime(join(root, "absent.sql"))).toBeNull();
  });
});

describe("realDbIo() — ambient", () => {
  it("exposes the process environment unchanged, so a seed reads the same variables the shell has", () => {
    expect(realDbIo().env.PATH).toBe(process.env.PATH);
  });

  it("routes progress to the sink it was handed rather than to stdout", () => {
    const lines: string[] = [];
    realDbIo((line) => lines.push(line)).log("copying 0001_init.sql");
    expect(lines).toEqual(["copying 0001_init.sql"]);
  });

  it("reads the clock rather than a fixed instant", () => {
    const now = realDbIo().now();
    expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(5000);
  });

  it("waits on the real clock", async () => {
    const before = performance.now();
    await realDbIo().sleep(20);
    expect(performance.now() - before).toBeGreaterThanOrEqual(15);
  });
});

// The text a local D1 answers with when another process held the database's lock.
const BUSY_REFUSAL = "D1_ERROR: Failed to parse body as JSON, got: Error: internal error; reference = kd8n226n3710119qmodjhvl0";

let refusals: string[] = [];
const batches: string[][] = [];

/** A binding that answers every statement with no rows, or with the next of `refusals` while any remain. */
const stubDb = () => ({
  prepare: (sql: string) => sql,
  batch: (statements: string[]) => {
    batches.push(statements);
    const refusal = refusals.shift();
    if (refusal !== undefined) return Promise.reject(new Error(refusal));
    return Promise.resolve(statements.map(() => ({ results: [] })));
  },
});

const opened: Record<string, unknown>[] = [];
let opens = 0;
let disposals = 0;
let refuseOpen = false;
let holdOpen: ((error: Error) => void) | null = null;

const loadFakeWrangler = async (): Promise<WranglerD1Module> => ({
  getPlatformProxy: platformProxy as unknown as Required<WranglerD1Module>["getPlatformProxy"],
});

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
    databaseId: null,
    auth: null,
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

describe("installedWranglerVersion()", () => {
  it("answers the version the package declares", () => {
    expect(installedWranglerVersion(() => ({ name: "wrangler", version: "4.151.2" }))).toBe("4.151.2");
  });

  it("answers unknown for a package that will not load", () => {
    expect(
      installedWranglerVersion(() => {
        throw new Error("Cannot find module 'wrangler/package.json'");
      }),
    ).toBe("unknown");
  });

  it("answers unknown for a package declaring no version", () => {
    expect(installedWranglerVersion(() => ({}))).toBe("unknown");
    expect(installedWranglerVersion(() => ({ version: "" }))).toBe("unknown");
    expect(installedWranglerVersion(() => null)).toBe("unknown");
  });

  it("reads the version of the wrangler forge imports through realDbIo", () => {
    const imported = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve("wrangler/package.json")), "utf-8")) as { version: string };
    expect(realDbIo().wranglerVersion()).toBe(imported.version);
  });
});

describe("missingWranglerExport()", () => {
  it("names getPlatformProxy for a wrangler without it, and answers null for one exporting it", () => {
    expect([missingWranglerExport({}), missingWranglerExport({ getPlatformProxy: () => undefined })]).toEqual(["getPlatformProxy", null]);
  });
});

describe("realDbIo() — the local D1 port", () => {
  it("reports a wrangler that would not load through the injected loader, and opens nothing", async () => {
    const root = tempRoot();
    const cause = new Error("Cannot find module 'wrangler'");
    const opensBefore = opens;
    const io = realDbIo(undefined, () => Promise.reject(cause));
    await expect(io.d1(localHome(root), ["SELECT 1"])).rejects.toMatchObject({
      kind: "external",
      message: wranglerUnreachable(localHome(root), { error: cause }).message,
    });
    expect(opens).toBe(opensBefore);
  });

  it("opens the binding over the home's own `v3` state, with remote bindings off", async () => {
    const root = tempRoot();
    const io = realDbIo(undefined, loadFakeWrangler);
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
    const io = realDbIo(undefined, loadFakeWrangler);
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

  it("opens a separate handle for a home naming different config or a different environment", async () => {
    const root = tempRoot();
    const io = realDbIo(undefined, loadFakeWrangler);
    const before = opens;
    await io.d1(localHome(root), ["SELECT 1"]);
    await io.d1({ ...localHome(root), configPath: join(root, "wrangler.other.jsonc") }, ["SELECT 1"]);
    await io.d1({ ...localHome(root), env: "staging" }, ["SELECT 1"]);
    expect(opens - before).toBe(3);
    expect(opened.slice(-2).map((options) => [options.configPath, options.environment])).toEqual([
      [join(root, "wrangler.other.jsonc"), undefined],
      [join(root, "wrangler.jsonc"), "staging"],
    ]);
    await io.closeD1(null);
  });

  // A failed open is a bad `wrangler.jsonc` away, and every caller releases from a `finally`: the
  // sweep must reach the handles after it, and must not replace the error the run is failing on.
  it("keeps no handle for an open that failed, and sweeps past it to release the ones that opened", async () => {
    const failing = tempRoot();
    const working = tempRoot();
    const io = realDbIo(undefined, loadFakeWrangler);

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
    const io = realDbIo(undefined, loadFakeWrangler);
    await expect(io.d1({ ...localHome(root), persistTo: null, place: "remote", label: "remote" }, ["SELECT 1"])).rejects.toThrow(
      "remote (app-db) is deployed, and nothing reaches a deployed database in process",
    );
  });
});

describe("realDbIo() — splitD1", () => {
  it("answers the cut d1 runs, with blank statements dropped, and opens no handle to make it", async () => {
    const root = tempRoot();
    const io = realDbIo(undefined, loadFakeWrangler);
    const opened0 = opens;
    expect(await io.splitD1(localHome(root), "INSERT INTO t VALUES (1);  ;\nDROP VIEW v;")).toEqual(["INSERT INTO t VALUES (1)", "DROP VIEW v"]);
    expect(opens - opened0).toBe(0);
  });

  it("refuses a deployed home with the words d1 refuses it in", async () => {
    const root = tempRoot();
    const io = realDbIo(undefined, loadFakeWrangler);
    const opened0 = opens;
    await expect(io.splitD1({ ...localHome(root), persistTo: null, place: "remote", label: "remote" }, "SELECT 1;")).rejects.toThrow(
      "remote (app-db) is deployed, and nothing reaches a deployed database in process",
    );
    expect(opens - opened0).toBe(0);
  });
});

describe("isD1BusyRefusal()", () => {
  it("matches D1's internal error, and neither a SQL error nor the same text outside a D1 error", () => {
    expect([
      isD1BusyRefusal(new Error(BUSY_REFUSAL)),
      isD1BusyRefusal(new Error("D1_ERROR: no such table: users: SQLITE_ERROR")),
      isD1BusyRefusal(new Error("internal error; reference = abc")),
      isD1BusyRefusal(BUSY_REFUSAL),
    ]).toEqual([true, false, false, false]);
  });
});

describe("realDbIo() — a batch refused for the lock", () => {
  it("disposes the refused handle and replays the batch on a new one", async () => {
    const root = tempRoot();
    const io = realDbIo(undefined, loadFakeWrangler);
    const [opened0, disposed0, batched0] = [opens, disposals, batches.length];
    refusals = [BUSY_REFUSAL];
    expect(await io.d1(localHome(root), ["INSERT INTO t VALUES (1)"])).toEqual([[]]);
    expect([opens - opened0, disposals - disposed0, batches.slice(batched0)]).toEqual([
      2,
      1,
      [["INSERT INTO t VALUES (1)"], ["INSERT INTO t VALUES (1)"]],
    ]);
    await io.closeD1(null);
  });

  it("replays a read batch on a new handle even after the handle has answered", async () => {
    const root = tempRoot();
    const io = realDbIo(undefined, loadFakeWrangler);
    await io.d1(localHome(root), ["SELECT 1"]);
    const [opened0, disposed0, batched0] = [opens, disposals, batches.length];
    refusals = [BUSY_REFUSAL];
    expect(await io.d1(localHome(root), ["SELECT name FROM sqlite_master"])).toEqual([[]]);
    expect([opens - opened0, disposals - disposed0, batches.length - batched0]).toEqual([1, 1, 2]);
    await io.closeD1(null);
  });

  it("never replays a write batch on a handle that has already answered", async () => {
    const root = tempRoot();
    const io = realDbIo(undefined, loadFakeWrangler);
    await io.d1(localHome(root), ["SELECT 1"]);
    const [opened0, batched0] = [opens, batches.length];
    refusals = [BUSY_REFUSAL];
    await expect(io.d1(localHome(root), ["INSERT INTO t VALUES (1)"])).rejects.toThrow(BUSY_REFUSAL);
    expect([opens - opened0, batches.length - batched0]).toEqual([0, 1]);
    await io.closeD1(null);
  });

  it("does not retry a first batch that failed on its SQL", async () => {
    const root = tempRoot();
    const io = realDbIo(undefined, loadFakeWrangler);
    const [opened0, batched0] = [opens, batches.length];
    refusals = ["D1_ERROR: no such table: t: SQLITE_ERROR"];
    await expect(io.d1(localHome(root), ["INSERT INTO t VALUES (1)"])).rejects.toThrow("no such table: t");
    expect([opens - opened0, batches.length - batched0]).toEqual([1, 1]);
    await io.closeD1(null);
  });
});

describe("cutSqlStatements() against wrangler's splitter", () => {
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const corpus = ["src/auth", "tests/fixtures"]
    .flatMap((dir) => readdirSync(join(repo, dir), { recursive: true }).map((path) => `${dir}/${String(path)}`))
    .filter((path) => path.endsWith(".sql") && !path.includes("/.forge/"))
    .sort();
  const seed = [
    "-- users the dev session signs in as",
    "INSERT INTO users (id, email) VALUES (1, 'ada@example.com');",
    "INSERT INTO users (id, email) VALUES (2, 'grace@example.com'); -- trailing note",
    "/* roles */ UPDATE users SET role = 'admin' WHERE id = 1;",
  ].join("\n");
  const dump = [
    "PRAGMA defer_foreign_keys=TRUE;",
    'CREATE TABLE "notes" (id INTEGER PRIMARY KEY, body TEXT);',
    "CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN\n  UPDATE notes SET body = trim(body) WHERE id = new.id;\nEND;",
    `INSERT INTO "notes" ("id","body") VALUES(1,replace('line one\\nline; two','\\n',char(10)));`,
    `INSERT INTO "notes" ("id","body") VALUES(2,'it''s -- not a comment; nor /* this */');`,
  ].join("\n");

  // Wrangler hands text holding one statement back whole, `;` and trailing space included, where the
  // cut trims it the way it trims every other: D1 prepares both the same.
  const wranglerCut = (sql: string): string[] => {
    const cut = unstable_splitSqlQuery(sql);
    return cut.length === 1 ? cut.map((statement) => statement.trim().replace(/;$/, "")) : cut;
  };

  it("reads a corpus holding the auth schema and a migration with a trigger", () => {
    expect(corpus).toContain("src/auth/schema.sql");
    expect(corpus.some((path) => /CREATE TRIGGER/i.test(readFileSync(join(repo, path), "utf-8")))).toBe(true);
  });

  it("cuts a seed with leading and trailing comments as wrangler does", () => {
    expect(cutSqlStatements(seed)).toEqual(wranglerCut(seed));
  });

  for (const path of corpus) {
    it(`cuts ${path} as wrangler does`, () => {
      const sql = readFileSync(join(repo, path), "utf-8");
      expect(cutSqlStatements(sql)).toEqual(wranglerCut(sql));
    });
  }

  it("cuts a dump with a trigger and escaped newlines as wrangler does", () => {
    expect(cutSqlStatements(dump)).toEqual(wranglerCut(dump));
    expect(cutSqlStatements(dump)).toHaveLength(5);
  });

  it("diverges only where a literal holds BEGIN TRANSACTION and COMMIT, which wrangler deletes and the cut keeps", () => {
    const literal = "INSERT INTO notes (body) VALUES ('BEGIN TRANSACTION; then COMMIT; done');\nSELECT 1;";
    expect(unstable_splitSqlQuery(literal)).toEqual(["INSERT INTO notes (body) VALUES (' then  done')", "SELECT 1"]);
    expect(cutSqlStatements(literal)).toEqual(["INSERT INTO notes (body) VALUES ('BEGIN TRANSACTION; then COMMIT; done')", "SELECT 1"]);
  });
});

describe("realDbIo() — a literal holding transaction text", () => {
  it("batches a seed whose literal holds BEGIN TRANSACTION and COMMIT byte for byte", async () => {
    const root = tempRoot();
    const io = realDbIo(undefined, loadFakeWrangler);
    const insert = "INSERT INTO notes (body) VALUES ('BEGIN TRANSACTION; step; COMMIT;')";
    const batched0 = batches.length;
    await io.d1(localHome(root), [`${insert};\n${insert};`]);
    expect(batches.slice(batched0)).toEqual([[insert, insert]]);
    await io.closeD1(null);
  });
});
