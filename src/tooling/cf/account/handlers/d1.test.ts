import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SyncResult, WranglerConfig } from "../../types";
import { syncBindings } from "../engine";
import { createD1Handler } from "./d1";
import { buildHandlers } from "./registry";
import type { HandlerContext } from "./types";

const AUTH = { apiToken: "tok", accountId: "acc" };

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return { auth: AUTH, scriptName: "worker", prefix: "", dryRun: false, rotate: new Set<string>(), fetch: globalThis.fetch, ...overrides };
}

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** A Cloudflare D1 API holding `databases`, recording every call and answering a named create with a fresh uuid. */
function fakeAccount(databases: Record<string, unknown>[]) {
  const calls: Call[] = [];
  const ok = (result: unknown) => new Response(JSON.stringify({ success: true, errors: [], messages: [], result }));
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body === undefined || init.body === null ? undefined : JSON.parse(String(init.body));
    calls.push({ method, path: url.pathname.replace("/client/v4", ""), body });
    if (method === "POST" && (body as { name?: string }).name === undefined) {
      return new Response(JSON.stringify({ success: false, errors: [{ code: 7400, message: "name is required" }], messages: [], result: null }), {
        status: 400,
      });
    }
    if (method === "POST") {
      const created = { uuid: `new-${calls.length}`, name: (body as { name: string }).name };
      databases.push(created);
      return ok(created);
    }
    return ok(databases);
  };
  return { calls, fetch };
}

const posts = (calls: readonly Call[]) => calls.filter((call) => call.method === "POST");

function recordingGets(fetch: typeof globalThis.fetch): { gets: URL[]; fetch: typeof globalThis.fetch } {
  const gets: URL[] = [];
  return {
    gets,
    fetch: async (input, init) => {
      if ((init?.method ?? "GET") === "GET") gets.push(new URL(String(input)));
      return fetch(input, init);
    },
  };
}

const listPages = (gets: readonly URL[]) =>
  gets.filter((url) => url.pathname === "/client/v4/accounts/acc/d1/database").map((url) => url.searchParams.get("page"));

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

describe("createD1Handler().extract()", () => {
  it("returns empty when no d1_databases", () => {
    expect(createD1Handler().extract({ name: "t" } as WranglerConfig)).toEqual([]);
  });

  it("returns d1_databases array", () => {
    const config: WranglerConfig = { name: "t", d1_databases: [{ binding: "DB", database_id: "x" }] };
    expect(createD1Handler().extract(config)).toHaveLength(1);
  });
});

