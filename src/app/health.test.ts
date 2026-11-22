import { describe, expect, it } from "bun:test";

import type { AppContext } from "../context/types";
import { mapHandler } from "../testing/route";
import { Forge } from "./forge-app";
import { createHealthChecks, healthCheck } from "./health";
import type { HealthChecks } from "./types";

function makeApp(checks: Parameters<typeof healthCheck>[0], options?: Parameters<typeof healthCheck>[1]) {
  const app = new Forge();
  mapHandler(app, "GET", "/health", healthCheck(checks, options));
  return app;
}

describe("healthCheck", () => {
  it("returns ok:true and 200 when all checks pass", async () => {
    const app = makeApp({ db: () => true, cache: () => true });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; checks: Record<string, boolean> };
    expect(body.ok).toBe(true);
    expect(body.checks.db).toBe(true);
    expect(body.checks.cache).toBe(true);
  });

  it("returns ok:false and 503 when any check fails", async () => {
    const app = makeApp({ db: () => true, cache: () => false });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; checks: Record<string, boolean> };
    expect(body.ok).toBe(false);
    expect(body.checks.cache).toBe(false);
  });

  it("marks a check as false when it throws", async () => {
    const app = makeApp({
      db: () => {
        throw new Error("conn refused");
      },
    });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; checks: Record<string, boolean> };
    expect(body.checks.db).toBe(false);
  });

  it("supports async checks", async () => {
    const app = makeApp({ async: async () => true });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("sets cache-control: no-store", async () => {
    const app = makeApp({});
    const res = await app.request("/health");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns ok:true when checks object is empty", async () => {
    const app = makeApp({});
    const res = await app.request("/health");
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("passes context to check functions", async () => {
    type Env = { MY_VAR?: string };
    const app = new Forge<Env>();
    mapHandler(app, "GET", "/health", healthCheck<Env>({ myVar: (c: AppContext<Env>) => !!(c.env as Env).MY_VAR }));
    const res = await app.request("/health", {}, { MY_VAR: "present" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; checks: Record<string, boolean> };
    expect(body.checks.myVar).toBe(true);
  });

  it("reports a check still pending at the deadline as false, leaving the others their own result", async () => {
    const app = makeApp({ hung: () => new Promise<boolean>(() => {}), up: () => true, down: () => false }, { timeoutMs: 5 });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, checks: { hung: false, up: true, down: false } });
  });

  it("still passes an immediately answering check under a deadline of zero", async () => {
    const app = makeApp({ up: () => true, later: async () => true }, { timeoutMs: 0 });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: { up: true, later: true } });
  });

  it("waits well past a few milliseconds for a slow check when no deadline is given", async () => {
    const app = makeApp({ slow: () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 25)) });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: { slow: true } });
  });
});

describe("createHealthChecks", () => {
  it("reports every contribution's checks in array order", async () => {
    const health = createHealthChecks([{ db: () => true }, { cache: () => true, queue: () => true }]);
    const app = new Forge();
    mapHandler(app, "GET", "/health", health.handler());
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(Object.keys(((await res.json()) as { checks: Record<string, boolean> }).checks)).toEqual(["db", "cache", "queue"]);
    expect(Object.keys(createHealthChecks([{ cache: () => true }, { db: () => true }]).checks())).toEqual(["cache", "db"]);
  });

  describe("a check name two contributions share", () => {
    it("throws, naming the check", () => {
      expect(() => createHealthChecks([{ db: () => true }, { cache: () => true, db: () => false }])).toThrow(
        'createHealthChecks: the check "db" is already contributed.',
      );
    });

    it("names the first clashing check when a contribution repeats several", () => {
      expect(() =>
        createHealthChecks([
          { db: () => true, cache: () => true },
          { queue: () => true, cache: () => true, db: () => true },
        ]),
      ).toThrow('createHealthChecks: the check "cache" is already contributed.');
    });

    it("is not raised by distinct names", () => {
      expect(Object.keys(createHealthChecks([{ db: () => true }, { cache: () => true }]).checks())).toEqual(["db", "cache"]);
    });
  });
});

