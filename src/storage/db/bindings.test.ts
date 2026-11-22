import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { Forge } from "../../app/forge-app";
import type { AppContext } from "../../context/types";
import { createLogger } from "../../logging/logger";
import { requestLogger } from "../../logging/request-logger";
import type { LogLevel, LogRecord } from "../../logging/types";
import { fakeD1 } from "../../testing/fakes";
import { captureLogs } from "../../testing/logs";
import { mapHandler } from "../../testing/route";
import { d1BindingSpec, resolveD1Client, validateD1Binding } from "./bindings";
import { createD1Client } from "./client";
import { sql } from "./sql";
import type { D1BindingOptions, D1Database, D1DatabaseLike, D1PreparedStatement, D1Result } from "./types";

const stubDb: D1Database = {
  prepare(): D1PreparedStatement {
    return {
      bind() {
        return this;
      },
      all<T>(): Promise<D1Result<T>> {
        return Promise.resolve({ results: [], success: true, meta: {} });
      },
      first<T>(): Promise<T | null> {
        return Promise.resolve(null);
      },
      run(): Promise<D1Result<unknown>> {
        return Promise.resolve({ results: [], success: true, meta: {} });
      },
    };
  },
  batch: () => Promise.resolve([]),
  exec: () => Promise.resolve({ count: 0, duration: 0 }),
};

describe("resolveD1Client", () => {
  it("returns a D1Client when the binding is present", async () => {
    const app = new Forge<{ DB: D1Database }>();
    mapHandler(app, "GET", "/", (c) => {
      const ctx = c as AppContext<{ DB: D1Database }>;
      const client = resolveD1Client(ctx, { binding: (appCtx) => (appCtx.env as { DB?: D1Database }).DB });
      return Response.json({ hasClient: client !== null });
    });
    const res = await app.request("/", {}, { DB: stubDb });
    expect(await res.json()).toEqual({ hasClient: true });
  });

  it("throws when binding is absent and required is true (default)", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    mapHandler(app, "GET", "/", (c) => {
      resolveD1Client(c as AppContext, { binding: () => undefined });
      return new Response("ok");
    });
    const res = await app.request("/");
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("D1 database binding not available");
  });

  it("returns null when binding is absent and required is false", async () => {
    const app = new Forge();
    mapHandler(app, "GET", "/", (c) => {
      const client = resolveD1Client(c as AppContext, { binding: () => undefined, required: false });
      return Response.json({ hasClient: client !== null });
    });
    const res = await app.request("/");
    expect(await res.json()).toEqual({ hasClient: false });
  });
});