describe("createD1Handler().reconcile()", () => {
  it("reports exists when remote db found by name", async () => {
    const fetchFn = makeFetch([{ uuid: "db-uuid", name: "MY_DB" }]);
    const res = await createD1Handler().reconcile([{ binding: "MY_DB" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.remoteId).toBe("db-uuid");
    expect(res.results[0]?.remoteName).toBe("MY_DB");
  });

  it("creates db when not found", async () => {
    const fetchFn = makeFetch([], { uuid: "new-uuid", name: "MY_DB" });
    const res = await createD1Handler().reconcile([{ binding: "MY_DB" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.action).toBe("created");
    expect(res.entries[0]?.database_id).toBe("new-uuid");
  });

  it("skips in dry-run", async () => {
    const res = await createD1Handler().reconcile([{ binding: "DB" }], makeCtx({ fetch: makeFetch([]), dryRun: true }));
    expect(res.results[0]?.action).toBe("would-create");
    expect([res.results[0]?.local, res.results[0]?.remote]).toEqual([true, false]);
    expect(res.results[0]?.remoteName).toBe("DB");
  });
});

describe("createD1Handler().reconcile() — the uuid is the identity", () => {
  it("matches by uuid whatever the database is named", async () => {
    const fetchFn = makeFetch([{ uuid: "db-legacy", name: "hand-made-db" }]);
    const res = await createD1Handler().reconcile([{ binding: "DB", database_id: "db-legacy" }], makeCtx({ fetch: fetchFn, prefix: "PROJ" }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.results[0]?.remoteName).toBe("hand-made-db");
  });

  it("leaves the config alone when the uuid resolves, never renaming it to the computed name", async () => {
    const fetchFn = makeFetch([{ uuid: "db-1", name: "actual-name" }]);
    const entry = { binding: "DB", database_id: "db-1", database_name: "actual-name" };
    const res = await createD1Handler().reconcile([entry], makeCtx({ fetch: fetchFn, prefix: "PROJ" }));
    expect(res.entries[0]).toEqual(entry);
  });

  it("treats an explicit database_name as the remote it means", async () => {
    const fetchFn = makeFetch([{ uuid: "db-2", name: "existing-db" }]);
    const res = await createD1Handler().reconcile([{ binding: "DB", database_name: "existing-db" }], makeCtx({ fetch: fetchFn, prefix: "PROJ" }));
    expect(res.results[0]?.action).toBe("in-sync");
    expect(res.entries[0]?.database_id).toBe("db-2");
  });

  it("falls back to the name when the uuid is stale, and says so", async () => {
    const fetchFn = makeFetch([{ uuid: "db-current", name: "DB" }]);
    const res = await createD1Handler().reconcile([{ binding: "DB", database_id: "db-gone" }], makeCtx({ fetch: fetchFn }));
    expect(res.results[0]?.remoteId).toBe("db-current");
    expect(res.results[0]?.detail).toBe("local id db-gone not found on this account");
  });
});

describe("createD1Handler().reconcile() — a list that failed", () => {
  const failing =
    (code: number, status: number): typeof globalThis.fetch =>
    async () =>
      new Response(JSON.stringify({ success: false, errors: [{ code, message: "nope" }], messages: [], result: null }), { status });

  it("names the surface it was compared against on a rejected list", async () => {
    const res = await createD1Handler().reconcile([{ binding: "DB" }], makeCtx({ fetch: failing(1, 500) }));
    expect(res.results[0]?.action).toBe("error");
    expect(res.results[0]?.detail).toBe("worker script · nope");
  });

  it("reports a list that 404s as unavailable rather than as an error", async () => {
    const res = await createD1Handler().reconcile([{ binding: "DB" }], makeCtx({ fetch: failing(7003, 404) }));
    expect(res.results[0]?.action).toBe("unavailable");
  });
});

describe("cf sync over a D1 binding with no database_id, through the full handler set", () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-cf-d1-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const handlers = () => buildHandlers({ configPath: join(dir, "wrangler.jsonc") });
  const config = (): WranglerConfig => ({ name: "myapp", d1_databases: [{ binding: "DB" }] });
  const d1Rows = (results: readonly SyncResult[]) =>
    results.filter((row) => row.resourceType === "d1_databases").map((row) => [row.binding, row.remoteName, row.action, row.detail]);

  it("adopts the account's MYAPP_DB on --commit, writing its id back and sending no POST", async () => {
    const { calls, fetch } = fakeAccount([{ uuid: "db-1", name: "MYAPP_DB" }]);
    const output = await syncBindings(config(), { auth: AUTH, dryRun: false }, handlers(), fetch);
    expect([d1Rows(output.results), output.updatedConfig.d1_databases, posts(calls)]).toEqual([
      [["DB", "MYAPP_DB", "in-sync", undefined]],
      [{ binding: "DB", database_id: "db-1", database_name: "MYAPP_DB" }],
      [],
    ]);
  });

  it("creates MYAPP_DB on an empty account with a body carrying the name alone", async () => {
    const { calls, fetch } = fakeAccount([]);
    await syncBindings(config(), { auth: AUTH, dryRun: false }, handlers(), fetch);
    expect(posts(calls).map(({ path, body }) => ({ path, body }))).toEqual([{ path: "/accounts/acc/d1/database", body: { name: "MYAPP_DB" } }]);
  });

  it("reports would-create with no detail on a dry run over an empty account", async () => {
    const { calls, fetch } = fakeAccount([]);
    const output = await syncBindings(config(), { auth: AUTH, dryRun: true }, handlers(), fetch);
    expect([d1Rows(output.results), posts(calls)]).toEqual([[["DB", "MYAPP_DB", "would-create", undefined]], []]);
  });
});

describe("createD1Handler() and D1 write access", () => {
  const UNVERIFIED = "D1 write access is unverified — a token without Account → D1 → Edit fails the first forge db migrate --target remote";
  const refusing: typeof globalThis.fetch = async (_input, init) =>
    (init?.method ?? "GET") === "POST"
      ? new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }], messages: [], result: null }), {
          status: 403,
        })
      : new Response(JSON.stringify({ success: true, errors: [], messages: [], result: [{ uuid: "db-1", name: "app-db" }] }));

  it("sends no POST but a declared database's create, and that one carries the database's name", async () => {
    const existing = fakeAccount([{ uuid: "db-1", name: "app-db" }]);
    await createD1Handler().reconcile([{ binding: "DB", database_id: "db-1" }], makeCtx({ fetch: existing.fetch }));
    const declared = fakeAccount([]);
    await createD1Handler().reconcile([{ binding: "NEW" }], makeCtx({ fetch: declared.fetch }));
    expect([posts(existing.calls), posts(declared.calls)]).toEqual([
      [],
      [{ method: "POST", path: "/accounts/acc/d1/database", body: { name: "NEW" } }],
    ]);
  });

  it("notes write access as unverified on --commit when no create was sent", async () => {
    const { fetch } = fakeAccount([{ uuid: "db-1", name: "app-db" }]);
    const res = await createD1Handler().reconcile([{ binding: "DB", database_id: "db-1" }], makeCtx({ fetch }));
    expect(res.notes).toEqual([UNVERIFIED]);
  });

  it("notes nothing once a create was sent, whether the account accepted it or refused it", async () => {
    const accepted = await createD1Handler().reconcile([{ binding: "DB" }], makeCtx({ fetch: fakeAccount([]).fetch }));
    const refused = await createD1Handler().reconcile([{ binding: "NEW" }], makeCtx({ fetch: refusing }));
    expect([accepted.notes, refused.notes, refused.results.map((row) => row.action)]).toEqual([undefined, undefined, ["error"]]);
  });

  it("sends nothing but the list on --commit when the account refused it, and still notes write access as unverified", async () => {
    const sent: Call[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      sent.push({ method: init?.method ?? "GET", path: new URL(String(input)).pathname.replace("/client/v4", ""), body: init?.body });
      return new Response(
        JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }], messages: [], result: null }),
        { status: 403 },
      );
    };
    const res = await createD1Handler().reconcile([{ binding: "DB", database_id: "db-1" }], makeCtx({ fetch }));
    expect([sent, res.notes]).toEqual([[{ method: "GET", path: "/accounts/acc/d1/database", body: undefined }], [UNVERIFIED]]);
  });

  it("notes nothing on a dry run, and sends no POST", async () => {
    const { calls, fetch } = fakeAccount([{ uuid: "db-1", name: "app-db" }]);
    const res = await createD1Handler().reconcile([{ binding: "DB", database_id: "db-1" }], makeCtx({ fetch, dryRun: true }));
    expect([posts(calls), res.notes]).toEqual([[], undefined]);
  });

  it("notes nothing for a config with no D1 database", async () => {
    const res = await createD1Handler().reconcile([], makeCtx({ fetch: fakeAccount([]).fetch }));
    expect(res.notes).toBeUndefined();
  });
});

