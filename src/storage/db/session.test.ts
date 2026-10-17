import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import { mergePendingHeaders } from "../../context/pending-headers";
import { createTestContext } from "../../testing/context";
import { fakeD1 } from "../../testing/fakes";
import { mapHandler } from "../../testing/route";
import { resolveD1Client } from "./bindings";
import { d1Sessions, incomingBookmark, queryableFor } from "./session";
import { sql } from "./sql";
import type { D1Client, D1DatabaseLike, D1DatabaseSession, D1PreparedStatement, D1SessionsOptions } from "./types";

type Env = { DB?: D1DatabaseLike };

/** The bookmark `fakeD1` mints for its first session, in the shape local D1 writes. */
const BOOKMARK_1 = `00000000-00000001-00000000-${"0".repeat(32)}`;
const BOOKMARK_2 = `00000000-00000002-00000000-${"0".repeat(32)}`;

function app(db: D1DatabaseLike, bookmark: D1SessionsOptions["bookmark"] | null = { header: "x-d1-bookmark" }) {
  const forge = new Forge<Env>();
  forge.use("*", d1Sessions<Env>({ binding: (c) => c.env.DB, bookmark: bookmark ?? undefined }));
  const handler = async (context: unknown) => {
    const client = resolveD1Client(context as never, { binding: (c: { env: Env }) => c.env.DB } as never);
    await client?.query(sql`SELECT 1`);
    return new Response("ok");
  };
  mapHandler(forge, "GET", "/", handler);
  mapHandler(forge, "POST", "/", handler);
  return { forge, env: { DB: db } };
}