interface CfD1Meta {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
}
type CfD1Result<T = unknown> = { success: true; meta: CfD1Meta & Record<string, unknown>; results: T[] };
interface CfD1PreparedStatement {
  bind(...values: unknown[]): CfD1PreparedStatement;
  first<T = unknown>(colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<CfD1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<CfD1Result<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}
interface CfD1DatabaseSession {
  prepare(query: string): CfD1PreparedStatement;
  batch<T = unknown>(statements: CfD1PreparedStatement[]): Promise<CfD1Result<T>[]>;
  getBookmark(): string | null;
}
interface CfD1Database {
  prepare(query: string): CfD1PreparedStatement;
  batch<T = unknown>(statements: CfD1PreparedStatement[]): Promise<CfD1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
  withSession(constraintOrBookmark?: string): CfD1DatabaseSession;
  dump(): Promise<ArrayBuffer>;
}

function timedD1(durationMs: number): D1Database {
  const meta = { duration: durationMs, rows_read: 0, rows_written: 0 };
  const statement: D1PreparedStatement = {
    bind() {
      return statement;
    },
    all: <T>() => Promise.resolve({ results: [] as T[], success: true as const, meta }),
    first: () => Promise.resolve(null),
    run: () => Promise.resolve({ results: [], success: true as const, meta }),
  };
  return { prepare: () => statement, batch: () => Promise.resolve([]), exec: () => Promise.resolve({ count: 0, duration: durationMs }) };
}

describe("resolveD1Client — with no client logger, under a request logger", () => {
  async function recorded(minLevel: LogLevel, perRequest: (c: AppContext<{ DB: D1Database }>) => Promise<void>): Promise<string[]> {
    const capture = captureLogs();
    const app = new Forge<{ DB: D1Database }>();
    app.use("*", requestLogger({ channels: () => [capture.channel], minLevel }));
    mapHandler(app, "GET", "/", async (c) => {
      await perRequest(c as AppContext<{ DB: D1Database }>);
      return new Response("ok");
    });
    await app.request("/", {}, { DB: timedD1(50) });
    return capture.records
      .filter((record) => record.message !== "request.completed")
      .map(({ level, message, data }) => `${level} ${message} ${String(data?.source)}`);
  }
  const binding = (c: AppContext<{ DB: D1Database }>) => c.env.DB;

  const cases: { name: string; minLevel: LogLevel; run: (c: AppContext<{ DB: D1Database }>) => Promise<void>; expected: string[] }[] = [
    {
      name: "drops the per-call debug d1.query",
      minLevel: "debug",
      run: async (c) => void (await resolveD1Client(c, { binding })?.query(sql`SELECT 1`)),
      expected: [],
    },
    {
      name: "passes a d1.query raised to warn by slowQueryMs",
      minLevel: "debug",
      run: async (c) => void (await resolveD1Client(c, { binding, client: { slowQueryMs: 10 } })?.query(sql`SELECT 1`)),
      expected: ["warn d1.query storage/db"],
    },
    {
      name: "passes the d1.request.budget warn",
      minLevel: "debug",
      run: async (c) => {
        const client = resolveD1Client(c, { binding });
        for (let id = 0; id < 11; id += 1) await client?.query(sql`SELECT * FROM users WHERE id = ${id}`);
      },
      expected: ["warn d1.request.budget storage/db"],
    },
    {
      name: "still yields to a request logger whose own minLevel is error",
      minLevel: "error",
      run: async (c) => {
        const client = resolveD1Client(c, { binding, client: { slowQueryMs: 10 } });
        for (let id = 0; id < 11; id += 1) await client?.query(sql`SELECT * FROM users WHERE id = ${id}`);
      },
      expected: [],
    },
  ];

  for (const { name, minLevel, run, expected } of cases) {
    it(name, async () => {
      expect(await recorded(minLevel, run)).toEqual(expected);
    });
  }

  it("keeps every debug d1.query for a client logger that is passed, with no floor of its own", async () => {
    const own = captureLogs();
    const records = await recorded("debug", async (c) => {
      const client = resolveD1Client(c, { binding, client: { logger: own.logger } });
      for (const n of [1, 2]) await client?.query(sql`SELECT ${n}`);
    });
    expect([records, own.records.map(({ level, message }) => `${level} ${message}`)]).toEqual([[], ["debug d1.query", "debug d1.query"]]);
  });
});

describe("D1DatabaseLike structural contract", () => {
  it("accepts a Cloudflare-shaped D1 database without a cast", () => {
    type Accepts = CfD1Database extends D1DatabaseLike ? true : false;
    const accepts: Accepts = true;

    const opts: D1BindingOptions<{ DB: CfD1Database }, CfD1Database> = { binding: (c) => c.env.DB };

    expect(accepts).toBe(true);
    expect(typeof opts.binding).toBe("function");
  });
});

describe("validateD1Binding", () => {
  it("passes when the binding exists", async () => {
    const app = new Forge<{ DB: D1Database }>();
    app.use("*", validateD1Binding("DB"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, { DB: stubDb });
    expect(res.status).toBe(200);
  });

  it("throws when the binding is missing", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateD1Binding("DB"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, {});
    expect(res.status).toBe(500);
  });

  it("rejects a value of the wrong shape (a string is not a D1 database)", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateD1Binding("DB"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, { DB: "not-a-db" } as never);
    expect(res.status).toBe(500);
  });

  it("rejects an object missing the prepare method", async () => {
    const app = new Forge();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", validateD1Binding("DB"));
    mapHandler(app, "GET", "/", () => new Response("ok"));
    const res = await app.request("/", {}, { DB: { batch: () => Promise.resolve([]) } } as never);
    expect(res.status).toBe(500);
  });
});

describe("d1BindingSpec", () => {
  it("holds the named binding to carrying prepare", () => {
    expect(d1BindingSpec("DB")).toEqual({ name: "DB", methods: ["prepare"], label: "a D1 database binding" });
  });
});

