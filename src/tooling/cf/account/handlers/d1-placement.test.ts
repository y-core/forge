import { describe, expect, it } from "bun:test";

import type { D1Placement } from "../../types";
import { createD1Handler } from "./d1";
import { d1CreateBody, describePlacement } from "./d1-placement";
import type { HandlerContext } from "./types";

const AUTH = { apiToken: "tok", accountId: "acc" };

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
      const { name, jurisdiction } = body as { name: string; jurisdiction?: string };
      const created = { uuid: `new-${calls.length}`, name, ...(jurisdiction === undefined ? {} : { jurisdiction }) };
      databases.push(created);
      return ok(created);
    }
    if (method === "PUT") return ok({ ...databases[0], ...(body as object) });
    const id = url.pathname.split("/").at(-1);
    const one = databases.find((db) => db.uuid === id);
    return ok(one ?? databases);
  };
  return { calls, fetch };
}

function ctx(fetch: typeof globalThis.fetch, dryRun: boolean): HandlerContext {
  return { auth: AUTH, scriptName: "worker", prefix: "", dryRun, rotate: new Set<string>(), fetch };
}

const EU: D1Placement = { jurisdiction: "eu", location: "weur", readReplication: "auto" };

describe("d1CreateBody()", () => {
  it("sends the body wrangler d1 create sends, and only the keys declared", () => {
    expect([d1CreateBody("app-db", EU), d1CreateBody("app-db", undefined)]).toEqual([
      { name: "app-db", jurisdiction: "eu", primary_location_hint: "weur" },
      { name: "app-db" },
    ]);
  });
});

describe("describePlacement()", () => {
  it("names each declared part, and nothing for no placement", () => {
    expect([describePlacement(EU), describePlacement({}), describePlacement(undefined)]).toEqual([
      "with jurisdiction eu, location weur, read replication auto",
      undefined,
      undefined,
    ]);
  });
});

