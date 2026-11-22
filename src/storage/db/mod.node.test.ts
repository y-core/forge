import { describe, expect, it } from "bun:test";

import type { AppContext } from "../../context/types";
import { createLogger } from "../../logging/logger";
import { createTestContext } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import { resolveD1Client, validateD1Binding } from "./bindings";
import { createD1Client } from "./client";
import { schemaHealthMonitor } from "./health";
import { createRowLoader } from "./loader";
import type * as DbModule from "./mod";
import { defineD1Binding } from "./mount";
import { d1Sessions } from "./session";
import { sql } from "./sql";
import type { D1DatabaseLike } from "./types";

type Db = typeof DbModule;
type Env = { DB: D1DatabaseLike };

const REQUEST_FREE = /`node`.*request-free.*docs\/TEST_RUNNERS\.md §7f/;

const SOURCE = { createD1Client, createRowLoader, d1Sessions, defineD1Binding, resolveD1Client, schemaHealthMonitor, sql, validateD1Binding } as Db;

async function bundled(): Promise<Db> {
  return (await import(new URL("./mod.node.mjs", import.meta.url).href)) as Db;
}

const next = async () => new Response("next");
const binding = (c: AppContext<Env>) => c.env.DB;

async function settle(run: (c: AppContext<Env>) => Promise<unknown>): Promise<string | { name: string; message: string }> {
  const context = createTestContext<Env>(new Request("http://localhost/"), { env: { DB: fakeD1(() => [{ id: 1 }]) } });
  try {
    await run(context);
    return "served";
  } catch (error) {
    return { name: (error as Error).name, message: (error as Error).message };
  }
}

const entryPoints: { name: string; run: (db: Db) => (c: AppContext<Env>) => Promise<unknown> }[] = [
  { name: "validateD1Binding's middleware", run: (db) => (c) => Promise.resolve(db.validateD1Binding("DB")(c as never, next)) },
  { name: "d1Sessions' middleware", run: (db) => (c) => Promise.resolve(db.d1Sessions<Env>({ binding })(c as never, next)) },
  { name: "schemaHealthMonitor's middleware", run: (db) => (c) => Promise.resolve(db.schemaHealthMonitor<Env>({ binding })(c as never, next)) },
  {
    name: "resolveD1Client with no client logger, at the request logger lookup",
    run: (db) => async (c) => db.resolveD1Client(c, { binding })?.query(db.sql`SELECT 1`),
  },
  {
    name: "resolveD1Client with its own client logger, at the session and tally lookups",
    run: (db) => async (c) =>
      db.resolveD1Client(c, { binding, client: { logger: createLogger("own", { channels: [] }) } })?.query(db.sql`SELECT 1`),
  },
  {
    name: "defineD1Binding's client",
    run: (db) => async (c) =>
      db
        .defineD1Binding<Env>({ name: "DB" })
        .client(c)
        .query(db.sql`SELECT 1`),
  },
  {
    name: "defineD1Binding's monitor",
    run: (db) => (c) => Promise.all(db.defineD1Binding<Env>({ name: "DB" }).globals.map(async (middleware) => middleware(c as never, next))),
  },
];

describe("the node bundle of storage/db, handed a request the source set up", () => {
  for (const { name, run } of entryPoints) {
    it(`refuses ${name} with RequestFreeBundleError naming the node condition as request-free, where the source serves it`, async () => {
      expect([await settle(run(SOURCE)), await settle(run(await bundled()))]).toEqual([
        "served",
        { name: "RequestFreeBundleError", message: expect.stringMatching(REQUEST_FREE) },
      ]);
    });
  }
});

describe("the node bundle of storage/db, with no request", () => {
  it("loads without throwing, though each request key is created as the module loads", async () => {
    await expect(bundled()).resolves.toHaveProperty("createD1Client");
  });

  it("batches a createRowLoader's loads into one statement and answers each key as the source's loader does", async () => {
    async function loaded(db: Db) {
      const statements: string[] = [];
      const fake = fakeD1((text) => {
        statements.push(text);
        return [
          { id: 2, name: "b" },
          { id: 1, name: "a" },
        ];
      });
      const loader = db.createRowLoader<number, { id: number; name: string }>(db.createD1Client(fake), {
        select: (keys) => db.sql`SELECT id, name FROM users WHERE id IN (SELECT value FROM json_each(${keys}))`,
        keyOf: (row) => row.id,
      });
      const outcomes = await Promise.all([1, 2, 3].map((key) => loader.load(key)));
      return { statements: statements.length, rows: outcomes.map((outcome) => (outcome.ok ? outcome.data : outcome.error)) };
    }
    const expected = { statements: 1, rows: [{ id: 1, name: "a" }, { id: 2, name: "b" }, null] };
    expect([await loaded(SOURCE), await loaded(await bundled())]).toEqual([expected, expected]);
  });
});
