import { describe, expect, it, spyOn } from "bun:test";

import { createLogger } from "../../logging/logger";
import type { LogRecord } from "../../logging/types";
import { createD1Client } from "./client";
import { requireRowsWritten, sql } from "./sql";
import type { D1Database, D1PreparedStatement, D1Result } from "./types";

type BoundCall = { text: string; params: unknown[] };

function makeD1Stub(
  rows: unknown[] = [],
  meta: D1Result<unknown>["meta"] = {},
  batchMeta?: D1Result<unknown>["meta"][],
): { db: D1Database; calls: BoundCall[] } {
  const calls: BoundCall[] = [];

  function makeStatement(text: string, params: unknown[]): D1PreparedStatement {
    const stmt: D1PreparedStatement = {
      bind(...args: unknown[]) {
        return makeStatement(text, args);
      },
      async all<T>(): Promise<D1Result<T>> {
        calls.push({ text, params });
        return { results: rows as T[], success: true, meta };
      },
      async first<T>(): Promise<T | null> {
        calls.push({ text, params });
        return (rows[0] as T) ?? null;
      },
      async run(): Promise<D1Result<unknown>> {
        calls.push({ text, params });
        return { results: [], success: true, meta };
      },
    };
    return stmt;
  }

  const db: D1Database = {
    prepare(query: string) {
      return makeStatement(query, []);
    },
    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      return statements.map((_, i) => ({ results: rows as T[], success: true, meta: batchMeta?.[i] ?? meta }));
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  };

  return { db, calls };
}

