import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import type { AppContext } from "../../context/types";
import { createLogger } from "../../logging/logger";
import type { LogRecord } from "../../logging/types";
import { collectExecutionContext } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import { mapHandler } from "../../testing/route";
import { checkSchemaHealth, schemaHealthCheck, schemaHealthMonitor } from "./health";
import { INVENTORY_SELECT, RECORDED_FINGERPRINT_SELECT } from "./schema";
import type { D1DatabaseLike } from "./types";

const USERS_FINGERPRINT = "046121e94a6c7bc85d1b4f8a42890e238cd64a5ed53cf02e1e108c876021940e";
const EMPTY_FINGERPRINT = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const USERS_ROW = { type: "table", name: "users", tbl_name: "users", sql: "CREATE TABLE users (id)" };

function db(rows: Record<string, unknown>[] | null, inventory: Record<string, unknown>[] = [USERS_ROW]) {
  const reads: string[] = [];
  const database = fakeD1(
    (sql) => {
      reads.push(sql);
      if (sql === RECORDED_FINGERPRINT_SELECT) return rows ?? [];
      if (sql === INVENTORY_SELECT) return inventory;
      throw new Error(`unexpected statement: ${sql}`);
    },
    {
      failOn: (sql) => {
        if (rows === null && sql === RECORDED_FINGERPRINT_SELECT) {
          reads.push(sql);
          return new Error("D1_ERROR: no such table: _forge_migrations");
        }
        return null;
      },
    },
  );
  return Object.assign(database, { reads });
}

function capturingLogger() {
  const records: { level: string; message: string; data: Record<string, unknown> | undefined }[] = [];
  const logger = createLogger("storage/db", {
    channels: [{ write: (record: LogRecord) => void records.push({ level: record.level, message: record.message, data: record.data }) }],
  });
  return { logger, records };
}

type Env = { DB?: D1DatabaseLike };

describe("checkSchemaHealth()", () => {
  it("reports unavailable without reading the inventory when _forge_migrations does not exist", async () => {
    const database = db(null);
    expect(await checkSchemaHealth(database)).toEqual({ state: "unavailable", recorded: null, actual: null });
    expect(database.reads).toEqual([RECORDED_FINGERPRINT_SELECT]);
  });

  it("reports unrecorded when the migrations table has no rows", async () => {
    expect(await checkSchemaHealth(db([]))).toEqual({ state: "unrecorded", recorded: null, actual: USERS_FINGERPRINT });
  });

  it("reports unrecorded when the latest row's fingerprint is NULL", async () => {
    expect(await checkSchemaHealth(db([{ fingerprint: null }]))).toEqual({ state: "unrecorded", recorded: null, actual: USERS_FINGERPRINT });
  });

  it("reports match when the recorded fingerprint is what the schema hashes to now", async () => {
    expect(await checkSchemaHealth(db([{ fingerprint: USERS_FINGERPRINT }]))).toEqual({
      state: "match",
      recorded: USERS_FINGERPRINT,
      actual: USERS_FINGERPRINT,
    });
  });

  it("reports mismatch when the recorded fingerprint differs from what the schema hashes to now", async () => {
    expect(await checkSchemaHealth(db([{ fingerprint: EMPTY_FINGERPRINT }]))).toEqual({
      state: "mismatch",
      recorded: EMPTY_FINGERPRINT,
      actual: USERS_FINGERPRINT,
    });
  });

  it("hashes the empty string for a database with nothing of the app's in it", async () => {
    expect(await checkSchemaHealth(db([{ fingerprint: EMPTY_FINGERPRINT }], []))).toEqual({
      state: "match",
      recorded: EMPTY_FINGERPRINT,
      actual: EMPTY_FINGERPRINT,
    });
  });

  it("propagates any error other than a missing migrations table", async () => {
    const database = fakeD1(() => [], { failOn: () => new Error("D1_ERROR: database is locked") });
    await expect(checkSchemaHealth(database)).rejects.toThrow("D1_ERROR: database is locked");
  });
});

