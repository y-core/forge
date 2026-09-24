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
    expect(res).toEqual({ ok: true, data: [{ id: 1 }] });
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
    expect(res).toEqual({ ok: true, data: { name: "Bob" } });
  });

  it("returns null when no rows", async () => {
    const { db } = makeD1Stub([]);
    const client = createD1Client(db);
    const res = await client.queryOne(sql`SELECT * FROM t WHERE 0`);
    expect(res).toEqual({ ok: true, data: null });
  });
});

describe("createD1Client — execute", () => {
  it("returns rowsWritten from meta", async () => {
    const { db } = makeD1Stub([], { rows_written: 3 });
    const client = createD1Client(db);
    const res = await client.execute(sql`UPDATE t SET x = ${1}`);
    expect(res).toEqual({ ok: true, data: { rowsWritten: 3, lastRowId: undefined } });
  });
});

// `rows_written` counts index rows as well, so on a guarded write it is the wrong number: only
// `changes` answers "did this statement match a row".
describe("createD1Client — which write count it believes", () => {
  it("prefers `changes` over `rows_written`, so an unmatched write reads as zero", async () => {
    const { db } = makeD1Stub([], { changes: 0, rows_written: 2 });
    const client = createD1Client(db);
    expect(await client.execute(sql`UPDATE t SET x = ${1} WHERE 0`)).toEqual({ ok: true, data: { rowsWritten: 0, lastRowId: undefined } });
  });

  it("falls back to `rows_written` where the driver reports no `changes` at all", async () => {
    const { db } = makeD1Stub([], { rows_written: 3 });
    const client = createD1Client(db);
    expect(await client.execute(sql`UPDATE t SET x = ${1}`)).toEqual({ ok: true, data: { rowsWritten: 3, lastRowId: undefined } });
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
    expect(res.error.cause).toBe(thrown);
  });

  it("passes an overflow through unchanged when no guard is in the batch", async () => {
    const thrown = overflow();
    const client = createD1Client(rejectingBatch(thrown));
    const res = await client.batch([sql`SELECT abs(-9223372036854775808)`]);
    expect(res).toEqual({ ok: false, error: thrown });
  });

  it("passes any other D1 error through unchanged even with a guard present", async () => {
    const thrown = new Error("D1_ERROR: no such table: t: SQLITE_ERROR");
    const client = createD1Client(rejectingBatch(thrown));
    const res = await client.batch([sql`UPDATE t SET a = 1`, requireRowsWritten()]);
    expect(res).toEqual({ ok: false, error: thrown });
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
