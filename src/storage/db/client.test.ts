import { describe, expect, it } from "bun:test";
import { createD1Client } from "./client";
import { sql } from "./sql";
import type { D1Database, D1PreparedStatement, D1Result } from "./types";

type BoundCall = { text: string; params: unknown[] };

function makeD1Stub(rows: unknown[] = [], meta: D1Result<unknown>["meta"] = {}): { db: D1Database; calls: BoundCall[] } {
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
      return statements.map(() => ({ results: rows as T[], success: true, meta }));
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

describe("createD1Client — batch", () => {
  it("executes multiple fragments as a batch", async () => {
    const { db } = makeD1Stub([]);
    const client = createD1Client(db);
    const res = await client.batch([sql`INSERT INTO t (a) VALUES (${1})`, sql`INSERT INTO t (a) VALUES (${2})`]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toHaveLength(2);
  });
});