describe("createD1Handler() with a placement", () => {
  it("shows the placement on a dry run's would-create, and sends nothing", async () => {
    const { calls, fetch } = fakeAccount([]);
    const res = await createD1Handler({ DB: EU }).reconcile([{ binding: "DB", database_name: "app-db" }], ctx(fetch, true));
    expect(res.results.map((row) => [row.action, row.detail])).toEqual([
      ["would-create", "with jurisdiction eu, location weur, read replication auto"],
    ]);
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("creates with the jurisdiction and location hint on --commit", async () => {
    const { calls, fetch } = fakeAccount([]);
    const res = await createD1Handler({ DB: { jurisdiction: "eu", location: "weur" } }).reconcile(
      [{ binding: "DB", database_name: "app-db" }],
      ctx(fetch, false),
    );
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "app-db", jurisdiction: "eu", primary_location_hint: "weur" });
    expect(res.results.map((row) => row.action)).toEqual(["created"]);
  });

  it("refuses a database whose jurisdiction differs, as unfixable in place", async () => {
    const { fetch } = fakeAccount([{ uuid: "db-1", name: "app-db" }]);
    const res = await createD1Handler({ DB: { jurisdiction: "eu" } }).reconcile([{ binding: "DB", database_id: "db-1" }], ctx(fetch, true));
    expect(res.results.map((row) => [row.action, row.detail])).toEqual([
      ["in-sync", undefined],
      [
        "refused",
        "jurisdiction is unset, declared eu — a jurisdiction is set only when a database is created, so this needs a new database and a data move",
      ],
    ]);
  });

  it("accepts a database already in its declared jurisdiction", async () => {
    const { fetch } = fakeAccount([{ uuid: "db-1", name: "app-db", jurisdiction: "eu" }]);
    const res = await createD1Handler({ DB: { jurisdiction: "eu" } }).reconcile([{ binding: "DB", database_id: "db-1" }], ctx(fetch, true));
    expect(res.results.map((row) => row.action)).toEqual(["in-sync"]);
  });

  it("reports a replication mismatch as drift on a dry run, writing nothing", async () => {
    const { calls, fetch } = fakeAccount([{ uuid: "db-1", name: "app-db", read_replication: { mode: "disabled" } }]);
    const res = await createD1Handler({ DB: { readReplication: "auto" } }).reconcile([{ binding: "DB", database_id: "db-1" }], ctx(fetch, true));
    expect(res.results.map((row) => [row.action, row.detail])).toEqual([
      ["in-sync", undefined],
      ["drift", "read replication is disabled, declared auto"],
    ]);
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("sets the replication mode on --commit with a PUT, and reports it updated", async () => {
    const { calls, fetch } = fakeAccount([{ uuid: "db-1", name: "app-db" }]);
    const res = await createD1Handler({ DB: { readReplication: "auto" } }).reconcile([{ binding: "DB", database_id: "db-1" }], ctx(fetch, false));
    expect(calls.filter((call) => call.method === "PUT")).toEqual([
      { method: "PUT", path: "/accounts/acc/d1/database/db-1", body: { read_replication: { mode: "auto" } } },
    ]);
    expect(res.results.at(-1)).toMatchObject({ action: "updated", detail: "read replication disabled → auto" });
  });

  it("leaves a binding with no declared placement to the plain handler", async () => {
    const { calls, fetch } = fakeAccount([{ uuid: "db-1", name: "app-db" }]);
    const res = await createD1Handler({ OTHER: EU }).reconcile([{ binding: "DB", database_id: "db-1" }], ctx(fetch, false));
    expect([res.results.map((row) => row.action), calls.map((call) => call.method)]).toEqual([["in-sync"], ["GET"]]);
  });
});

describe("createD1Handler() with a declared preview database", () => {
  it("would create <name>-preview with the same placement on a dry run", async () => {
    const { fetch } = fakeAccount([{ uuid: "db-1", name: "app-db" }]);
    const res = await createD1Handler({ DB: { preview: true, location: "weur" } }).reconcile(
      [{ binding: "DB", database_id: "db-1", database_name: "app-db" }],
      ctx(fetch, true),
    );
    expect(res.results.at(-1)).toMatchObject({
      binding: "DB (preview)",
      remoteName: "app-db-preview",
      action: "would-create",
      detail: "with location weur",
    });
    expect(res.entries[0]?.preview_database_id).toBeUndefined();
  });

  it("creates it on --commit and writes its id back as preview_database_id", async () => {
    const { calls, fetch } = fakeAccount([{ uuid: "db-1", name: "app-db" }]);
    const res = await createD1Handler({ DB: { preview: true, jurisdiction: "eu" } }).reconcile(
      [{ binding: "DB", database_id: "db-1", database_name: "app-db", jurisdiction: undefined } as never],
      ctx(fetch, false),
    );
    const post = calls.find((call) => call.method === "POST");
    expect(post?.body).toEqual({ name: "app-db-preview", jurisdiction: "eu" });
    expect(res.entries[0]?.preview_database_id).toBe(res.results.at(-1)?.remoteId);
    expect(res.results.at(-1)?.action).toBe("created");
  });

  it("finds an existing preview database by name and writes its id back on --commit, reported updated", async () => {
    const { calls, fetch } = fakeAccount([
      { uuid: "db-1", name: "app-db" },
      { uuid: "db-2", name: "app-db-preview" },
    ]);
    const res = await createD1Handler({ DB: { preview: true } }).reconcile(
      [{ binding: "DB", database_id: "db-1", database_name: "app-db" }],
      ctx(fetch, false),
    );
    expect([res.entries[0]?.preview_database_id, res.results.at(-1)?.action, calls.some((call) => call.method === "POST")]).toEqual([
      "db-2",
      "updated",
      false,
    ]);
  });

  it("reports a stale preview_database_id as drift on a dry run, naming it, and leaves the entry alone", async () => {
    const { fetch } = fakeAccount([
      { uuid: "db-1", name: "app-db" },
      { uuid: "db-2", name: "app-db-preview" },
    ]);
    const entry = { binding: "DB", database_id: "db-1", database_name: "app-db", preview_database_id: "db-stale" };
    const res = await createD1Handler({ DB: { preview: true } }).reconcile([entry], ctx(fetch, true));
    expect(res.results.at(-1)).toMatchObject({
      action: "drift",
      detail: "preview_database_id db-stale names no database on this account; app-db-preview is db-2 — --commit writes it back",
    });
    expect(res.entries[0]).toEqual(entry);
  });

  it("reports a stale preview_database_id updated on --commit, writing the found id", async () => {
    const { fetch } = fakeAccount([
      { uuid: "db-1", name: "app-db" },
      { uuid: "db-2", name: "app-db-preview" },
    ]);
    const res = await createD1Handler({ DB: { preview: true } }).reconcile(
      [{ binding: "DB", database_id: "db-1", database_name: "app-db", preview_database_id: "db-stale" }],
      ctx(fetch, false),
    );
    expect([res.results.at(-1)?.action, res.entries[0]?.preview_database_id]).toEqual(["updated", "db-2"]);
  });

  it("is in sync when the stored preview id resolves", async () => {
    const { fetch } = fakeAccount([
      { uuid: "db-1", name: "app-db" },
      { uuid: "db-2", name: "app-db-preview" },
    ]);
    const res = await createD1Handler({ DB: { preview: true } }).reconcile(
      [{ binding: "DB", database_id: "db-1", database_name: "app-db", preview_database_id: "db-2" }],
      ctx(fetch, true),
    );
    expect(res.results.at(-1)?.action).toBe("in-sync");
  });

  it("names the preview of an entry with no database_name by the prefixed rule, so two Workers binding DB never share one", async () => {
    const { calls, fetch } = fakeAccount([{ uuid: "db-1", name: "APP_DB" }]);
    await createD1Handler({ DB: { preview: true } }).reconcile([{ binding: "DB", database_id: "db-1" }], { ...ctx(fetch, false), prefix: "APP" });
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "APP_DB-preview" });
  });
});