describe("d1Sessions()", () => {
  it("starts a safe request on any replica when a carrier is set but the request carries no bookmark", async () => {
    const db = fakeD1();
    const { forge, env } = app(db);
    await forge.request("/", {}, env);
    expect(db.sessions).toEqual(["first-unconstrained"]);
  });

  it("opens a safe request on the primary when no bookmark carrier is set, ignoring any bookmark it carries", async () => {
    for (const init of [
      {},
      { method: "HEAD" },
      { headers: { "x-d1-bookmark": BOOKMARK_1, cookie: `d1b=${BOOKMARK_1}` } },
    ] satisfies RequestInit[]) {
      const db = fakeD1();
      const { forge, env } = app(db, null);
      const res = await forge.request("/", init, env);
      expect([init, res.status, db.sessions, res.headers.get("x-d1-bookmark"), res.headers.getSetCookie()]).toEqual([
        init,
        200,
        ["first-primary"],
        null,
        [],
      ]);
    }
  });

  it("resumes a GET from the bookmark the POST set in its cookie, across a 303", async () => {
    const db = fakeD1();
    const forge = new Forge<Env>();
    forge.use("*", d1Sessions<Env>({ binding: (c) => c.env.DB, bookmark: { cookie: "d1b" } }));
    const client = (context: unknown) => resolveD1Client(context as never, { binding: (c: { env: Env }) => c.env.DB } as never);
    mapHandler(forge, "POST", "/signup", async (context) => {
      await client(context)?.execute(sql`INSERT INTO users (email) VALUES (${"a@example.com"})`);
      return new Response(null, { status: 303, headers: { location: "/account" } });
    });
    mapHandler(forge, "GET", "/account", async (context) => {
      await client(context)?.query(sql`SELECT * FROM users`);
      return new Response("ok");
    });
    const env = { DB: db };

    const posted = await forge.request("/signup", { method: "POST" }, env);
    const cookie = posted.headers.getSetCookie().map((set) => set.split(";")[0] ?? "");
    const followed = await forge.request(posted.headers.get("location") ?? "", { headers: { cookie: cookie.join("; ") } }, env);
    expect([posted.status, cookie, followed.status, db.sessions]).toEqual([303, [`d1b=${BOOKMARK_1}`], 200, ["first-primary", BOOKMARK_1]]);
  });

  it("starts a write on the primary, whatever bookmark it carries", async () => {
    const db = fakeD1();
    const { forge, env } = app(db);
    await forge.request("/", { method: "POST", headers: { "x-d1-bookmark": BOOKMARK_1 } }, env);
    expect(db.sessions).toEqual(["first-primary"]);
  });

  it("returns the session's bookmark on the response, and resumes from it on the next request: read-your-write across requests", async () => {
    const db = fakeD1();
    const { forge, env } = app(db);
    const written = await forge.request("/", { method: "POST" }, env);
    const bookmark = written.headers.get("x-d1-bookmark");
    await forge.request("/", { headers: { "x-d1-bookmark": bookmark ?? "" } }, env);
    expect([bookmark, db.sessions]).toEqual([BOOKMARK_1, ["first-primary", BOOKMARK_1]]);
  });

  it("carries the bookmark in a cookie when told to", async () => {
    const db = fakeD1();
    const { forge, env } = app(db, { cookie: "d1b" });
    const written = await forge.request("/", { method: "POST" }, env);
    expect(written.headers.get("set-cookie")).toBe(`d1b=${BOOKMARK_1}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    await forge.request("/", { headers: { cookie: `theme=dark; d1b=${BOOKMARK_1}` } }, env);
    expect(db.sessions).toEqual(["first-primary", BOOKMARK_1]);
  });

  it("starts unconstrained rather than passing D1 a bookmark not in its shape", async () => {
    for (const malformed of ["'; DROP TABLE users", "-", "0", "abc", "00000000-00000001"]) {
      const db = fakeD1();
      const { forge, env } = app(db);
      await forge.request("/", { headers: { "x-d1-bookmark": malformed } }, env);
      expect([malformed, db.sessions]).toEqual([malformed, ["first-unconstrained"]]);
    }
  });

  it("reads a bookmark from its header or its cookie, accepting the shape local D1 and Time Travel write", () => {
    const local = `00000000-0000001b-00000000-${"0".repeat(32)}`;
    const travel = "00000085-0000027c-00004f1e-90dbd1f2b0a54cfd";
    const request = (headers: Record<string, string>) => new Request("http://x/", { headers });
    expect([
      incomingBookmark(request({ "x-b": local }), { header: "x-b" }),
      incomingBookmark(request({ cookie: `a=1; b=${travel}` }), { cookie: "b" }),
      incomingBookmark(request({}), { header: "x-b" }),
    ]).toEqual([local, travel, null]);
  });

  it("sends every query of the request through its session: read-your-write within a request", async () => {
    const throughSession: string[] = [];
    const db = fakeD1();
    const sessioned: D1DatabaseLike = {
      ...db,
      withSession: (constraint) => {
        const session = db.withSession?.(constraint);
        if (session === undefined) throw new Error("fake has no sessions");
        return {
          ...session,
          prepare: (query) => {
            throughSession.push(query);
            return session.prepare(query);
          },
        };
      },
    };
    const { forge, env } = app(sessioned);
    await forge.request("/", { method: "POST" }, env);
    expect(throughSession).toEqual(["SELECT 1"]);
  });

  it("resolves a binding to the request's session where d1Sessions opened one, else to the binding itself", async () => {
    const db = fakeD1();
    const other = fakeD1();
    const context = createTestContext(new Request("http://x/"), { env: { DB: db } });
    const resolved: unknown[] = [];
    await d1Sessions<Env>({ binding: (c) => c.env.DB })(context as never, async () => {
      resolved.push(queryableFor(context as never, db) === db, queryableFor(context as never, other) === other);
      return new Response("ok");
    });
    expect([resolved, db.sessions]).toEqual([[false, true], ["first-primary"]]);
  });

  it("passes a binding with no withSession through untouched", async () => {
    const { exec, prepare, batch } = fakeD1();
    const { forge, env } = app({ exec, prepare, batch });
    const res = await forge.request("/", { method: "POST" }, env);
    expect([res.status, res.headers.get("x-d1-bookmark")]).toEqual([200, null]);
  });

  it("leaves the cookie off a read whose session returns the bookmark the request carried", async () => {
    const db = fakeD1();
    const { forge, env } = app(db, { cookie: "d1b" });
    const res = await forge.request("/", { headers: { cookie: `d1b=${BOOKMARK_1}` } }, env);
    expect([db.sessions, res.headers.getSetCookie()]).toEqual([[BOOKMARK_1], []]);
  });

  it("sets the cookie on a read whose session's bookmark moved past the one the request carried", async () => {
    const db = fakeD1();
    const { forge, env } = app(db, { cookie: "d1b" });
    await forge.request("/", { method: "POST" }, env);
    const res = await forge.request("/", { headers: { cookie: `d1b=${BOOKMARK_1}` } }, env);
    expect(res.headers.getSetCookie()).toEqual([`d1b=${BOOKMARK_2}; Path=/; HttpOnly; Secure; SameSite=Lax`]);
  });

  it("sets the header carrier's header even when the bookmark is the one the request carried", async () => {
    const db = fakeD1();
    const { forge, env } = app(db);
    const res = await forge.request("/", { headers: { "x-d1-bookmark": BOOKMARK_1 } }, env);
    expect([db.sessions, res.headers.get("x-d1-bookmark")]).toEqual([[BOOKMARK_1], BOOKMARK_1]);
  });

  for (const { carrier, queued, expected } of [
    { carrier: { header: "x-d1-bookmark" }, queued: (h: Headers) => h.get("x-d1-bookmark"), expected: BOOKMARK_1 },
    {
      carrier: { cookie: "d1b" },
      queued: (h: Headers) => h.getSetCookie(),
      expected: [`d1b=${BOOKMARK_1}; Path=/; HttpOnly; Secure; SameSite=Lax`],
    },
  ] satisfies { carrier: D1SessionsOptions["bookmark"]; queued: (h: Headers) => unknown; expected: unknown }[]) {
    it(`returns the handler's own response object and queues the bookmark beside it, by ${Object.keys(carrier)[0]}`, async () => {
      const db = fakeD1();
      const context = createTestContext(new Request("http://x/", { method: "POST" }), { env: { DB: db } });
      const served = new Response("ok");
      const returned = await d1Sessions<Env>({ binding: (c) => c.env.DB, bookmark: carrier })(context as never, async () => served);
      const merged = mergePendingHeaders(context as never, returned);
      expect(returned).toBe(served);
      expect(merged === null ? null : queued(merged)).toEqual(expected);
    });
  }
});