describe("createD1Handler() reading the account", () => {
  const TWO = [
    { binding: "DB", database_id: "db-1", database_name: "app-db" },
    { binding: "LOGS", database_id: "db-2", database_name: "logs-db" },
  ];
  const twoAccount = () =>
    fakeAccount([
      { uuid: "db-1", name: "app-db" },
      { uuid: "db-2", name: "logs-db" },
    ]);

  it("lists the D1 databases once across reconcile and the env pass, with two bindings and an env block", async () => {
    const { gets, fetch } = recordingGets(twoAccount().fetch);
    const handler = createD1Handler();
    const run = makeCtx({ fetch, dryRun: true });
    await handler.reconcile(TWO, run);
    await handler.reconcileConfig?.({ name: "app", d1_databases: TWO, env: { staging: { d1_databases: TWO } } }, run);
    expect(listPages(gets)).toEqual(["1"]);
  });

  it("lists afresh for another run of the same handler", async () => {
    const { gets, fetch } = recordingGets(twoAccount().fetch);
    const handler = createD1Handler();
    await handler.reconcile(TWO, makeCtx({ fetch, dryRun: true }));
    await handler.reconcile(TWO, makeCtx({ fetch, dryRun: true }));
    expect(listPages(gets)).toEqual(["1", "1"]);
  });

  it("shows the env pass a database created under --commit, without listing again", async () => {
    const { gets, fetch } = recordingGets(fakeAccount([]).fetch);
    const handler = createD1Handler();
    const run = makeCtx({ fetch });
    const res = await handler.reconcile([{ binding: "DB", database_name: "app-db" }], run);
    const staging = [{ binding: "DB", database_name: "app-db" }];
    const pass = await handler.reconcileConfig?.({ name: "app", d1_databases: res.entries, env: { staging: { d1_databases: staging } } }, run);
    expect(pass?.results.map((row) => [row.binding, row.action, row.remoteId])).toEqual([
      ["env.staging.DB", "updated", res.entries[0]?.database_id],
    ]);
    expect([res.results.map((row) => row.action), listPages(gets)]).toEqual([["created"], ["1"]]);
  });
});