describe("createHealthChecks — the route it answers", () => {
  async function answer(health: HealthChecks, options?: Parameters<typeof healthCheck>[1]) {
    const app = new Forge();
    mapHandler(app, "GET", "/health", health.handler(options));
    const res = await app.request("/health");
    return { status: res.status, cacheControl: res.headers.get("cache-control"), body: (await res.json()) as unknown };
  }

  it("answers 200 with no checks when nothing is contributed", async () => {
    expect(await answer(createHealthChecks([]))).toEqual({ status: 200, cacheControl: "no-store", body: { ok: true, checks: {} } });
  });

  it("answers 503 when one contributed check fails, reporting the others' own results", async () => {
    const health = createHealthChecks([{ db: () => true }, { cache: () => false }]);
    expect(await answer(health)).toEqual({ status: 503, cacheControl: "no-store", body: { ok: false, checks: { db: true, cache: false } } });
  });

  it("reports a contributed check still pending at the handler's deadline as false", async () => {
    const health = createHealthChecks([{ hung: () => new Promise<boolean>(() => {}), up: () => true }]);
    expect(await answer(health, { timeoutMs: 10 })).toEqual({
      status: 503,
      cacheControl: "no-store",
      body: { ok: false, checks: { hung: false, up: true } },
    });
  });

  it("reports a contributed check that throws as false", async () => {
    const health = createHealthChecks([
      {
        db: () => {
          throw new Error("conn refused");
        },
      },
    ]);
    expect(await answer(health)).toEqual({ status: 503, cacheControl: "no-store", body: { ok: false, checks: { db: false } } });
  });

  it("hands each check this request's context", async () => {
    type Env = { MY_VAR?: string };
    const health = createHealthChecks<Env>([{ myVar: (c) => c.env.MY_VAR === "present" }]);
    const app = new Forge<Env>();
    mapHandler(app, "GET", "/health", health.handler());
    expect((await app.request("/health", {}, { MY_VAR: "present" })).status).toBe(200);
    expect((await app.request("/health", {}, {})).status).toBe(503);
  });
});

describe("createHealthChecks — what it holds", () => {
  it("returns a frozen result whose checks are frozen and the same on every read", async () => {
    const db = () => true;
    const health = createHealthChecks([{ db }]);
    expect(Object.isFrozen(health)).toBe(true);
    expect(Object.isFrozen(health.checks())).toBe(true);
    expect(health.checks()).toBe(health.checks());
    expect(() => {
      (health.checks() as Record<string, () => boolean>)["injected"] = () => false;
    }).toThrow(TypeError);

    expect(Object.keys(health.checks())).toEqual(["db"]);
    expect(health.checks()["db"]).toBe(db);
    const app = new Forge();
    mapHandler(app, "GET", "/health", health.handler());
    expect(await (await app.request("/health")).json()).toEqual({ ok: true, checks: { db: true } });
  });

  it("keeps its checks when a caller later changes a record it passed", () => {
    const passed: Record<string, () => boolean> = { db: () => true };
    const health = createHealthChecks([passed]);
    passed["late"] = () => false;
    expect(Object.keys(health.checks())).toEqual(["db"]);
  });

  it("accepts an empty contribution and adds nothing", () => {
    expect(createHealthChecks([{}]).checks()).toEqual({});
  });

  it("accepts a readonly record of checks, the shape a binding's mount hands out", () => {
    const mounted: Readonly<Record<string, (c: AppContext) => boolean | Promise<boolean>>> = Object.freeze({
      DB: () => true,
      "DB:schema": async () => true,
    });
    expect(Object.keys(createHealthChecks([mounted]).checks())).toEqual(["DB", "DB:schema"]);
  });
});