// Shaped like D1's bookmark but minted by no session the fake opens.
const REFUSED = `0000000a-0000000a-0000000a-${"a".repeat(32)}`;
// Sorts above every bookmark D1 could return, so D1's own keep-the-greater rule would never replace it.
const FORGED = `ffffffff-ffffffff-ffffffff-${"f".repeat(32)}`;

function refusingBookmark(
  db: ReturnType<typeof fakeD1>,
  refused: string,
  reject: (call: number) => Error | null = () => new Error("D1_ERROR: bookmark rejected"),
) {
  const opened: string[] = [];
  let refusedCalls = 0;
  const answer = async <R>(delegate: () => Promise<R>): Promise<R> => {
    refusedCalls += 1;
    const error = reject(refusedCalls);
    if (error !== null) throw error;
    return delegate();
  };
  const statement = (query: string, params: unknown[]): D1PreparedStatement => ({
    bind: (...values) => statement(query, values),
    all: <T>() =>
      answer(() =>
        db
          .prepare(query)
          .bind(...params)
          .all<T>(),
      ),
    first: <T>(column?: string) =>
      answer(() =>
        db
          .prepare(query)
          .bind(...params)
          .first<T>(column),
      ),
    run: () =>
      answer(() =>
        db
          .prepare(query)
          .bind(...params)
          .run(),
      ),
  });
  const refusing: D1DatabaseSession = {
    prepare: (query) => statement(query, []),
    batch: (statements) => answer(() => db.batch(statements)),
    getBookmark: () => refused,
  };
  const binding: D1DatabaseLike = {
    ...db,
    withSession: (constraint) => {
      opened.push(constraint);
      if (constraint === refused) return refusing;
      const session = db.withSession?.(constraint);
      if (session === undefined) throw new Error("fake has no sessions");
      return session;
    },
  };
  return { binding, opened, refusedCalls: () => refusedCalls };
}

function serving(
  binding: D1DatabaseLike,
  carrier: NonNullable<D1SessionsOptions["bookmark"]>,
  handler: (client: D1Client, context: unknown) => Promise<unknown>,
) {
  const forge = new Forge<Env>();
  forge.use("*", d1Sessions<Env>({ binding: (c) => c.env.DB, bookmark: carrier }));
  mapHandler(forge, "GET", "/", async (context) => {
    const client = resolveD1Client(context as never, { binding: (c: { env: Env }) => c.env.DB } as never);
    if (client === null) throw new Error("no client");
    return Response.json(await handler(client, context));
  });
  return (headers: Record<string, string>) => forge.request("/", { headers }, { DB: binding });
}

const reported = (outcome: { ok: true; data: unknown } | { ok: false; error: { kind: string; message: string } }) =>
  outcome.ok ? { ok: true, data: outcome.data } : { ok: false, kind: outcome.error.kind, message: outcome.error.message };

