import { describe, expect, it } from "bun:test";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
import { createAnonymousSession } from "./anonymous";
import type { SessionKVBinding } from "./kv-storage";
import { sessionCtx } from "./session";

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

function makeApp(options?: { secure?: boolean }) {
  const app = new Forge<Env>();
  app.use(
    "*",
    createAnonymousSession<Env>({
      cookieName: "test_session",
      secret: (c) => c.env.SESSION_SECRET,
      kv: (c) => c.env.SESSIONS,
      secure: options?.secure ?? false, // http test harness — Secure cookies need https
    }),
  );
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
    // The cookie must not leak session data — it carries only the opaque id.
    expect(setCookie).not.toContain("dark");
    expect(setCookie).not.toContain("theme");
    // The data landed in KV instead.
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

  it("caches the built middleware per (cookieName, secure, secret)", async () => {
    let storageBuilds = 0;
    const { kv } = fakeSessionKV();
    const countingKvResolver = () => {
      storageBuilds++;
      return kv;
    };
    const app = new Forge<Env>();
    app.use("*", createAnonymousSession<Env>({ secret: (c) => c.env.SESSION_SECRET, kv: countingKvResolver, secure: false }));
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const env = { SESSION_SECRET: SECRET, SESSIONS: kv };
    await app.request("/", {}, env);
    await app.request("/", {}, env);
    await app.request("/", {}, env);
    expect(storageBuilds).toBe(1); // storage (and middleware) built once, reused thereafter

    // A different secret rebuilds:
    await app.request("/", {}, { SESSION_SECRET: "x".repeat(32), SESSIONS: kv });
    expect(storageBuilds).toBe(2);
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

describe("createAnonymousSession — cookie-storage mode (kv omitted)", () => {
  it("persists small sessions entirely in the cookie", async () => {
    const app = new Forge<{ SESSION_SECRET: string }>();
    app.use("*", createAnonymousSession<{ SESSION_SECRET: string }>({ secret: (c) => c.env.SESSION_SECRET, secure: false }));
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