describe("createD1Client — query", () => {
  it("returns rows from a parameterised fragment", async () => {
    const { db } = makeD1Stub([{ id: 1 }]);
    const client = createD1Client(db);
    const res = await client.query<{ id: number }>(sql`SELECT * FROM t WHERE id = ${1}`);
    expect(res).toEqual({ ok: true, data: [{ id: 1 }], meta: { attempts: 1 } });
  });

  it("passes bound params to the prepared statement", async () => {
    const { db, calls } = makeD1Stub([]);
    const client = createD1Client(db);
    await client.query(sql`SELECT * FROM t WHERE name = ${"Alice"} AND age = ${30}`);
    expect(calls[0]!.params).toEqual(["Alice", 30]);
  });

  it("wraps D1 errors in Result", async () => {
    const db: D1Database = {
      prepare() {
        return {
          bind() {
            return this;
          },
          all() {
            return Promise.reject(new Error("D1 error"));
          },
          first() {
            return Promise.reject(new Error("D1 error"));
          },
          run() {
            return Promise.reject(new Error("D1 error"));
          },
        };
      },
      batch: () => Promise.reject(new Error("D1 error")),
      exec: () => Promise.reject(new Error("D1 error")),
    };
    const client = createD1Client(db);
    const res = await client.query(sql`SELECT 1`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toBe("D1 error");
  });
});

describe("createD1Client — queryOne", () => {
  it("returns the first row", async () => {
    const { db } = makeD1Stub([{ name: "Bob" }]);
    const client = createD1Client(db);
    const res = await client.queryOne<{ name: string }>(sql`SELECT * FROM t LIMIT 1`);
    expect(res).toEqual({ ok: true, data: { name: "Bob" }, meta: { attempts: 1 } });
  });

  it("returns null when no rows", async () => {
    const { db } = makeD1Stub([]);
    const client = createD1Client(db);
    const res = await client.queryOne(sql`SELECT * FROM t WHERE 0`);
    expect(res).toEqual({ ok: true, data: null, meta: { attempts: 1 } });
  });
});

describe("createD1Client — execute", () => {
  it("returns rowsWritten from meta", async () => {
    const { db } = makeD1Stub([], { rows_written: 3 });
    const client = createD1Client(db);
    const res = await client.execute(sql`UPDATE t SET x = ${1}`);
    expect(res).toEqual({
      ok: true,
      data: { rowsWritten: 3, lastRowId: undefined },
      meta: { attempts: 1, cost: { rowsRead: 0, rowsWritten: 3, durationMs: 0 } },
    });
  });
});

// `rows_written` counts index rows as well, so on a guarded write it is the wrong number: only
// `changes` answers "did this statement match a row".
describe("createD1Client — which write count it believes", () => {
  it("prefers `changes` over `rows_written`, so an unmatched write reads as zero", async () => {
    const { db } = makeD1Stub([], { changes: 0, rows_written: 2 });
    const client = createD1Client(db);
    expect(await client.execute(sql`UPDATE t SET x = ${1} WHERE 0`)).toEqual({
      ok: true,
      data: { rowsWritten: 0, lastRowId: undefined },
      meta: { attempts: 1, cost: { rowsRead: 0, rowsWritten: 2, durationMs: 0 } },
    });
  });

  it("falls back to `rows_written` where the driver reports no `changes` at all", async () => {
    const { db } = makeD1Stub([], { rows_written: 3 });
    const client = createD1Client(db);
    expect(await client.execute(sql`UPDATE t SET x = ${1}`)).toEqual({
      ok: true,
      data: { rowsWritten: 3, lastRowId: undefined },
      meta: { attempts: 1, cost: { rowsRead: 0, rowsWritten: 3, durationMs: 0 } },
    });
  });
});

describe("createD1Client — batch", () => {
  it("executes multiple fragments as a batch", async () => {
    const { db } = makeD1Stub([]);
    const client = createD1Client(db);
    const res = await client.batch([sql`INSERT INTO t (a) VALUES (${1})`, sql`INSERT INTO t (a) VALUES (${2})`]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toHaveLength(2);
  });

  it("normalises every statement's write count the way execute does", async () => {
    const { db } = makeD1Stub([{ id: 1 }], {}, [
      { rows_written: 2, changes: 1 },
      { changes: 1 },
      {},
      { rows_written: 1, last_row_id: 7 },
      { last_row_id: null },
    ]);
    const client = createD1Client(db);
    const res = await client.batch<{ id: number }>([
      sql`UPDATE t SET a = 1`,
      sql`UPDATE t SET a = 2`,
      sql`SELECT 1`,
      sql`INSERT INTO t (a) VALUES (1)`,
      sql`SELECT 2`,
    ]);
    expect(res).toEqual({
      ok: true,
      data: [
        { results: [{ id: 1 }], rowsWritten: 1 },
        { results: [{ id: 1 }], rowsWritten: 1 },
        { results: [{ id: 1 }], rowsWritten: 0 },
        { results: [{ id: 1 }], rowsWritten: 1, lastRowId: 7 },
        { results: [{ id: 1 }], rowsWritten: 0, lastRowId: null },
      ],
      meta: { attempts: 1, cost: { rowsRead: 0, rowsWritten: 3, durationMs: 0 } },
    });
    if (res.ok) expect(res.data.map((entry) => "lastRowId" in entry)).toEqual([false, false, false, true, true]);
  });
});

describe("createD1Client — batch with requireRowsWritten", () => {
  function rejectingBatch(thrown: Error): D1Database {
    return {
      prepare(query: string) {
        const stmt: D1PreparedStatement = {
          bind: () => stmt,
          all: () => Promise.reject(thrown),
          first: () => Promise.reject(thrown),
          run: () => Promise.reject(thrown),
        };
        void query;
        return stmt;
      },
      batch: () => Promise.reject(thrown),
      exec: () => Promise.reject(thrown),
    };
  }

  const overflow = () => new Error("D1_ERROR: integer overflow: SQLITE_ERROR");

  it("rewords the overflow a guard raised and keeps the original as the cause", async () => {
    const thrown = overflow();
    const client = createD1Client(rejectingBatch(thrown));
    const res = await client.batch([sql`UPDATE t SET a = 1 WHERE id = ${9}`, requireRowsWritten()]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toBe("a guarded statement in this batch wrote no row, so the batch was rolled back");
    expect(res.error.kind).toBe("guard");
    expect(res.error.cause).toBe(thrown);
  });

  it("classes an overflow as unavailable, keeping its message, when no guard is in the batch", async () => {
    const thrown = overflow();
    const client = createD1Client(rejectingBatch(thrown));
    const res = await client.batch([sql`SELECT abs(-9223372036854775808)`]);
    expect(res.ok ? null : [res.error.kind, res.error.message, res.error.cause]).toEqual(["unavailable", thrown.message, thrown]);
  });

  it("classes any other D1 error by its own message even with a guard present", async () => {
    const thrown = new Error("D1_ERROR: no such table: t: SQLITE_ERROR");
    const client = createD1Client(rejectingBatch(thrown));
    const res = await client.batch([sql`UPDATE t SET a = 1`, requireRowsWritten()]);
    expect(res.ok ? null : [res.error.kind, res.error.message, res.error.cause]).toEqual(["unavailable", thrown.message, thrown]);
  });

  it("returns the guard's own row alongside the write when the write matched", async () => {
    const { db } = makeD1Stub([], {}, [{ rows_written: 1 }, { rows_read: 0 }]);
    const client = createD1Client(db);
    const res = await client.batch([sql`UPDATE t SET a = 1`, requireRowsWritten()]);
    expect(res).toEqual({
      ok: true,
      data: [
        { results: [], rowsWritten: 1 },
        { results: [], rowsWritten: 0 },
      ],
      meta: { attempts: 1, cost: { rowsRead: 0, rowsWritten: 1, durationMs: 0 } },
    });
  });
});

describe("createD1Client() logging", () => {
  it("writes nothing to the console when no logger is passed", async () => {
    const written = spyOn(console, "log").mockImplementation(() => {});
    try {
      const { db } = makeD1Stub([{ id: 1 }]);
      await createD1Client(db).query(sql`SELECT 1`);
      expect(written).not.toHaveBeenCalled();
    } finally {
      written.mockRestore();
    }
  });

  it("records the query on a logger the caller passes", async () => {
    const records: LogRecord[] = [];
    const logger = createLogger("storage/db", { channels: [{ write: (record) => void records.push(record) }] });
    const { db } = makeD1Stub([{ id: 1 }]);

    await createD1Client(db, { logger }).query(sql`SELECT 1`);

    expect(records.map((record) => record.message)).toEqual(["d1.query"]);
  });
});

describe("createD1Client() retry and attempts", () => {
  function flaky(failures: readonly string[]): { db: D1Database; dispatched: () => number } {
    let dispatched = 0;
    const next = (): Promise<D1Result<unknown>> => {
      const message = failures[dispatched];
      dispatched += 1;
      return message === undefined ? Promise.resolve({ results: [], success: true, meta: { changes: 1 } }) : Promise.reject(new Error(message));
    };
    const db: D1Database = {
      prepare() {
        const stmt: D1PreparedStatement = { bind: () => stmt, all: next as never, first: () => Promise.resolve(null), run: next };
        return stmt;
      },
      batch: (() => next().then((res) => [res])) as never,
      exec: () => Promise.resolve({ count: 0, duration: 0 }),
    };
    return { db, dispatched: () => dispatched };
  }

  const LOST = "D1_ERROR: Network connection lost.";
  const fast = { retry: { baseDelayMs: 0 } };

  it("retries a transient failure of an idempotent execute, and counts each dispatch", async () => {
    const { db, dispatched } = flaky([LOST, LOST]);
    const res = await createD1Client(db, fast).execute(sql`UPDATE t SET a = 1 WHERE id = ${1}`, { idempotent: true });
    expect([res.ok, res.meta.attempts, dispatched()]).toEqual([true, 3, 3]);
  });

  it("retries a transient failure of an idempotent batch", async () => {
    const { db } = flaky([LOST]);
    const res = await createD1Client(db, fast).batch([sql`UPDATE t SET a = 1`], { idempotent: true });
    expect([res.ok, res.meta.attempts]).toEqual([true, 2]);
  });

  it("never retries a write not marked idempotent", async () => {
    const { db, dispatched } = flaky([LOST]);
    const res = await createD1Client(db, fast).execute(sql`INSERT INTO t (a) VALUES (${1})`);
    expect([res.ok ? null : res.error.kind, res.meta.attempts, dispatched()]).toEqual(["transient", 1, 1]);
  });

  for (const [kind, message] of [
    ["constraint", "D1_ERROR: UNIQUE constraint failed: t.a: SQLITE_CONSTRAINT"],
    ["overloaded", "D1_ERROR: D1 DB is overloaded. Too many requests queued."],
    ["limit", "D1_ERROR: D1 DB exceeded its CPU time limit and was reset."],
  ] as const) {
    it(`never retries a ${kind} failure, even when idempotent`, async () => {
      const { db, dispatched } = flaky([message]);
      const res = await createD1Client(db, fast).execute(sql`UPDATE t SET a = 1`, { idempotent: true });
      expect([res.ok ? null : res.error.kind, dispatched()]).toEqual([kind, 1]);
    });
  }

  it("gives up after the policy's attempts, reporting each one on the failure", async () => {
    const { db, dispatched } = flaky([LOST, LOST, LOST]);
    const res = await createD1Client(db, { retry: { baseDelayMs: 0, attempts: 2 } }).execute(sql`UPDATE t SET a = 1`, { idempotent: true });
    expect([res.ok ? null : res.error.attempts, res.meta.attempts, dispatched()]).toEqual([2, 2, 2]);
  });

  it("reports D1's own read retries as the attempts of a query", async () => {
    const { db } = makeD1Stub([{ id: 1 }], { total_attempts: 3 });
    expect((await createD1Client(db).query(sql`SELECT 1`)).meta).toEqual({ attempts: 3 });
  });

  it("reports D1's own read retries as the attempts of a queryOne", async () => {
    const { db } = makeD1Stub([{ id: 1 }], { total_attempts: 3 });
    expect(await createD1Client(db).queryOne(sql`SELECT 1`)).toEqual({ ok: true, data: { id: 1 }, meta: { attempts: 3 } });
  });
});

describe("createD1Client() refusing a statement over D1's limits", () => {
  const values = (n: number) => Array.from({ length: n }, (_, i) => i);
  const listOf = (n: number) =>
    values(n)
      .map((v) => sql`${v}`)
      .reduce((left, right) => sql`${left}, ${right}`);
  // A statement of exactly this text, built the way the tag sees a template with nothing interpolated.
  const literal = (text: string) => sql(Object.assign([text], { raw: [text] }));

  it("sends 100 bound parameters, and refuses 101 as a limit failure without sending anything", async () => {
    const { db, calls } = makeD1Stub([]);
    const client = createD1Client(db);

    expect((await client.query(sql`SELECT * FROM t WHERE id IN (${listOf(100)})`)).ok).toBe(true);
    const refused = await client.query(sql`SELECT * FROM t WHERE id IN (${listOf(101)})`);

    expect(refused.ok ? null : [refused.error.kind, refused.error.message, refused.meta.attempts]).toEqual([
      "limit",
      "the statement binds 101 parameters, over D1's 100 — bind a list as one JSON array: IN (SELECT value FROM json_each(?))",
      0,
    ]);
    expect(calls).toHaveLength(1);
  });

  it("refuses a 100-value list beside one other parameter, sending nothing", async () => {
    const { db, calls } = makeD1Stub([]);
    const client = createD1Client(db);
    const byTenant = (list: ReturnType<typeof sql>) => sql`SELECT * FROM t WHERE tenant_id = ${"t1"} AND id IN (${list})`;

    const refused = await client.query(byTenant(listOf(100)));
    expect(refused.ok ? null : [refused.error.kind, refused.meta.attempts, calls.length]).toEqual(["limit", 0, 0]);
  });

  it("sends a 150-value list as one parameter through json_each", async () => {
    const { db, calls } = makeD1Stub([]);
    const ids = JSON.stringify(values(150));
    const sent = await createD1Client(db).query(sql`SELECT * FROM t WHERE id IN (SELECT value FROM json_each(${ids}))`);
    expect([sent.ok, calls]).toEqual([true, [{ text: "SELECT * FROM t WHERE id IN (SELECT value FROM json_each(?))", params: [ids] }]]);
  });

  it("sends a statement of exactly 100,000 UTF-8 bytes, and refuses one byte more", async () => {
    const { db, calls } = makeD1Stub([]);
    const client = createD1Client(db);
    const at = literal(`SELECT '${"x".repeat(100_000 - "SELECT ''".length)}'`);
    const over = literal(`SELECT '${"x".repeat(100_000 - "SELECT ''".length + 1)}'`);

    expect([at.text.length, (await client.execute(at)).ok]).toEqual([100_000, true]);
    const refused = await client.execute(over);
    expect(refused.ok ? null : [refused.error.kind, refused.error.message]).toEqual(["limit", "the statement is 100001 bytes, over D1's 100000"]);
    expect(calls).toHaveLength(1);
  });

  it("counts bytes, not characters, so a multi-byte statement under 100,000 characters can be over", async () => {
    const { db } = makeD1Stub([]);
    const text = literal(`SELECT '${"é".repeat(50_000)}'`);
    const refused = await createD1Client(db).query(text);
    expect(refused.ok ? null : refused.error.kind).toBe("limit");
  });

  it("names the statement of a batch that is over, and sends none of the batch", async () => {
    const { db } = makeD1Stub([]);
    let batched = false;
    const batching = { ...db, batch: async () => ((batched = true), []) } as typeof db;
    const refused = await createD1Client(batching).batch([sql`SELECT 1`, sql`SELECT * FROM t WHERE id IN (${listOf(101)})`]);
    expect([refused.ok ? null : refused.error.message, batched]).toEqual([
      "statement 2 binds 101 parameters, over D1's 100 — bind a list as one JSON array: IN (SELECT value FROM json_each(?))",
      false,
    ]);
  });
});

describe("createD1Client() cost, placement and the d1.query record", () => {
  function capture() {
    const records: LogRecord[] = [];
    const logger = createLogger("storage/db", { channels: [{ write: (record) => void records.push(record) }] });
    return { records, logger };
  }

  it("reports what D1 billed and where it ran, summed over a batch's statements", async () => {
    const { db } = makeD1Stub([], {}, [
      { rows_read: 3, rows_written: 1, duration: 1.5, served_by_region: "WEUR", served_by_primary: true },
      { rows_read: 2, rows_written: 4, duration: 0.5 },
    ]);
    const res = await createD1Client(db).batch([sql`UPDATE t SET a = 1`, sql`SELECT 1`]);
    expect(res.meta).toEqual({ attempts: 1, cost: { rowsRead: 5, rowsWritten: 5, durationMs: 2 }, servedBy: { region: "WEUR", primary: true } });
  });

  it("leaves cost and servedBy off where D1 reported neither", async () => {
    const { db } = makeD1Stub([{ id: 1 }], {});
    expect((await createD1Client(db).query(sql`SELECT 1`)).meta).toEqual({ attempts: 1 });
  });

  it("logs one d1.query record per call with the SQL, cost and placement, and never a bound value", async () => {
    const { records, logger } = capture();
    const { db } = makeD1Stub([], { rows_read: 7, duration: 3, served_by_region: "ENAM", served_by_primary: false });
    const SENTINEL = "sentinel-7c1f-ada@example.com";

    await createD1Client(db, { logger }).query(sql`SELECT * FROM users WHERE email = ${SENTINEL}`);

    expect(records.map((record) => [record.level, record.message, record.data])).toEqual([
      [
        "debug",
        "d1.query",
        {
          op: "query",
          sql: "SELECT * FROM users WHERE email = ?",
          attempts: 1,
          rowsRead: 7,
          rowsWritten: 0,
          durationMs: 3,
          region: "ENAM",
          primary: false,
        },
      ],
    ]);
    expect(JSON.stringify(records)).not.toContain(SENTINEL);
  });

  it("logs a batch as one record naming every statement, and a failure by its kind", async () => {
    const { records, logger } = capture();
    const db: D1Database = {
      ...makeD1Stub().db,
      batch: () => Promise.reject(new Error("D1_ERROR: UNIQUE constraint failed: t.a: SQLITE_CONSTRAINT")),
    };
    await createD1Client(db, { logger }).batch([sql`INSERT INTO t (a) VALUES (${1})`, sql`SELECT 1`]);
    expect(records.map((record) => record.data)).toEqual([
      { op: "batch", sql: ["INSERT INTO t (a) VALUES (?)", "SELECT 1"], attempts: 1, failure: "constraint" },
    ]);
  });

  it("logs at warn once D1's duration passes slowQueryMs, and at debug up to it", async () => {
    const { records, logger } = capture();
    const at = makeD1Stub([], { duration: 250 }).db;
    const over = makeD1Stub([], { duration: 250.5 }).db;
    await createD1Client(at, { logger, slowQueryMs: 250 }).query(sql`SELECT 1`);
    await createD1Client(over, { logger, slowQueryMs: 250 }).query(sql`SELECT 1`);
    expect(records.map((record) => record.level)).toEqual(["debug", "warn"]);
  });
});
