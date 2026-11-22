import { describe, expect, it, spyOn } from "bun:test";

import { Forge } from "../../app/forge-app";
import { createHealthChecks, healthCheck } from "../../app/health";
import { applyMiddlewareChain } from "../../app/middleware-chain";
import { bindingSetSchema } from "../../context/env-validation";
import { createLogger } from "../../logging/logger";
import type { LogChannel, Logger, LogRecord, RequestLoggerOptions } from "../../logging/types";
import { requestIdCtx } from "../../security/request-id";
import { fakeD1 } from "../../testing/fakes";
import { captureLogs, quietChannel } from "../../testing/logs";
import { mapHandler } from "../../testing/route";
import { createD1Client } from "./client";
import type * as DbModule from "./mod";
import { defineD1Binding } from "./mount";
import { INVENTORY_SELECT, RECORDED_FINGERPRINT_SELECT } from "./schema";
import { sql } from "./sql";
import type { D1BindingMount, SqlFragment } from "./types";

const USERS_FINGERPRINT = "046121e94a6c7bc85d1b4f8a42890e238cd64a5ed53cf02e1e108c876021940e";
const EMPTY_FINGERPRINT = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function database(fingerprint: () => string | null | "no-table") {
  const reads: string[] = [];
  const db = fakeD1(
    (text) => {
      reads.push(text);
      if (text === RECORDED_FINGERPRINT_SELECT) {
        const value = fingerprint();
        return value === null ? [] : [{ fingerprint: value }];
      }
      if (text === INVENTORY_SELECT) return [{ type: "table", name: "users", tbl_name: "users", sql: "CREATE TABLE users (id)" }];
      return [{ id: 1 }];
    },
    {
      failOn: (text) =>
        text === RECORDED_FINGERPRINT_SELECT && fingerprint() === "no-table" ? new Error("D1_ERROR: no such table: _forge_migrations") : null,
    },
  );
  return Object.assign(db, { reads });
}

function mounted(options: { now?: () => number; recheckMs?: number } = {}) {
  const records: string[] = [];
  const logger = createLogger("storage/db", {
    channels: [
      {
        write: (record: LogRecord) => void (record.message === "d1.schema.health" && records.push(`${record.level} ${String(record.data?.state)}`)),
      },
    ],
  });
  const db = defineD1Binding({ name: "DB", logger, ...options });
  const app = new Forge();
  applyMiddlewareChain(app, { securityHeaders: {}, requestId: false, bindings: bindingSetSchema([db.spec]), globals: db.globals });
  mapHandler(app, "GET", "/health", healthCheck({ ...db.health }));
  let pinged = false;
  mapHandler(app, "GET", "/ping", () => {
    pinged = true;
    return new Response("pong");
  });
  mapHandler(app, "GET", "/users", async (context) => {
    const found = await db.client(context as never).query(sql`SELECT id FROM users`);
    return Response.json(found.ok ? found.data : null);
  });
  return { app, records, pinged: () => pinged };
}

function schemaReads(db: { reads: string[] }) {
  return [RECORDED_FINGERPRINT_SELECT, INVENTORY_SELECT].map((statement) => db.reads.filter((read) => read === statement).length);
}

async function elevenRuns(db: ReturnType<typeof defineD1Binding>) {
  const app = new Forge();
  mapHandler(app, "GET", "/users", async (context) => {
    const client = db.client(context as never);
    for (let id = 0; id < 11; id += 1) await client.query(sql`SELECT * FROM users WHERE id = ${id}`);
    return new Response("ok");
  });
  await app.request("/users", {}, { DB: fakeD1(() => [{ id: 1 }]) });
}

function logged(db: ReturnType<typeof defineD1Binding>) {
  const capture = captureLogs();
  const app = new Forge();
  applyMiddlewareChain(app, {
    securityHeaders: {},
    logging: { channels: () => [capture.channel], bindings: (c) => ({ requestId: requestIdCtx.getOptional(c) }) },
    globals: db.globals,
  });
  mapHandler(app, "GET", "/users", async (context) => {
    const client = db.client(context as never);
    for (let id = 0; id < 11; id += 1) await client.query(sql`SELECT * FROM users WHERE id = ${id}`);
    return new Response("ok");
  });
  return { app, records: capture.records };
}

