import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import { healthCheck } from "../../app/health";
import { applyMiddlewareChain } from "../../app/middleware-chain";
import { bindingSetSchema } from "../../context/env-validation";
import { createLogger } from "../../logging/logger";
import type { LogRecord } from "../../logging/types";
import { fakeD1 } from "../../testing/fakes";
import { mapHandler } from "../../testing/route";
import { defineD1Binding } from "./mount";
import { INVENTORY_SELECT, RECORDED_FINGERPRINT_SELECT } from "./schema";
import { sql } from "./sql";

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
    channels: [{ write: (record: LogRecord) => void records.push(`${record.level} ${String(record.data?.state)}`) }],
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
});
