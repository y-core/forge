import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { realDbIo } from "../../src/tooling/db/io";
import type { DbIo, Home } from "../../src/tooling/db/types";
import { wrangler } from "./wrangler";

const DATABASE = "db-persist-fixture";
let root: string;
let io: DbIo;

function home(persistTo: string): Home {
  return {
    label: "local",
    database: DATABASE,
    binding: "DB",
    dir: root,
    configPath: join(root, "wrangler.jsonc"),
    persistTo,
    place: "local",
    env: null,
    synthesized: false,
  };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "forge-db-persist-"));
  writeFileSync(
    join(root, "wrangler.jsonc"),
    `${JSON.stringify(
      {
        name: "db-persist",
        compatibility_date: "2026-01-01",
        d1_databases: [{ binding: "DB", database_name: DATABASE, database_id: "db-persist-local" }],
      },
      null,
      2,
    )}\n`,
  );
  io = realDbIo(root);
  const ran = await wrangler(
    [
      "d1",
      "execute",
      DATABASE,
      "--local",
      "--persist-to",
      join(root, ".wrangler", "state"),
      "--yes",
      "--command",
      "CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO widgets (id, name) VALUES (1, 'spindle');",
    ],
    root,
  );
  expect(ran.code, `${ran.stderr}\n${ran.stdout}`).toBe(0);
}, 120_000);

afterAll(async () => {
  await io.closeD1(null);
  rmSync(root, { recursive: true, force: true });
});

describe("realDbIo().d1()", () => {
  it("reads the state a `wrangler d1 execute --persist-to` run wrote", async () => {
    const [rows] = await io.d1(home(join(root, ".wrangler", "state")), ["SELECT id, name FROM widgets ORDER BY id"]);
    expect(rows).toEqual([{ id: 1, name: "spindle" }]);
  }, 120_000);

  it("answers each statement of one call with its own rows", async () => {
    const answers = await io.d1(home(join(root, ".wrangler", "state")), ["SELECT count(*) AS n FROM widgets", "SELECT name FROM widgets"]);
    expect(answers).toEqual([[{ n: 1 }], [{ name: "spindle" }]]);
  }, 120_000);

  it("opens an empty database when the persist path already ends in the segment wrangler appends", async () => {
    const off = home(join(root, ".wrangler", "state", "v3"));
    await expect(io.d1(off, ["SELECT id FROM widgets"])).rejects.toThrow(/no such table/i);
    await io.closeD1(off);
  }, 120_000);

  // What licensed deleting `executeFile`'s note about miniflare's 102,400-byte `exec` cap: the local
  // path prepares each statement, and nothing on it is bounded by that.
  it("loads a schema file well over 102,400 bytes", async () => {
    const wide = Array.from({ length: 1600 }, (_, index) => `CREATE TABLE IF NOT EXISTS wide_${index} (id INTEGER PRIMARY KEY, note TEXT);`).join(
      "\n",
    );
    expect(new TextEncoder().encode(wide).length).toBeGreaterThan(102_400);
    const here = home(join(root, ".wrangler", "state"));
    await io.d1(here, [wide]);
    const [rows] = await io.d1(here, ["SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'wide_%'"]);
    expect(rows?.[0]?.n).toBe(1600);
  }, 120_000);

  // One call is one transaction, which is what lets a migration's body and its history row commit together.
  it("leaves the first statement's effect absent when a later one in the same call fails", async () => {
    const here = home(join(root, ".wrangler", "state"));
    await expect(
      io.d1(here, ["CREATE TABLE atomic (id INTEGER PRIMARY KEY)", "INSERT INTO atomic (id) VALUES ('x', 'too many')"]),
    ).rejects.toThrow();
    const [rows] = await io.d1(here, ["SELECT count(*) AS n FROM sqlite_master WHERE name = 'atomic'"]);
    expect(rows?.[0]?.n).toBe(0);
  }, 120_000);

  // The release runs from a `finally`, so it meets an open that has not settled and then fails —
  // and an error raised there would replace the one the run is already failing on.
  it("sweeps past an open that fails against a malformed config, raising nothing", async () => {
    const broken = mkdtempSync(join(tmpdir(), "forge-db-persist-broken-"));
    writeFileSync(join(broken, "wrangler.jsonc"), `{ "name": "broken", "d1_databases": [ , ] }\n`);
    const io = realDbIo(broken);

    const call = io.d1({ ...home(join(broken, ".wrangler", "state")), dir: broken, configPath: join(broken, "wrangler.jsonc") }, ["SELECT 1"]);
    const sweep = io.closeD1(null);

    await expect(call).rejects.toThrow();
    await expect(sweep).resolves.toBeUndefined();
    rmSync(broken, { recursive: true, force: true });
  }, 120_000);

  it("refuses a deployed home, which nothing reaches in process", async () => {
    await expect(io.d1({ ...home(join(root, ".wrangler", "state")), persistTo: null, place: "remote" }, ["SELECT 1"])).rejects.toThrow(
      /is deployed/,
    );
  });
});