function fromDb(records: readonly LogRecord[]) {
  const completed = records.find((record) => record.message === "request.completed");
  return records
    .filter((record) => record.data?.source === "storage/db")
    .map((record) => ({ level: record.level, message: record.message, sameRequest: record.data?.requestId === completed?.data?.requestId }));
}

async function silently<T>(run: () => Promise<T>): Promise<{ result: T; consoleLines: number }> {
  const written = spyOn(console, "log").mockImplementation(() => {});
  try {
    const result = await run();
    return { result, consoleLines: written.mock.calls.length };
  } finally {
    written.mockRestore();
  }
}

function consoleRecorder() {
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const saved = methods.map((method) => [method, console[method]] as const);
  const lines: string[] = [];
  for (const method of methods) console[method] = (...args: unknown[]) => void lines.push(`${method} ${args.map(String).join(" ")}`);
  return {
    lines,
    restore: () => {
      for (const [method, original] of saved) console[method] = original;
    },
  };
}

async function quietConsole<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const recorder = consoleRecorder();
  try {
    return { result: await run(), lines: recorder.lines };
  } finally {
    recorder.restore();
  }
}

interface Use {
  db: D1BindingMount<Record<string, unknown>>;
  statement: (id: number) => SqlFragment;
}

const users = (id: number) => sql`SELECT * FROM users WHERE id = ${id}`;
const audit = (id: number) => sql`SELECT * FROM audit WHERE id = ${id}`;

function chained(uses: Use[], logging: RequestLoggerOptions<Record<string, unknown>>) {
  const app = new Forge();
  applyMiddlewareChain(app, { securityHeaders: {}, logging, globals: uses.flatMap(({ db }) => db.globals) });
  mapHandler(app, "GET", "/users", async (context) => {
    for (const { db, statement } of uses) {
      const client = db.client(context as never);
      for (let id = 0; id < 11; id += 1) await client.query(statement(id));
    }
    return new Response("ok");
  });
  return app;
}

function capturedChain(uses: Use[]) {
  const capture = captureLogs();
  const app = chained(uses, { channels: () => [capture.channel], bindings: (c) => ({ requestId: requestIdCtx.getOptional(c) }) });
  return { app, records: capture.records };
}

function summary(record: LogRecord): string {
  const detail = record.data?.state ?? record.data?.sql ?? "";
  return `${record.level} ${record.message} ${String(detail)}`.trimEnd();
}

function byRequest(records: readonly LogRecord[]): { orphans: string[]; requests: string[][] } {
  const ids = records.filter((record) => record.message === "request.completed").map((record) => record.data?.requestId);
  const fromStorage = records.filter((record) => record.data?.source === "storage/db");
  return {
    orphans: fromStorage.filter((record) => !ids.includes(record.data?.requestId)).map(summary),
    requests: ids.map((id) =>
      fromStorage
        .filter((record) => record.data?.requestId === id)
        .map(summary)
        .sort(),
    ),
  };
}

async function nodeBundle(): Promise<typeof DbModule> {
  return (await import(new URL("./mod.node.mjs", import.meta.url).href)) as typeof DbModule;
}

function failures(records: readonly LogRecord[]): string[] {
  return records
    .filter((record) => record.message === "Unhandled error")
    .map((record) => record.data?.error as { type: string; detail: string })
    .map(({ type, detail }) => `${type}: ${detail.split(",")[0] ?? ""}`);
}

const REQUEST_FREE = "RequestFreeBundleError: forge's `node` export condition loads a request-free bundle";

async function health(app: Forge, env: Record<string, unknown>) {
  const res = await app.request("/health", {}, env);
  return { status: res.status, body: (await res.json()) as unknown };
}

