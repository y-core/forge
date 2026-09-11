import { describe, expect, it } from "bun:test";

import { Forge } from "../app/forge-app";
import { mapHandler } from "../testing/route";
import { createAnonymousSession } from "./anonymous";
import { sessionCtx } from "./session";
import type { SessionKVBinding } from "./types";

const SECRET = "s".repeat(32);

function fakeSessionKV() {
  const data = new Map<string, string>();
  const kv: SessionKVBinding = {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
  };
  return { kv, data };
}

type Env = { SESSION_SECRET: string; SESSIONS: SessionKVBinding };

function makeApp() {
  const app = new Forge<Env>();
  app.use("*", createAnonymousSession<Env>({ cookieName: "test_session", secret: (c) => c.env.SESSION_SECRET, kv: (c) => c.env.SESSIONS }));
  mapHandler(app, "POST", "/save", (context) => {
    const session = sessionCtx.get(context);
    session.set("settings", { theme: "dark" });
    return new Response("saved");
  });
  mapHandler(app, "GET", "/read", (context) => {
    const session = sessionCtx.get(context);
    return Response.json({ settings: session.get("settings") ?? null });
  });
  return app;
}

function rotatingApp(secrets: [string, ...string[]], reissue?: boolean) {
  const app = new Forge<{ SESSIONS: SessionKVBinding }>();
  app.use(
    "*",
    createAnonymousSession<{ SESSIONS: SessionKVBinding }>({
      secret: () => secrets,
      kv: (c) => c.env.SESSIONS,
      ...(reissue === undefined ? {} : { reissue }),
    }),
  );
  mapHandler(app, "POST", "/save", (context) => {
    sessionCtx.get(context).set("settings", { theme: "dark" });
    return new Response("saved");
  });
  mapHandler(app, "GET", "/read", (context) => Response.json({ settings: sessionCtx.get(context).get("settings") ?? null }));
  mapHandler(app, "GET", "/quiet", () => new Response("ok"));
  return app;
}

