import { describe, expect, it } from "bun:test";

import type { WranglerConfig } from "../../types";
import { d1Handler } from "./d1";
import type { HandlerContext } from "./types";

const AUTH = { apiToken: "tok", accountId: "acc" };

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    auth: AUTH,
    scriptName: "worker",
    prefix: "",
    dryRun: false,
    rotate: new Set<string>(),
    fetch: globalThis.fetch,
    target: { kind: "worker", name: "worker" },
    ...overrides,
  };
}

function makeFetch(dbs: unknown[], createResult?: unknown): typeof globalThis.fetch {
  let count = 0;
  return async (_url, init) => {
    if ((init?.method ?? "GET") === "POST") {
      count++;
      return new Response(
        JSON.stringify({ success: true, errors: [], messages: [], result: createResult ?? { uuid: `db-${count}`, name: "created" } }),
      );
    }
    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: dbs }));
  };
}

describe("d1Handler.extract()", () => {
  it("returns empty when no d1_databases", () => {
    expect(d1Handler.extract({ name: "t" } as WranglerConfig)).toEqual([]);
  });

  it("returns d1_databases array", () => {
    const config: WranglerConfig = { name: "t", d1_databases: [{ binding: "DB", database_id: "x" }] };
    expect(d1Handler.extract(config)).toHaveLength(1);
  });
});

describe("d1Handler.reconcile()", () => {
  it("reports exists when remote db found by name", async () => {
    const fetchFn = makeFetch([{ uuid: "db-uuid", name: "MY_DB" }]);
    const res = await d1Handler.reconcile([{ binding: "MY_DB" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.remoteId).toBe("db-uuid");
    expect(res.results[0]?.remoteName).toBe("MY_DB");
  });

  it("creates db when not found", async () => {
    const fetchFn = makeFetch([], { uuid: "new-uuid", name: "MY_DB" });
    const res = await d1Handler.reconcile([{ binding: "MY_DB" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("created");
    expect(res.entries[0]?.database_id).toBe("new-uuid");
  });

  it("skips in dry-run", async () => {
    const res = await d1Handler.reconcile([{ binding: "DB" }], makeCtx({ fetch: makeFetch([]), dryRun: true }));
    expect(res.results[0]?.action).toBe("would-create");
    expect([res.results[0]?.local, res.results[0]?.remote]).toEqual([true, false]);
    expect(res.results[0]?.remoteName).toBe("DB");
  });
});

describe("d1Handler.reconcile() — the uuid is the identity", () => {
  it("matches by uuid whatever the database is named", async () => {
    const fetchFn = makeFetch([{ uuid: "db-legacy", name: "hand-made-db" }]);
    const res = await d1Handler.reconcile([{ binding: "DB", database_id: "db-legacy" }], makeCtx({ fetch: fetchFn, prefix: "PROJ" }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.remoteName).toBe("hand-made-db");
  });

  it("leaves the config alone when the uuid resolves", async () => {
    // Rewriting database_name to the name this run would have computed put a name
    // in the config that no database on the account answers to.
    const fetchFn = makeFetch([{ uuid: "db-1", name: "actual-name" }]);
    const entry = { binding: "DB", database_id: "db-1", database_name: "actual-name" };
    const res = await d1Handler.reconcile([entry], makeCtx({ fetch: fetchFn, prefix: "PROJ" }));
    expect(res.entries[0]).toEqual(entry);
  });

  it("treats an explicit database_name as the remote it means", async () => {
    const fetchFn = makeFetch([{ uuid: "db-2", name: "existing-db" }]);
    const res = await d1Handler.reconcile([{ binding: "DB", database_name: "existing-db" }], makeCtx({ fetch: fetchFn, prefix: "PROJ" }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.entries[0]?.database_id).toBe("db-2");
  });

  it("falls back to the name when the uuid is stale, and says so", async () => {
    const fetchFn = makeFetch([{ uuid: "db-current", name: "DB" }]);
    const res = await d1Handler.reconcile([{ binding: "DB", database_id: "db-gone" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.remoteId).toBe("db-current");
    expect(res.results[0]?.detail).toBe("local id db-gone not found on this account");
  });
});

describe("d1Handler.reconcile() — a list that failed", () => {
  const failing =
    (code: number, status: number): typeof globalThis.fetch =>
    async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code, message: "nope" }], messages: [], result: null }), { status });

  it("names the surface it was compared against on a rejected list", async () => {
    const res = await d1Handler.reconcile([{ binding: "DB" }], makeCtx({ fetch: failing(1, 500) }));
    expect(res.results[0]?.action).toBe("error");
    expect(res.results[0]?.detail).toBe("worker script · nope");
  });

  it("reports a list that 404s as unavailable rather than as an error", async () => {
    const res = await d1Handler.reconcile([{ binding: "DB" }], makeCtx({ fetch: failing(7003, 404) }));
    expect(res.results[0]?.action).toBe("unavailable");
  });
});