describe("defineD1Binding()", () => {
  it("names the binding spec the boot check holds the env to", () => {
    expect(defineD1Binding({ name: "DB" }).spec).toEqual({ name: "DB", methods: ["prepare"], label: "a D1 database binding" });
  });

  it("refuses a request when the binding is missing, before any route runs", async () => {
    const { app, pinged } = mounted();
    expect([(await app.request("/ping", {}, {})).status, pinged()]).toEqual([500, false]);
    expect([(await app.request("/ping", {}, { DB: database(() => USERS_FINGERPRINT) })).status, pinged()]).toEqual([200, true]);
  });

  it("throws from client(c) when the binding is absent, rather than answering null", () => {
    expect(() => defineD1Binding({ name: "DB" }).client({ env: {} } as never)).toThrow("D1 database binding not available");
  });

  it("reports the binding and the schema as their own health checks, 200 on a match", async () => {
    const { app } = mounted();
    expect(await health(app, { DB: database(() => USERS_FINGERPRINT) })).toEqual({
      status: 200,
      body: { ok: true, checks: { DB: true, "DB:schema": true } },
    });
  });

  it("answers 503 on a schema mismatch, naming the schema check", async () => {
    const { app } = mounted();
    expect(await health(app, { DB: database(() => EMPTY_FINGERPRINT) })).toEqual({
      status: 503,
      body: { ok: false, checks: { DB: true, "DB:schema": false } },
    });
  });

  it("passes an unrecorded and an unavailable schema, which the monitor logs instead", async () => {
    const unrecorded = mounted();
    expect((await health(unrecorded.app, { DB: database(() => null) })).status).toBe(200);
    expect(unrecorded.records).toEqual(["info unrecorded"]);
    const unavailable = mounted();
    expect((await health(unavailable.app, { DB: database(() => "no-table") })).status).toBe(200);
    expect(unavailable.records).toEqual(["warn unavailable"]);
  });

  it("resolves a client over the binding", async () => {
    const { app } = mounted();
    expect(await (await app.request("/users", {}, { DB: database(() => USERS_FINGERPRINT) })).json()).toEqual([{ id: 1 }]);
  });

  it("re-reads the schema once the interval has passed under one env, so drift after the first check is seen", async () => {
    let clock = 1_000;
    let recorded = USERS_FINGERPRINT;
    const { app, records } = mounted({ now: () => clock, recheckMs: 60_000 });
    const db = database(() => recorded);
    const env = { DB: db };

    expect((await health(app, env)).status).toBe(200);
    recorded = EMPTY_FINGERPRINT;
    clock += 59_999;
    expect((await health(app, env)).status).toBe(200);
    clock += 1;
    expect((await health(app, env)).status).toBe(503);
    expect(records).toEqual(["info match", "warn mismatch"]);
  });

  it("reads the schema once per window for the monitor and the health check together, while healthy", async () => {
    let clock = 1_000;
    const { app, records } = mounted({ now: () => clock, recheckMs: 60_000 });
    const db = database(() => USERS_FINGERPRINT);
    const env = { DB: db };

    for (const path of ["/health", "/ping", "/health", "/users", "/health"]) expect((await app.request(path, {}, env)).status).toBe(200);
    expect(schemaReads(db)).toEqual([1, 1]);

    clock += 60_000;
    for (const path of ["/ping", "/health", "/health"]) expect((await app.request(path, {}, env)).status).toBe(200);
    expect(schemaReads(db)).toEqual([2, 2]);
    expect(records).toEqual(["info match", "info match"]);
  });

  it("re-reads on the next health poll after a mismatch, while the monitor reuses the verdict and logs it once", async () => {
    let recorded = EMPTY_FINGERPRINT;
    const { app, records } = mounted({ now: () => 1_000, recheckMs: 60_000 });
    const db = database(() => recorded);
    const env = { DB: db };

    expect((await health(app, env)).status).toBe(503);
    expect(schemaReads(db)).toEqual([1, 1]);

    expect((await app.request("/ping", {}, env)).status).toBe(200);
    expect([schemaReads(db), records]).toEqual([[1, 1], ["warn mismatch"]]);

    recorded = USERS_FINGERPRINT;
    expect(await health(app, env)).toEqual({ status: 200, body: { ok: true, checks: { DB: true, "DB:schema": true } } });
    expect([schemaReads(db), records]).toEqual([[2, 2], ["warn mismatch"]]);
  });

  it("writes the eleventh run of one statement to the console at warn when declared with only a name", async () => {
    const written = spyOn(console, "log").mockImplementation(() => {});
    try {
      await elevenRuns(defineD1Binding({ name: "DB" }));
      const lines = written.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
      expect(lines.map(({ level, prefix, message, reason, sql: text, runs }) => ({ level, prefix, message, reason, sql: text, runs }))).toEqual([
        { level: "warn", prefix: "storage/db", message: "d1.request.budget", reason: "repeats", sql: "SELECT * FROM users WHERE id = ?", runs: 11 },
      ]);
    } finally {
      written.mockRestore();
    }
  });

  it("routes the client's d1.request.budget warn to the top-level logger, and not to the console", async () => {
    const written = spyOn(console, "log").mockImplementation(() => {});
    try {
      const top: string[] = [];
      const logger = createLogger("storage/db", {
        channels: [{ write: (record: LogRecord) => void top.push(`${record.level} ${record.message}`) }],
      });
      await elevenRuns(defineD1Binding({ name: "DB", logger }));
      expect([top.filter((line) => line.startsWith("warn")), written.mock.calls.length]).toEqual([["warn d1.request.budget"], 0]);
    } finally {
      written.mockRestore();
    }
  });

  it("routes the client's records to client.logger over the top-level logger", async () => {
    const top: string[] = [];
    const own: string[] = [];
    const logger = createLogger("storage/db", { channels: [{ write: (record: LogRecord) => void top.push(record.message) }] });
    const clientLogger = createLogger("storage/db", {
      minLevel: "warn",
      channels: [{ write: (record: LogRecord) => void own.push(record.message) }],
    });
    await elevenRuns(defineD1Binding({ name: "DB", logger, client: { logger: clientLogger } }));
    expect([top, own]).toEqual([[], ["d1.request.budget"]]);
  });

  it("writes the monitor's record and the client's warn-and-above records to the request logger when declared with only a name, and nothing to the console", async () => {
    const { result, consoleLines } = await silently(async () => {
      const { app, records } = logged(defineD1Binding({ name: "DB" }));
      expect((await app.request("/users", {}, { DB: database(() => USERS_FINGERPRINT) })).status).toBe(200);
      return records;
    });
    expect([fromDb(result), consoleLines]).toEqual([
      [
        { level: "warn", message: "d1.request.budget", sameRequest: true },
        { level: "info", message: "d1.schema.health", sameRequest: true },
      ],
      0,
    ]);
    expect(result.find((record) => record.message === "request.completed")?.data?.requestId).toEqual(expect.any(String));
  });

  it("routes the monitor's and the client's records to an explicit logger over the request logger", async () => {
    const own: string[] = [];
    const logger: Logger = createLogger("storage/db", { channels: [{ write: (record: LogRecord) => void own.push(record.message) }] });
    const { app, records } = logged(defineD1Binding({ name: "DB", logger }));
    await app.request("/users", {}, { DB: database(() => USERS_FINGERPRINT) });
    expect([fromDb(records), own.filter((message) => message !== "d1.query")]).toEqual([[], ["d1.request.budget", "d1.schema.health"]]);
  });

  it("writes the monitor's record to the console outside a request logger", async () => {
    const db = defineD1Binding({ name: "DB" });
    const app = new Forge();
    applyMiddlewareChain(app, { securityHeaders: {}, globals: db.globals });
    mapHandler(app, "GET", "/ping", () => new Response("pong"));
    const written = spyOn(console, "log").mockImplementation(() => {});
    try {
      await app.request("/ping", {}, { DB: database(() => USERS_FINGERPRINT) });
      const lines = written.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
      expect(lines.map(({ level, prefix, message }) => ({ level, prefix, message }))).toEqual([
        { level: "info", prefix: "storage/db", message: "d1.schema.health" },
      ]);
    } finally {
      written.mockRestore();
    }
  });

  it("fills a createHealthChecks route with the binding and schema checks, and refuses the same binding twice", async () => {
    const db = defineD1Binding({ name: "DB" });
    const checks = createHealthChecks([db.health]);
    const app = new Forge();
    mapHandler(app, "GET", "/health", checks.handler());
    expect(await health(app, { DB: database(() => USERS_FINGERPRINT) })).toEqual({
      status: 200,
      body: { ok: true, checks: { DB: true, "DB:schema": true } },
    });
    expect(() => createHealthChecks([db.health, defineD1Binding({ name: "DB" }).health])).toThrow(
      'createHealthChecks: the check "DB" is already contributed.',
    );
  });
});