describe("createAnonymousSession — KV mode", () => {
  it("sets an id-only cookie on write; session data never appears in the cookie", async () => {
    const { kv, data } = fakeSessionKV();
    const app = makeApp();

    const res = await app.request("/save", { method: "POST" }, { SESSION_SECRET: SECRET, SESSIONS: kv });
    expect(await res.text()).toBe("saved");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("test_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("dark");
    expect(setCookie).not.toContain("theme");
    expect([...data.values()].some((v) => v.includes("dark"))).toBe(true);
  });

  it("round-trips the session across requests via the cookie", async () => {
    const { kv } = fakeSessionKV();
    const app = makeApp();
    const env = { SESSION_SECRET: SECRET, SESSIONS: kv };

    const write = await app.request("/save", { method: "POST" }, env);
    const cookiePair = (write.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    const read = await app.request("/read", { headers: { cookie: cookiePair } }, env);
    expect(await read.json()).toEqual({ settings: { theme: "dark" } });
  });

  it("emits a Secure cookie by default (secure omitted)", async () => {
    const { kv } = fakeSessionKV();
    const app = new Forge<Env>();
    app.use("*", createAnonymousSession<Env>({ secret: (c) => c.env.SESSION_SECRET, kv: (c) => c.env.SESSIONS }));
    mapHandler(app, "POST", "/save", (context) => {
      sessionCtx.get(context).set("k", "v");
      return new Response("ok");
    });

    const res = await app.request("/save", { method: "POST" }, { SESSION_SECRET: SECRET, SESSIONS: kv });
    expect(res.headers.get("set-cookie") ?? "").toContain("Secure");
  });

  it("caches the built middleware per env object identity", async () => {
    let storageBuilds = 0;
    const { kv } = fakeSessionKV();
    const countingKvResolver = () => {
      storageBuilds++;
      return kv;
    };
    const app = new Forge<Env>();
    app.use("*", createAnonymousSession<Env>({ secret: (c) => c.env.SESSION_SECRET, kv: countingKvResolver }));
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const env = { SESSION_SECRET: SECRET, SESSIONS: kv };
    await app.request("/", {}, env);
    await app.request("/", {}, env);
    await app.request("/", {}, env);
    expect(storageBuilds).toBe(1);

    await app.request("/", {}, { SESSION_SECRET: "x".repeat(32), SESSIONS: kv });
    expect(storageBuilds).toBe(2);
  });

  describe("multi-tenant KV isolation", () => {
    it("does not serve tenant A's session data to tenant B when secret and cookie name match", async () => {
      const tenantA = fakeSessionKV();
      const tenantB = fakeSessionKV();
      const app = makeApp();

      const envA: Env = { SESSION_SECRET: SECRET, SESSIONS: tenantA.kv };
      const envB: Env = { SESSION_SECRET: SECRET, SESSIONS: tenantB.kv };

      const writeA = await app.request("/save", { method: "POST" }, envA);
      const cookieA = (writeA.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

      expect([...tenantA.data.values()].some((v) => v.includes("dark"))).toBe(true);
      expect(tenantB.data.size).toBe(0);

      const readB = await app.request("/read", { headers: { cookie: cookieA } }, envB);
      expect(await readB.json()).toEqual({ settings: null });

      const readA = await app.request("/read", { headers: { cookie: cookieA } }, envA);
      expect(await readA.json()).toEqual({ settings: { theme: "dark" } });
    });

    it("writes each tenant's session into its own KV namespace", async () => {
      const tenantA = fakeSessionKV();
      const tenantB = fakeSessionKV();
      const app = makeApp();

      await app.request("/save", { method: "POST" }, { SESSION_SECRET: SECRET, SESSIONS: tenantA.kv });
      await app.request("/save", { method: "POST" }, { SESSION_SECRET: SECRET, SESSIONS: tenantB.kv });

      expect(tenantA.data.size).toBe(1);
      expect(tenantB.data.size).toBe(1);
    });
  });

  it("rejects a short secret with the exact error", async () => {
    const { kv } = fakeSessionKV();
    const app = new Forge<Env>();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", createAnonymousSession<Env>({ secret: (c) => c.env.SESSION_SECRET, kv: (c) => c.env.SESSIONS }));
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const res = await app.request("/", {}, { SESSION_SECRET: "short", SESSIONS: kv });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("createAnonymousSession: session secret must be at least 32 characters (got 5)");
  });
});

describe("createAnonymousSession — secret rotation", () => {
  // No flag is passed here: the factory derives `rotating` from the array it resolved, which is
  // what keeps a rotation from silently never completing.
  it("accepts a secret array and signs with the first", async () => {
    const { kv } = fakeSessionKV();
    const OLD = "o".repeat(32);
    const NEW = "n".repeat(32);

    const seeded = await rotatingApp([OLD]).request("/save", { method: "POST" }, { SESSIONS: kv });
    const sent = (seeded.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    const res = await rotatingApp([NEW, OLD]).request("/read", { headers: { cookie: sent } }, { SESSIONS: kv });
    expect(await res.json()).toEqual({ settings: { theme: "dark" } });
    const issued = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(issued).not.toBe("");
    expect(issued).not.toBe(sent);

    const after = await rotatingApp([NEW]).request("/read", { headers: { cookie: issued } }, { SESSIONS: kv });
    expect(await after.json()).toEqual({ settings: { theme: "dark" } });
  });

  it("rejects a short secret inside an array, reporting its character count", async () => {
    const { kv } = fakeSessionKV();
    const app = new Forge<{ SESSIONS: SessionKVBinding }>();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", createAnonymousSession<{ SESSIONS: SessionKVBinding }>({ secret: () => ["n".repeat(32), "short"], kv: (c) => c.env.SESSIONS }));
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const res = await app.request("/", {}, { SESSIONS: kv });
    expect(await res.text()).toBe("createAnonymousSession: session secret must be at least 32 characters (got 5)");
  });

  it("forwards reissue to the middleware", async () => {
    const { kv } = fakeSessionKV();
    const seeded = await rotatingApp([SECRET]).request("/save", { method: "POST" }, { SESSIONS: kv });
    const sent = (seeded.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    const quiet = await rotatingApp([SECRET]).request("/quiet", { headers: { cookie: sent } }, { SESSIONS: kv });
    expect(quiet.headers.get("set-cookie")).toBeNull();

    const reissued = await rotatingApp([SECRET], true).request("/quiet", { headers: { cookie: sent } }, { SESSIONS: kv });
    expect(reissued.headers.getSetCookie()).toHaveLength(1);
  });

  it("refuses an empty cookie name", () => {
    expect(() => createAnonymousSession({ cookieName: "", secret: () => SECRET })).toThrow("createAnonymousSession: cookieName must not be empty");
  });
});

describe("createAnonymousSession — cookie-storage mode (kv omitted)", () => {
  it("persists small sessions entirely in the cookie", async () => {
    const app = new Forge<{ SESSION_SECRET: string }>();
    app.use("*", createAnonymousSession<{ SESSION_SECRET: string }>({ secret: (c) => c.env.SESSION_SECRET }));
    mapHandler(app, "POST", "/save", (context) => {
      sessionCtx.get(context).set("n", 1);
      return new Response("ok");
    });
    mapHandler(app, "GET", "/read", (context) => Response.json({ n: sessionCtx.get(context).get("n") ?? null }));

    const env = { SESSION_SECRET: SECRET };
    const write = await app.request("/save", { method: "POST" }, env);
    const cookiePair = (write.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const read = await app.request("/read", { headers: { cookie: cookiePair } }, env);
    expect(await read.json()).toEqual({ n: 1 });
  });
});