describe("d1Sessions() with a bookmark D1 refuses", () => {
  it("fails the read on the refused bookmark's own session, and returns no bookmark by header", async () => {
    const stub = refusingBookmark(
      fakeD1(() => [{ id: 1 }]),
      REFUSED,
    );
    const request = serving(stub.binding, { header: "x-d1-bookmark" }, async (client) => reported(await client.query(sql`SELECT id FROM users`)));

    const res = await request({ "x-d1-bookmark": REFUSED });
    expect([res.status, stub.opened, res.headers.get("x-d1-bookmark"), await res.json()]).toEqual([
      200,
      [REFUSED],
      null,
      { ok: false, kind: "unavailable", message: "D1_ERROR: bookmark rejected" },
    ]);
  });

  it("clears the cookie of a forged-ahead bookmark D1 refuses, so the next read starts on any replica", async () => {
    const stub = refusingBookmark(fakeD1(), FORGED);
    const request = serving(stub.binding, { cookie: "d1b" }, async (client) => reported(await client.query(sql`SELECT 1`)));

    const res = await request({ cookie: `d1b=${FORGED}` });
    const cleared = res.headers.getSetCookie();
    const next = await request({ cookie: (cleared[0] ?? "").split(";")[0] ?? "" });
    expect([stub.opened, cleared, next.headers.getSetCookie()]).toEqual([
      [FORGED, "first-unconstrained"],
      ["d1b=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"],
      [`d1b=${BOOKMARK_1}; Path=/; HttpOnly; Secure; SameSite=Lax`],
    ]);
  });

  for (const message of [
    "D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.",
    "D1_ERROR: no such table: users",
    "D1_ERROR: UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT",
  ]) {
    it(`sends a first run() and batch() failing "${message}" once, on the bookmark's session alone`, async () => {
      const stub = refusingBookmark(fakeD1(), REFUSED, () => new Error(message));
      const request = serving(stub.binding, { header: "x-d1-bookmark" }, async (client) => [
        (await client.execute(sql`INSERT INTO users (email) VALUES (${"a@example.com"})`)).ok,
        (await client.batch([sql`INSERT INTO users (email) VALUES (${"b@example.com"})`])).ok,
      ]);

      const res = await request({ "x-d1-bookmark": REFUSED });
      expect([await res.json(), stub.opened, stub.refusedCalls()]).toEqual([[false, false], [REFUSED], 2]);
    });
  }

  it("replays neither of two concurrent first calls that fail a constraint", async () => {
    const stub = refusingBookmark(fakeD1(), REFUSED, () => new Error("D1_ERROR: UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT"));
    const request = serving(stub.binding, { header: "x-d1-bookmark" }, async (client) =>
      (await Promise.all([client.query(sql`SELECT 1`), client.query(sql`SELECT 2`)])).map((outcome) => outcome.ok),
    );

    const res = await request({ "x-d1-bookmark": REFUSED });
    expect([await res.json(), stub.opened, stub.refusedCalls()]).toEqual([[false, false], [REFUSED], 2]);
  });

  it("echoes the carried bookmark when the request makes no query, since D1 has not yet seen it", async () => {
    const stub = refusingBookmark(fakeD1(), REFUSED);
    const res = await serving(stub.binding, { header: "x-d1-bookmark" }, async () => null)({ "x-d1-bookmark": REFUSED });
    expect([stub.opened, res.headers.get("x-d1-bookmark")]).toEqual([[REFUSED], REFUSED]);
  });

  it("keeps a bookmark one query of the request was answered on, though a later query fails", async () => {
    const stub = refusingBookmark(
      fakeD1(() => [{ id: 1 }]),
      REFUSED,
      (call) => (call === 1 ? null : new Error("D1_ERROR: bookmark rejected")),
    );
    const request = serving(stub.binding, { header: "x-d1-bookmark" }, async (client) => [
      (await client.query(sql`SELECT 1`)).ok,
      (await client.query(sql`SELECT 2`)).ok,
    ]);

    const res = await request({ "x-d1-bookmark": REFUSED });
    expect([await res.json(), stub.opened, res.headers.get("x-d1-bookmark")]).toEqual([[true, false], [REFUSED], REFUSED]);
  });

  it("hands a resumed session's batch the statements its own session prepared, bound values included", async () => {
    const db = fakeD1((query, params) => [{ query, params }]);
    const request = serving(db, { header: "x-d1-bookmark" }, async (client) => {
      const outcome = await client.batch([sql`SELECT ${1}`, sql`SELECT ${2}`]);
      return outcome.ok ? outcome.data.map((result) => result.results) : outcome.error.message;
    });

    const res = await request({ "x-d1-bookmark": BOOKMARK_1 });
    expect([await res.json(), db.sessions]).toEqual([[[{ query: "SELECT ?", params: [1] }], [{ query: "SELECT ?", params: [2] }]], [BOOKMARK_1]]);
  });
});