describe("defineD1Binding() declared with no logger, under the chain's request logger", () => {
  it("lands d1.schema.health.failed on the request's channels with its requestId when the schema read throws", async () => {
    const failing = fakeD1(() => [{ id: 1 }], {
      failOn: (text) => (text === RECORDED_FINGERPRINT_SELECT ? new Error("D1_ERROR: database is locked") : null),
    });
    const { app, records } = capturedChain([{ db: defineD1Binding({ name: "DB" }), statement: users }]);
    const { result: status, lines } = await quietConsole(async () => (await app.request("/users", {}, { DB: failing })).status);
    const failed = records.filter((record) => record.message === "d1.schema.health.failed");
    expect([status, lines, byRequest(records)]).toEqual([
      200,
      [],
      { orphans: [], requests: [["warn d1.request.budget SELECT * FROM users WHERE id = ?", "warn d1.schema.health.failed"]] },
    ]);
    expect((failed[0]?.data?.error as { detail?: unknown } | undefined)?.detail).toBe("D1_ERROR: database is locked");
  });

  it("prints nothing to any console method for a whole request when the chain's channels are quietChannel()", async () => {
    const db = defineD1Binding({ name: "DB" });
    const app = chained([{ db, statement: users }], { channels: () => [quietChannel()] });
    const { result: status, lines } = await quietConsole(
      async () => (await app.request("/users", {}, { DB: database(() => EMPTY_FINGERPRINT) })).status,
    );
    expect([status, lines]).toEqual([200, []]);
  });

  it("writes to channels an app builds from env, as (c) => [c.env.LOGS] does", async () => {
    const capture = captureLogs();
    const db = defineD1Binding({ name: "DB" });
    const app = chained([{ db, statement: users }], { channels: (c) => [(c.env as { LOGS: LogChannel }).LOGS] });
    const { lines } = await quietConsole(() => app.request("/users", {}, { DB: database(() => USERS_FINGERPRINT), LOGS: capture.channel }));
    expect([lines, capture.records.filter((record) => record.data?.source === "storage/db").map(summary)]).toEqual([
      [],
      ["warn d1.request.budget SELECT * FROM users WHERE id = ?", "info d1.schema.health match"],
    ]);
  });

  const precedence: {
    name: string;
    declare: (definition: Logger, client: Logger) => Parameters<typeof defineD1Binding>[0];
    expected: { request: string[]; definition: string[]; client: string[] };
  }[] = [
    {
      name: "neither logger: the monitor and the floored client both write to the request logger",
      declare: () => ({ name: "DB" }),
      expected: { request: ["info d1.schema.health", "warn d1.request.budget"], definition: [], client: [] },
    },
    {
      name: "only logger: the monitor and the unfloored client both write to it",
      declare: (definition) => ({ name: "DB", logger: definition }),
      expected: { request: [], definition: ["debug d1.query", "info d1.schema.health", "warn d1.request.budget"], client: [] },
    },
    {
      name: "only client.logger: the client writes to it and the monitor to the request logger",
      declare: (_, client) => ({ name: "DB", client: { logger: client } }),
      expected: { request: ["info d1.schema.health"], definition: [], client: ["debug d1.query", "warn d1.request.budget"] },
    },
    {
      name: "both: the client writes to client.logger and the monitor to logger",
      declare: (definition, client) => ({ name: "DB", logger: definition, client: { logger: client } }),
      expected: { request: [], definition: ["info d1.schema.health"], client: ["debug d1.query", "warn d1.request.budget"] },
    },
  ];

  for (const { name, declare, expected } of precedence) {
    it(`routes each record by precedence with ${name}`, async () => {
      const definition = captureLogs();
      const client = captureLogs();
      const kinds = (records: readonly LogRecord[]) => [...new Set(records.map(({ level, message }) => `${level} ${message}`))].sort();
      const { app, records } = capturedChain([{ db: defineD1Binding(declare(definition.logger, client.logger)), statement: users }]);
      const { lines } = await quietConsole(() => app.request("/users", {}, { DB: database(() => USERS_FINGERPRINT) }));
      expect({
        request: kinds(records.filter((record) => record.data?.source === "storage/db")),
        definition: kinds(definition.records),
        client: kinds(client.records),
        console: lines,
      }).toEqual({ ...expected, console: [] });
    });
  }

  it("stamps one request's requestId on every record from each of the bindings it uses", async () => {
    const { app, records } = capturedChain([
      { db: defineD1Binding({ name: "DB" }), statement: users },
      { db: defineD1Binding({ name: "AUDIT" }), statement: audit },
    ]);
    await quietConsole(() => app.request("/users", {}, { DB: database(() => USERS_FINGERPRINT), AUDIT: database(() => EMPTY_FINGERPRINT) }));
    expect(byRequest(records)).toEqual({
      orphans: [],
      requests: [
        [
          "info d1.schema.health match",
          "warn d1.request.budget SELECT * FROM audit WHERE id = ?",
          "warn d1.request.budget SELECT * FROM users WHERE id = ?",
          "warn d1.schema.health mismatch",
        ],
      ],
    });
  });

  it("keeps each of two concurrent requests' records under that request's own requestId", async () => {
    const { app, records } = capturedChain([{ db: defineD1Binding({ name: "DB" }), statement: users }]);
    await quietConsole(() =>
      Promise.all([
        app.request("/users", {}, { DB: database(() => USERS_FINGERPRINT) }),
        app.request("/users", {}, { DB: database(() => EMPTY_FINGERPRINT) }),
      ]),
    );
    const ids = records.filter((record) => record.message === "request.completed").map((record) => record.data?.requestId);
    expect([new Set(ids).size, byRequest(records)]).toEqual([
      2,
      {
        orphans: [],
        requests: expect.arrayContaining([
          ["info d1.schema.health match", "warn d1.request.budget SELECT * FROM users WHERE id = ?"],
          ["warn d1.request.budget SELECT * FROM users WHERE id = ?", "warn d1.schema.health mismatch"],
        ]),
      },
    ]);
  });

  it("refuses the node bundle's client against a request, naming the node condition as request-free", async () => {
    const bundled = await nodeBundle();
    const { app, records } = capturedChain([{ db: { ...bundled.defineD1Binding({ name: "DB" }), globals: [] }, statement: users }]);
    const { result: status, lines } = await quietConsole(
      async () => (await app.request("/users", {}, { DB: database(() => USERS_FINGERPRINT) })).status,
    );
    expect([status, lines, byRequest(records), failures(records)]).toEqual([500, [], { orphans: [], requests: [[]] }, [REQUEST_FREE]]);
  });

  it("refuses a request at the node bundle's monitor, naming the node condition as request-free", async () => {
    const bundled = await nodeBundle();
    const db = bundled.defineD1Binding({ name: "DB" });
    const { app, records } = capturedChain([{ db, statement: () => sql`SELECT 1` }]);
    const { result: status } = await quietConsole(async () => (await app.request("/users", {}, { DB: database(() => USERS_FINGERPRINT) })).status);
    expect([status, byRequest(records), failures(records)]).toEqual([500, { orphans: [], requests: [] }, [REQUEST_FREE]]);
  });

  it("logs each binding's verdict once per window, on the request that started its read, and again on the request after the window", async () => {
    let clock = 1_000;
    const window = { now: () => clock, recheckMs: 60_000 };
    const { app, records } = capturedChain([
      { db: defineD1Binding({ name: "DB", ...window }), statement: users },
      { db: defineD1Binding({ name: "AUDIT", ...window }), statement: audit },
    ]);
    const env = { DB: database(() => USERS_FINGERPRINT), AUDIT: database(() => EMPTY_FINGERPRINT) };
    await quietConsole(async () => {
      for (const advance of [0, 59_999, 1, 0]) {
        clock += advance;
        await app.request("/users", {}, env);
      }
    });
    const verdicts = byRequest(records).requests.map((request) => request.filter((entry) => entry.includes("d1.schema.health")));
    expect(verdicts).toEqual([
      ["info d1.schema.health match", "warn d1.schema.health mismatch"],
      [],
      ["info d1.schema.health match", "warn d1.schema.health mismatch"],
      [],
    ]);
  });
});

describe("the node bundle of storage/db, with no request", () => {
  it("answers a query built by its own sql as the source's client does", async () => {
    const bundled = await nodeBundle();
    const rows = () => fakeD1((text) => (text.startsWith("SELECT id FROM users WHERE id = ?") ? [{ id: 7 }] : []));
    const fromBundle = await bundled.createD1Client(rows()).queryOne(bundled.sql`SELECT id FROM users WHERE id = ${7}`);
    const fromSource = await createD1Client(rows()).queryOne(sql`SELECT id FROM users WHERE id = ${7}`);
    expect([fromBundle.ok && fromBundle.data, fromSource.ok && fromSource.data]).toEqual([{ id: 7 }, { id: 7 }]);
  });
});