describe("schemaHealthCheck()", () => {
  const context = (DB?: D1DatabaseLike) => ({ env: { DB } }) as unknown as AppContext<Env>;
  const check = schemaHealthCheck<Env>((c) => c.env.DB);

  it("passes on match, unrecorded and unavailable", async () => {
    expect(await check(context(db([{ fingerprint: USERS_FINGERPRINT }])))).toBe(true);
    expect(await check(context(db([])))).toBe(true);
    expect(await check(context(db(null)))).toBe(true);
  });

  it("fails only on mismatch", async () => {
    expect(await check(context(db([{ fingerprint: EMPTY_FINGERPRINT }])))).toBe(false);
  });

  it("fails when the binding is absent", async () => {
    expect(await check(context(undefined))).toBe(false);
  });

  it("reads the schema once per env reference, so an unauthenticated health route costs two statements and not two per request", async () => {
    const database = db([{ fingerprint: USERS_FINGERPRINT }]);
    const cached = schemaHealthCheck<Env>((c) => c.env.DB);
    const env = { env: { DB: database } } as unknown as AppContext<Env>;

    expect([await cached(env), await cached(env), await cached(env)]).toEqual([true, true, true]);
    expect(database.reads).toEqual([RECORDED_FINGERPRINT_SELECT, INVENTORY_SELECT]);

    expect(await cached({ env: { DB: database } } as unknown as AppContext<Env>)).toBe(true);
    expect(database.reads).toEqual([RECORDED_FINGERPRINT_SELECT, INVENTORY_SELECT, RECORDED_FINGERPRINT_SELECT, INVENTORY_SELECT]);
  });

  it("recovers once a migration repairs the schema, without waiting for the isolate to recycle", async () => {
    const reads: string[] = [];
    let recorded = EMPTY_FINGERPRINT;
    const database = fakeD1((sql) => {
      reads.push(sql);
      if (sql === RECORDED_FINGERPRINT_SELECT) return [{ fingerprint: recorded }];
      if (sql === INVENTORY_SELECT) return [USERS_ROW];
      throw new Error(`unexpected statement: ${sql}`);
    });
    const recovering = schemaHealthCheck<Env>((c) => c.env.DB);
    const env = { env: { DB: database } } as unknown as AppContext<Env>;

    expect(await recovering(env)).toBe(false);
    expect(reads).toEqual([RECORDED_FINGERPRINT_SELECT, INVENTORY_SELECT]);

    recorded = USERS_FINGERPRINT;

    expect(await recovering(env)).toBe(true);
    expect(reads).toEqual([RECORDED_FINGERPRINT_SELECT, INVENTORY_SELECT, RECORDED_FINGERPRINT_SELECT, INVENTORY_SELECT]);
  });

  it("forgets a rejected probe, so the next request under the same env reads again rather than failing for the isolate's life", async () => {
    const reads: string[] = [];
    let failures = 1;
    const database = fakeD1(
      (sql) => {
        reads.push(sql);
        if (sql === RECORDED_FINGERPRINT_SELECT) return [{ fingerprint: USERS_FINGERPRINT }];
        if (sql === INVENTORY_SELECT) return [USERS_ROW];
        throw new Error(`unexpected statement: ${sql}`);
      },
      {
        failOn: (sql) => {
          if (sql !== RECORDED_FINGERPRINT_SELECT || failures === 0) return null;
          failures -= 1;
          reads.push(sql);
          return new Error("D1_ERROR: database is locked");
        },
      },
    );
    const retried = schemaHealthCheck<Env>((c) => c.env.DB);
    const env = { env: { DB: database } } as unknown as AppContext<Env>;

    await expect(retried(env)).rejects.toThrow("D1_ERROR: database is locked");
    expect(await retried(env)).toBe(true);
    expect(reads).toEqual([RECORDED_FINGERPRINT_SELECT, RECORDED_FINGERPRINT_SELECT, INVENTORY_SELECT]);
  });
});