describe("resolveD1Client — the request's query budget", () => {
  function budgetApp(perRequest: (c: AppContext<{ DB: D1Database }>, logger: ReturnType<typeof createLogger>) => Promise<void>) {
    const records: LogRecord[] = [];
    const logger = createLogger("storage/db", { channels: [{ write: (record) => void records.push(record) }] });
    const app = new Forge<{ DB: D1Database }>();
    mapHandler(app, "GET", "/", async (c) => {
      await perRequest(c as AppContext<{ DB: D1Database }>, logger);
      return new Response("ok");
    });
    const budget = () => records.filter((record) => record.message === "d1.request.budget").map((record) => [record.level, record.data]);
    return { app, budget };
  }
  const binding = (c: AppContext<{ DB: D1Database }>) => c.env.DB;

  it("warns once at the eleventh run of one statement in a request, by default", async () => {
    const db = fakeD1(() => [{ id: 1 }]);
    const { app, budget } = budgetApp(async (c, logger) => {
      const client = resolveD1Client(c, { binding, client: { logger } });
      for (let id = 0; id < 12; id += 1) await client?.queryOne(sql`SELECT * FROM users WHERE id = ${id}`);
    });
    await app.request("/", {}, { DB: db });
    expect([db.calls.length, budget()]).toEqual([
      12,
      [["warn", { reason: "repeats", sql: "SELECT * FROM users WHERE id = ?\nLIMIT 1", runs: 11, queries: 11 }]],
    ]);
  });

  it("shares one tally between two clients resolved in the same request, and starts the next request afresh", async () => {
    const { app, budget } = budgetApp(async (c, logger) => {
      const options = { binding, client: { logger, queryBudget: { repeats: 1 } } };
      await resolveD1Client(c, options)?.execute(sql`DELETE FROM t WHERE id = ${1}`);
      await resolveD1Client(c, options)?.execute(sql`DELETE FROM t WHERE id = ${2}`);
    });
    const warning = ["warn", { reason: "repeats", sql: "DELETE FROM t WHERE id = ?", runs: 2, queries: 2 }];
    await app.request("/", {}, { DB: fakeD1() });
    expect(budget()).toEqual([warning]);
    await app.request("/", {}, { DB: fakeD1() });
    expect(budget()).toEqual([warning, warning]);
  });

  it("warns once two clients together reach the request's `queries`", async () => {
    const { app, budget } = budgetApp(async (c, logger) => {
      const options = { binding, client: { logger, queryBudget: { queries: 3 } } };
      for (const n of [1, 2]) await resolveD1Client(c, options)?.query(sql`SELECT ${n}`);
      await resolveD1Client(c, options)?.batch([sql`SELECT 3`, sql`SELECT 4`]);
    });
    await app.request("/", {}, { DB: fakeD1() });
    expect(budget()).toEqual([["warn", { reason: "queries", queries: 3 }]]);
  });

  it("counts nothing for a client made outside a request", async () => {
    const records: LogRecord[] = [];
    const logger = createLogger("storage/db", { channels: [{ write: (record) => void records.push(record) }] });
    const client = createD1Client(fakeD1(), { logger, queryBudget: { repeats: 1, queries: 1 } });
    for (let i = 0; i < 3; i += 1) await client.query(sql`SELECT 1`);
    expect(records.filter((record) => record.message === "d1.request.budget")).toEqual([]);
  });

  describe("with no client logger", () => {
    let log: ReturnType<typeof spyOn<Console, "log">> | undefined;
    afterEach(() => {
      log?.mockRestore();
    });
    const written = () => (log?.mock.calls ?? []).map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);

    it("writes the eleventh run of one statement to the console at warn", async () => {
      log = spyOn(console, "log").mockImplementation(() => {});
      const { app } = budgetApp(async (c) => {
        const client = resolveD1Client(c, { binding });
        for (let id = 0; id < 11; id += 1) await client?.queryOne(sql`SELECT * FROM users WHERE id = ${id}`);
      });
      await app.request("/", {}, { DB: fakeD1(() => [{ id: 1 }]) });
      expect(written().map(({ level, prefix, message, reason, runs }) => ({ level, prefix, message, reason, runs }))).toEqual([
        { level: "warn", prefix: "storage/db", message: "d1.request.budget", reason: "repeats", runs: 11 },
      ]);
    });

    it("writes nothing for a single query", async () => {
      log = spyOn(console, "log").mockImplementation(() => {});
      const { app } = budgetApp(async (c) => {
        await resolveD1Client(c, { binding })?.query(sql`SELECT 1`);
      });
      await app.request("/", {}, { DB: fakeD1() });
      expect(written()).toEqual([]);
    });

    it("writes the request's 900th call to the console at warn", async () => {
      log = spyOn(console, "log").mockImplementation(() => {});
      const { app } = budgetApp(async (c) => {
        const client = resolveD1Client(c, { binding });
        for (let n = 0; n < 900; n += 1) await client?.query(sql`SELECT ${n}`);
      });
      await app.request("/", {}, { DB: fakeD1() });
      expect(written().map(({ level, message, reason, queries }) => ({ level, message, reason, queries }))).toEqual([
        { level: "warn", message: "d1.request.budget", reason: "repeats", queries: 11 },
        { level: "warn", message: "d1.request.budget", reason: "queries", queries: 900 },
      ]);
    });

    it("sends the warning to a client logger that is passed, and nothing to the console", async () => {
      log = spyOn(console, "log").mockImplementation(() => {});
      const { app, budget } = budgetApp(async (c, logger) => {
        const client = resolveD1Client(c, { binding, client: { logger } });
        for (let id = 0; id < 11; id += 1) await client?.query(sql`SELECT * FROM users WHERE id = ${id}`);
      });
      await app.request("/", {}, { DB: fakeD1() });
      expect([budget(), written()]).toEqual([
        [["warn", { reason: "repeats", sql: "SELECT * FROM users WHERE id = ?", runs: 11, queries: 11 }]],
        [],
      ]);
    });
  });
});
