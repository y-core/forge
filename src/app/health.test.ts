import { describe, expect, it } from "bun:test";
import type { AppContext } from "../context/types";
import { Forge } from "./forge-app";
import { healthCheck } from "./health";
import { mapHandler } from "./route-test-helper";

function makeApp(checks: Parameters<typeof healthCheck>[0]) {
  const app = new Forge();
  mapHandler(app, "GET", "/health", healthCheck(checks));
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
});