describe("createD1Handler() and D1 write access", () => {
  const UNVERIFIED = "D1 write access is unverified — a token without Account → D1 → Edit fails the first forge db migrate or deploy";
  const refusing: typeof globalThis.fetch = async (_input, init) =>
    (init?.method ?? "GET") === "POST"
      ? new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }], messages: [], result: null }), {
          status: 403,
        })
      : new Response(JSON.stringify({ success: true, errors: [], messages: [], result: [{ uuid: "db-1", name: "app-db" }] }));
  const posts = (calls: readonly Call[]) => calls.filter((call) => call.method === "POST");

  it("sends no POST but a declared database's create, and that one carries the database's name", async () => {
    const existing = fakeAccount([{ uuid: "db-1", name: "app-db" }]);
    await createD1Handler().reconcile([{ binding: "DB", database_id: "db-1" }], ctx(existing.fetch, false));
    const declared = fakeAccount([]);
    await createD1Handler().reconcile([{ binding: "NEW" }], ctx(declared.fetch, false));
    expect([posts(existing.calls), posts(declared.calls)]).toEqual([
      [],
      [{ method: "POST", path: "/accounts/acc/d1/database", body: { name: "NEW" } }],
    ]);
  });

  it("notes write access as unverified on --commit when no create was sent", async () => {
    const { fetch } = fakeAccount([{ uuid: "db-1", name: "app-db" }]);
    const res = await createD1Handler().reconcile([{ binding: "DB", database_id: "db-1" }], ctx(fetch, false));
    expect(res.notes).toEqual([UNVERIFIED]);
  });

  it("notes nothing once a create was sent, whether the account accepted it or refused it", async () => {
    const accepted = await createD1Handler().reconcile([{ binding: "DB" }], ctx(fakeAccount([]).fetch, false));
    const refused = await createD1Handler().reconcile([{ binding: "NEW" }], ctx(refusing, false));
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
    const res = await createD1Handler().reconcile([{ binding: "DB", database_id: "db-1" }], ctx(fetch, false));
    expect([sent, res.notes]).toEqual([[{ method: "GET", path: "/accounts/acc/d1/database", body: undefined }], [UNVERIFIED]]);
  });

  it("notes nothing on a dry run, and sends no POST", async () => {
    const { calls, fetch } = fakeAccount([{ uuid: "db-1", name: "app-db" }]);
    const res = await createD1Handler().reconcile([{ binding: "DB", database_id: "db-1" }], ctx(fetch, true));
    expect([posts(calls), res.notes]).toEqual([[], undefined]);
  });

  it("notes nothing for a config with no D1 database", async () => {
    const res = await createD1Handler().reconcile([], ctx(fakeAccount([]).fetch, false));
    expect(res.notes).toBeUndefined();
  });
});

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

  it("lists the D1 databases once across reconcile and the env pass, with two preview bindings and an env block", async () => {
    const { gets, fetch } = recordingGets(twoAccount().fetch);
    const handler = createD1Handler({ DB: { preview: true }, LOGS: { preview: true } });
    const run = ctx(fetch, true);
    await handler.reconcile(TWO, run);
    await handler.reconcileConfig?.({ name: "app", d1_databases: TWO, env: { staging: { d1_databases: TWO } } }, run);
    expect(listPages(gets)).toEqual(["1"]);
  });

  it("lists afresh for another run of the same handler", async () => {
    const { gets, fetch } = recordingGets(twoAccount().fetch);
    const handler = createD1Handler({ DB: { preview: true } });
    await handler.reconcile(TWO, ctx(fetch, true));
    await handler.reconcile(TWO, ctx(fetch, true));
    expect(listPages(gets)).toEqual(["1", "1"]);
  });

  it("shows the env pass a preview database created under --commit, without listing again", async () => {
    const { gets, fetch } = recordingGets(fakeAccount([{ uuid: "db-1", name: "app-db" }]).fetch);
    const handler = createD1Handler({ DB: { preview: true } });
    const run = ctx(fetch, false);
    const top = [{ binding: "DB", database_id: "db-1", database_name: "app-db" }];
    const res = await handler.reconcile(top, run);
    const staging = [{ ...top[0], preview_database_id: "db-stale" }];
    const pass = await handler.reconcileConfig?.({ name: "app", d1_databases: top, env: { staging: { d1_databases: staging } } }, run);
    expect(pass?.results.map((row) => [row.binding, row.action, row.remoteId])).toEqual([
      ["env.staging.DB", "updated", res.entries[0]?.preview_database_id],
    ]);
    expect(listPages(gets)).toEqual(["1"]);
  });

  for (const { placement, held } of [
    { placement: { preview: true }, held: false },
    { placement: { location: "weur" }, held: false },
    { placement: { jurisdiction: "eu" }, held: true },
    { placement: { readReplication: "auto" }, held: true },
  ] satisfies { placement: D1Placement; held: boolean }[]) {
    it(`${held ? "reads" : "does not read"} the bound database for a placement declaring ${Object.keys(placement).join(", ")}`, async () => {
      const { gets, fetch } = recordingGets(fakeAccount([{ uuid: "db-1", name: "app-db" }]).fetch);
      await createD1Handler({ DB: placement }).reconcile([{ binding: "DB", database_id: "db-1", database_name: "app-db" }], ctx(fetch, true));
      expect(gets.filter((url) => url.pathname === "/client/v4/accounts/acc/d1/database/db-1").length).toBe(held ? 1 : 0);
    });
  }
});