describe("schemaHealthMonitor()", () => {
  function app(logger: ReturnType<typeof createLogger>) {
    const forge = new Forge<Env>();
    forge.use("*", schemaHealthMonitor<Env>({ binding: (c) => c.env.DB, logger }));
    mapHandler(forge, "GET", "/", () => new Response("ok"));
    return forge;
  }

  it("logs the state at info on match and serves the request", async () => {
    const { logger, records } = capturingLogger();
    const res = await app(logger).request("/", {}, { DB: db([{ fingerprint: USERS_FINGERPRINT }]) });
    expect(res.status).toBe(200);
    expect(records).toEqual([
      { level: "info", message: "d1.schema.health", data: { state: "match", recorded: USERS_FINGERPRINT, actual: USERS_FINGERPRINT } },
    ]);
  });

  it("logs at warn on mismatch and still serves the request", async () => {
    const { logger, records } = capturingLogger();
    const res = await app(logger).request("/", {}, { DB: db([{ fingerprint: EMPTY_FINGERPRINT }]) });
    expect(res.status).toBe(200);
    expect(records).toEqual([
      { level: "warn", message: "d1.schema.health", data: { state: "mismatch", recorded: EMPTY_FINGERPRINT, actual: USERS_FINGERPRINT } },
    ]);
  });

  it("logs unrecorded at info and unavailable at warn, which is closer to a misconfiguration", async () => {
    const { logger, records } = capturingLogger();
    const forge = app(logger);
    expect((await forge.request("/", {}, { DB: db([]) })).status).toBe(200);
    expect((await forge.request("/", {}, { DB: db(null) })).status).toBe(200);
    expect(records).toEqual([
      { level: "info", message: "d1.schema.health", data: { state: "unrecorded", recorded: null, actual: USERS_FINGERPRINT } },
      { level: "warn", message: "d1.schema.health", data: { state: "unavailable", recorded: null, actual: null } },
    ]);
  });

  it("reads once per env and records once", async () => {
    const { logger, records } = capturingLogger();
    const database = db([{ fingerprint: USERS_FINGERPRINT }]);
    const env = { DB: database };
    const forge = app(logger);
    await forge.request("/", {}, env);
    await forge.request("/", {}, env);
    expect(database.reads).toEqual([RECORDED_FINGERPRINT_SELECT, INVENTORY_SELECT]);
    expect(records).toHaveLength(1);
    await forge.request("/", {}, { DB: database });
    expect(records).toHaveLength(2);
  });

  // The observation writes nothing and gates nothing, so it rides `waitUntil` rather than the
  // request: a first request whose reads have not answered yet is served all the same.
  it("serves the first request of an isolate without waiting on the reads", async () => {
    const { logger, records } = capturingLogger();
    let answer = (): void => {};
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const database = db([{ fingerprint: USERS_FINGERPRINT }]);
    const slow: D1DatabaseLike = {
      ...database,
      prepare: (query) => {
        const statement = database.prepare(query);
        return { ...statement, all: async <T>() => held.then(() => statement.all<T>()) };
      },
    };

    // `request()` drains `waitUntil` before it returns, which is what this test must not do.
    const { executionCtx, pending: deferred, drain } = collectExecutionContext();

    const res = await app(logger).fetch(new Request("http://localhost/"), { DB: slow }, executionCtx);
    expect(res.status).toBe(200);
    expect(records).toEqual([]);
    expect(deferred).toHaveLength(1);

    answer();
    await drain();
    expect(records.map((record) => record.message)).toEqual(["d1.schema.health"]);
  });

  it("warns and serves when the binding is absent", async () => {
    const { logger, records } = capturingLogger();
    const res = await app(logger).request("/", {}, {});
    expect(res.status).toBe(200);
    expect(records).toEqual([{ level: "warn", message: "d1.schema.health.skipped", data: { reason: "binding absent" } }]);
  });

  it("warns and serves when the read throws", async () => {
    const { logger, records } = capturingLogger();
    const error = new Error("D1_ERROR: database is locked");
    const res = await app(logger).request("/", {}, { DB: fakeD1(() => [], { failOn: () => error }) });
    expect(res.status).toBe(200);
    expect(records).toEqual([
      { level: "warn", message: "d1.schema.health.failed", data: { error: { name: "Error", message: error.message, stack: error.stack } } },
    ]);
  });

  // The monitor's whole product is one record per isolate, and it rides `waitUntil`. A channel that
  // writes asynchronously loses that record unless `observe()` waits for it.
  it("holds waitUntil open until an asynchronous channel has written the record", async () => {
    const records: LogRecord[] = [];
    const logger = createLogger("storage/db", {
      channels: [{ write: (record: LogRecord) => new Promise<void>((resolve) => setTimeout(() => (records.push(record), resolve()), 5)) }],
    });
    const { executionCtx, drain } = collectExecutionContext();

    const res = await app(logger).fetch(new Request("http://localhost/"), { DB: db([{ fingerprint: USERS_FINGERPRINT }]) }, executionCtx);
    expect(res.status).toBe(200);
    expect(records).toEqual([]);

    await drain();
    expect(records.map((record) => record.message)).toEqual(["d1.schema.health"]);
  });
});
