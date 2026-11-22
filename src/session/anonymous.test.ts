import { describe, expect, it, spyOn } from "bun:test";

import { createSession } from "@remix-run/session";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../app/forge-app";
import { createKeyRingResolver } from "../crypto/keyring/resolver";
import { importKeyRing } from "../crypto/keyring/ring";
import { parseKeyRingSecrets } from "../crypto/keyring/secrets";
import type { KeyRingResolver } from "../crypto/keyring/types";
import { mapHandler } from "../testing/route";
import { createAnonymousSession } from "./anonymous";
import { createSignedCookie } from "./cookie";
import { sessionCtx, sessionMiddleware } from "./session";
import type { AnonymousSessionOptions, SessionKVBinding } from "./types";

const SECRET = "c15f22e5e9af45d15e1068ac2186b479735f5c60e4fc302f8916ab67aaf6b2c6";

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

const envRing = (env: { SESSION_SECRET: string }) => importKeyRing(parseKeyRingSecrets(env.SESSION_SECRET));

function makeApp() {
  const app = new Forge<Env>();
  app.use("*", createAnonymousSession<Env>({ cookieName: "test_session", ring: envRing, kv: (env) => env.SESSIONS }));
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
      ring: () => importKeyRing(secrets),
      kv: (env) => env.SESSIONS,
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
    app.use("*", createAnonymousSession<Env>({ ring: envRing, kv: (env) => env.SESSIONS }));
    mapHandler(app, "POST", "/save", (context) => {
      sessionCtx.get(context).set("k", "v");
      return new Response("ok");
    });

    const res = await app.request("/save", { method: "POST" }, { SESSION_SECRET: SECRET, SESSIONS: kv });
    expect(res.headers.get("set-cookie") ?? "").toContain("Secure");
  });

  it("names the default cookie __Host-session, with Path=/, Secure and no Domain", async () => {
    const { kv } = fakeSessionKV();
    const res = await rotatingApp([SECRET]).request("/save", { method: "POST" }, { SESSIONS: kv });
    const header = res.headers.get("set-cookie") ?? "";
    expect(header.startsWith("__Host-session=")).toBe(true);
    expect(header).toContain("Path=/");
    expect(header).toContain("Secure");
    expect(header).not.toContain("Domain");
  });

  it("does not read a validly signed session sent under the unprefixed __session name", async () => {
    const { kv } = fakeSessionKV();
    const legacy = createAnonymousSession<{ SESSIONS: SessionKVBinding }>({
      cookieName: "__session",
      ring: () => importKeyRing([SECRET]),
      kv: (env) => env.SESSIONS,
    });
    const legacyApp = new Forge<{ SESSIONS: SessionKVBinding }>();
    legacyApp.use("*", legacy);
    mapHandler(legacyApp, "POST", "/save", (context) => {
      sessionCtx.get(context).set("settings", { theme: "dark" });
      return new Response("saved");
    });
    const seeded = await legacyApp.request("/save", { method: "POST" }, { SESSIONS: kv });
    const planted = (seeded.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(planted.startsWith("__session=")).toBe(true);

    const res = await rotatingApp([SECRET]).request("/read", { headers: { cookie: planted } }, { SESSIONS: kv });
    expect(await res.json()).toEqual({ settings: null });
  });

  it("caches the built middleware per env object identity", async () => {
    let storageBuilds = 0;
    const { kv } = fakeSessionKV();
    const countingKvResolver = () => {
      storageBuilds++;
      return kv;
    };
    const app = new Forge<Env>();
    app.use("*", createAnonymousSession<Env>({ ring: envRing, kv: countingKvResolver }));
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const env = { SESSION_SECRET: SECRET, SESSIONS: kv };
    await app.request("/", {}, env);
    await app.request("/", {}, env);
    await app.request("/", {}, env);
    expect(storageBuilds).toBe(1);

    await app.request("/", {}, { SESSION_SECRET: "3434544ef1b4c1319a6f319f350d59a5ff41f0dd9e4547774ced1488d26d9738", SESSIONS: kv });
    expect(storageBuilds).toBe(2);
  });

  it("resolves its key ring once per env object", async () => {
    let ringCalls = 0;
    const { kv } = fakeSessionKV();
    const app = new Forge<Env>();
    app.use(
      "*",
      createAnonymousSession<Env>({
        ring: (env) => {
          ringCalls++;
          return envRing(env);
        },
        kv: (env) => env.SESSIONS,
      }),
    );
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const env = { SESSION_SECRET: SECRET, SESSIONS: kv };
    for (let i = 0; i < 3; i++) await app.request("/", {}, env);
    const callsUnderOneEnv = ringCalls;
    await app.request("/", {}, { SESSION_SECRET: SECRET, SESSIONS: kv });
    expect({ callsUnderOneEnv, callsAfterSecondEnv: ringCalls }).toEqual({ callsUnderOneEnv: 1, callsAfterSecondEnv: 2 });
  });

  it("hands the kv resolver the env alone, so a binding cannot be keyed on one request's host", () => {
    const { kv } = fakeSessionKV();
    const kvByHost = new Map([["tenant.example", kv]]);
    // @ts-expect-error -- the resolver is cached per env, so it is given no request to read
    const refused: AnonymousSessionOptions<Env>["kv"] = (c: { url: URL }) => kvByHost.get(c.url.host) ?? kv;
    expect(typeof refused).toBe("function");
  });

  describe("multi-tenant KV isolation", () => {
    it("does not serve tenant A's session data to tenant B when the key ring and cookie name match", async () => {
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

  it("deletes the old KV record when a sign-in regenerates the id with deletion", async () => {
    const { kv, data } = fakeSessionKV();
    const app = makeApp();
    mapHandler(app, "POST", "/sign-in", (context) => {
      sessionCtx.get(context).regenerateId(true);
      return new Response("ok");
    });
    const env = { SESSION_SECRET: SECRET, SESSIONS: kv };
    const write = await app.request("/save", { method: "POST" }, env);
    const [oldKey] = [...data.keys()];
    const signIn = await app.request(
      "/sign-in",
      { method: "POST", headers: { cookie: (write.headers.get("set-cookie") ?? "").split(";")[0] ?? "" } },
      env,
    );
    const keys = [...data.keys()];
    expect(oldKey).toBeDefined();
    expect(keys).toHaveLength(1);
    expect(keys).not.toContain(oldKey);
    const read = await app.request("/read", { headers: { cookie: (signIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "" } }, env);
    expect(await read.json()).toEqual({ settings: { theme: "dark" } });
  });

  it("rejects a short secret with the exact error", async () => {
    const { kv } = fakeSessionKV();
    const app = new Forge<Env>();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", createAnonymousSession<Env>({ ring: envRing, kv: (env) => env.SESSIONS }));
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const res = await app.request("/", {}, { SESSION_SECRET: "abcd", SESSIONS: kv });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("importKeyRing: each secret must be at least 32 bytes (got 2)");
  });
});

describe("createAnonymousSession — key rotation", () => {
  // No flag is passed here: the factory derives `rotating` from the ring it resolved, which is
  // what keeps a rotation from silently never completing.
  it("re-issues a cookie signed under a retired key under the ring's active key", async () => {
    const { kv } = fakeSessionKV();
    const OLD = "3e8f0241998536b82050a9b2cdb21c47ee4215e1bd4ec7a04ec2ad348757f370";
    const NEW = "17205855bdb251c4096292802c9a3aa04af4e27a549226c829204ab1fce2ea22";

    const seeded = await rotatingApp([OLD]).request("/save", { method: "POST" }, { SESSIONS: kv });
    const sent = (seeded.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    const res = await rotatingApp([NEW, OLD]).request("/read", { headers: { cookie: sent } }, { SESSIONS: kv });
    expect(await res.json()).toEqual({ settings: { theme: "dark" } });
    const issued = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(issued).not.toBe("");
    expect(issued).not.toBe(sent);
    expect(issued.split(".")[2]).toBe((await importKeyRing([NEW])).activeKeyId);

    const after = await rotatingApp([NEW]).request("/read", { headers: { cookie: issued } }, { SESSIONS: kv });
    expect(await after.json()).toEqual({ settings: { theme: "dark" } });

    // `issued !== sent` alone passes even where every response re-issues, and the year-long `maxAge`
    // this factory sets puts an epoch second in the signature — so a third request is what proves it.
    const settled = await rotatingApp([NEW, OLD]).request("/quiet", { headers: { cookie: issued } }, { SESSIONS: kv });
    expect(settled.headers.get("set-cookie")).toBeNull();
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

  // The empty-name throw stays ahead of the storage pair, so a call missing both still names the
  // one a developer can see in front of them.
  it("refuses an empty cookie name", () => {
    expect(() => createAnonymousSession({ cookieName: "", ring: () => importKeyRing([SECRET]) })).toThrow(
      "createAnonymousSession: cookieName must not be empty",
    );
  });

  it("refuses a call naming neither kv nor cookie storage", () => {
    expect(() => createAnonymousSession({ ring: () => importKeyRing([SECRET]) })).toThrow(
      'pass `kv` to hold session data server-side, or `storage: "cookie"`',
    );
  });

  it("refuses a KV ttlSeconds below 60 at construction, and accepts 60", () => {
    const kv = () => fakeSessionKV().kv;
    expect(() => createAnonymousSession({ ring: () => importKeyRing([SECRET]), kv, ttlSeconds: 59 })).toThrow(
      "createAnonymousSession: ttlSeconds is 59, below the 60-second floor",
    );
    expect(() => createAnonymousSession({ ring: () => importKeyRing([SECRET]), kv, ttlSeconds: 60 })).not.toThrow();
  });

  it("refuses a maxAge below 60 where it is the defaulted KV ttlSeconds", () => {
    const kv = () => fakeSessionKV().kv;
    expect(() => createAnonymousSession({ ring: () => importKeyRing([SECRET]), kv, maxAge: 59 })).toThrow(
      "createAnonymousSession: maxAge is 59, below the 60-second floor",
    );
    expect(() => createAnonymousSession({ ring: () => importKeyRing([SECRET]), kv, maxAge: 59, ttlSeconds: 60 })).not.toThrow();
  });

  it("refuses a KV ttlSeconds or defaulted maxAge that is NaN", () => {
    const kv = () => fakeSessionKV().kv;
    expect(() => createAnonymousSession({ ring: () => importKeyRing([SECRET]), kv, ttlSeconds: Number.NaN })).toThrow(
      "createAnonymousSession: ttlSeconds is NaN",
    );
    expect(() => createAnonymousSession({ ring: () => importKeyRing([SECRET]), kv, maxAge: Number.NaN })).toThrow(
      "createAnonymousSession: maxAge is NaN",
    );
  });

  it("does not hold a cookie-storage maxAge to the KV floor", () => {
    expect(() => createAnonymousSession({ ring: () => importKeyRing([SECRET]), storage: "cookie", maxAge: 30 })).not.toThrow();
  });

  it("refuses a call naming both kv and cookie storage", () => {
    const kv = () => fakeSessionKV().kv;
    expect(() => createAnonymousSession({ ring: () => importKeyRing([SECRET]), kv, storage: "cookie" })).toThrow(
      'createAnonymousSession: pass either `kv` or `storage: "cookie"`, not both',
    );
  });
});

describe("createAnonymousSession — cookie-storage mode", () => {
  it("persists small sessions entirely in the cookie", async () => {
    const app = new Forge<{ SESSION_SECRET: string }>();
    app.use("*", createAnonymousSession<{ SESSION_SECRET: string }>({ ring: envRing, storage: "cookie" }));
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

  it("signs in with regenerateId(true) without upstream logging the old session id", async () => {
    const app = new Forge<{ SESSION_SECRET: string }>();
    app.use("*", createAnonymousSession<{ SESSION_SECRET: string }>({ ring: envRing, storage: "cookie" }));
    mapHandler(app, "POST", "/save", (context) => {
      sessionCtx.get(context).set("n", 1);
      return new Response("ok");
    });
    mapHandler(app, "POST", "/sign-in", (context) => {
      sessionCtx.get(context).regenerateId(true);
      return new Response("ok");
    });
    mapHandler(app, "GET", "/read", (context) => Response.json({ n: sessionCtx.get(context).get("n") ?? null }));

    const env = { SESSION_SECRET: SECRET };
    const write = await app.request("/save", { method: "POST" }, env);
    const before = (write.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const signIn = await app.request("/sign-in", { method: "POST", headers: { cookie: before } }, env);
      const after = (signIn.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      expect(warn).not.toHaveBeenCalled();
      expect(after).not.toBe(before);
      const read = await app.request("/read", { headers: { cookie: after } }, env);
      expect(await read.json()).toEqual({ n: 1 });
    } finally {
      warn.mockRestore();
    }
  });

  function cookieModeApp() {
    const app = new Forge<{ SESSION_SECRET: string }>();
    app.use("*", createAnonymousSession<{ SESSION_SECRET: string }>({ ring: envRing, storage: "cookie" }));
    mapHandler(app, "POST", "/save", (context) => {
      sessionCtx.get(context).set("n", 1);
      return new Response("ok");
    });
    mapHandler(app, "GET", "/state", (context) => {
      const session = sessionCtx.get(context);
      return Response.json({ id: session.id, n: session.get("n") ?? null });
    });
    mapHandler(app, "POST", "/rotate", (context) => {
      sessionCtx.get(context).regenerateId(false);
      return new Response("ok");
    });
    mapHandler(app, "POST", "/logout", (context) => {
      sessionCtx.get(context).destroy();
      return new Response("bye");
    });
    return app;
  }

  const env = { SESSION_SECRET: SECRET };
  const pairOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  it("persists an id read on a first visit, so the next request sees the same id", async () => {
    const app = cookieModeApp();
    const first = await app.request("/state", {}, env);
    const { id } = (await first.json()) as { id: string };
    const second = await app.request("/state", { headers: { cookie: pairOf(first) } }, env);
    expect(await second.json()).toEqual({ id, n: null });
  });

  it("rotates the id with regenerateId(false), keeping the data and logging nothing", async () => {
    const app = cookieModeApp();
    const saved = pairOf(await app.request("/save", { method: "POST" }, env));
    const { id: before } = (await (await app.request("/state", { headers: { cookie: saved } }, env)).json()) as { id: string };
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const rotated = await app.request("/rotate", { method: "POST", headers: { cookie: saved } }, env);
      const state = (await (await app.request("/state", { headers: { cookie: pairOf(rotated) } }, env)).json()) as { id: string; n: number };
      expect(state.n).toBe(1);
      expect(state.id).not.toBe(before);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("clears the cookie when the session is destroyed", async () => {
    const app = cookieModeApp();
    const saved = pairOf(await app.request("/save", { method: "POST" }, env));
    const out = await app.request("/logout", { method: "POST", headers: { cookie: saved } }, env);
    expect(out.headers.get("set-cookie")).toBe("__Host-session=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax; Secure");
  });
});

describe("createAnonymousSession — the maxAge it carries", () => {
  async function announcedMaxAge(options: Pick<AnonymousSessionOptions<Env>, "maxAge">) {
    const session = createAnonymousSession<Env>({ ring: envRing, storage: "cookie", ...options });
    const app = new Forge<Env>();
    app.use("*", session);
    mapHandler(app, "POST", "/save", (context) => {
      sessionCtx.get(context).set("theme", "dark");
      return new Response("saved");
    });
    const res = await app.request("/save", { method: "POST" }, { SESSION_SECRET: SECRET, SESSIONS: fakeSessionKV().kv });
    const announced = res.headers
      .getSetCookie()
      .flatMap((header) => header.split("; "))
      .find((part) => part.startsWith("Max-Age="));
    return { maxAge: session.maxAge, announced };
  }

  it("carries one year in seconds by default, the Max-Age its cookie announces", async () => {
    expect(await announcedMaxAge({})).toEqual({ maxAge: 31_536_000, announced: "Max-Age=31536000" });
  });

  it("carries the maxAge it was given, the Max-Age its cookie announces", async () => {
    expect(await announcedMaxAge({ maxAge: 7200 })).toEqual({ maxAge: 7200, announced: "Max-Age=7200" });
  });
});

describe("createAnonymousSession single mount", () => {
  async function mountedApp(order: "anonymous-first" | "explicit-first") {
    const app = new Forge<Env>();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    const anonymous = createAnonymousSession<Env>({ ring: envRing, kv: (env) => env.SESSIONS });
    const explicit = sessionMiddleware(createCookieSessionStorage(), createSignedCookie("explicit", { ring: await importKeyRing([SECRET]) }));
    for (const mw of order === "anonymous-first" ? [anonymous, explicit] : [explicit, anonymous]) app.use("*", mw);
    mapHandler(app, "POST", "/save", (context) => {
      sessionCtx.get(context).set("settings", { theme: "dark" });
      return new Response("saved");
    });
    return app;
  }

  it("throws when an explicit session middleware follows it", async () => {
    const { kv } = fakeSessionKV();
    const res = await (await mountedApp("anonymous-first")).request("/save", { method: "POST" }, { SESSION_SECRET: SECRET, SESSIONS: kv });
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("a session is already set on this request");
  });

  it("throws when it follows an explicit session middleware, writing no KV record", async () => {
    const { kv, data } = fakeSessionKV();
    const res = await (await mountedApp("explicit-first")).request("/save", { method: "POST" }, { SESSION_SECRET: SECRET, SESSIONS: kv });
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("a session is already set on this request");
    expect(data.size).toBe(0);
  });

  it("throws on a session swapped by the handler, writing no KV record", async () => {
    const { kv, data } = fakeSessionKV();
    const app = new Forge<Env>();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", createAnonymousSession<Env>({ ring: envRing, kv: (env) => env.SESSIONS }));
    mapHandler(app, "POST", "/save", (context) => {
      sessionCtx.get(context).set("settings", { theme: "dark" });
      sessionCtx.set(context, createSession());
      return new Response("saved");
    });
    const res = await app.request("/save", { method: "POST" }, { SESSION_SECRET: SECRET, SESSIONS: kv });
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("holds a different session");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(data.size).toBe(0);
  });
});

describe("createAnonymousSession — a ring wrapped in createKeyRingResolver", () => {
  const UNWRAP = "createAnonymousSession: pass the `(env) => importKeyRing(…)` function itself, not `createKeyRingResolver(…)`";

  it("is refused at bun check whatever Bindings it was made under, and throws at construction", () => {
    const inferred = () =>
      createAnonymousSession({
        // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
        ring: createKeyRingResolver(() => importKeyRing([SECRET])),
        storage: "cookie",
      });
    const typed = () =>
      createAnonymousSession<Env>({
        // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
        ring: createKeyRingResolver<Env>(envRing),
        kv: (env) => env.SESSIONS,
      });
    expect(inferred).toThrow(new Error(UNWRAP));
    expect(typed).toThrow(new Error(UNWRAP));
  });

  it("cast past the type, throws at construction naming createAnonymousSession and the fix", () => {
    const wrapped = createKeyRingResolver<Env>(envRing) as unknown as KeyRingResolver<Env>;
    expect(() => createAnonymousSession<Env>({ ring: wrapped, storage: "cookie" })).toThrow(new Error(UNWRAP));
  });
});

describe("createAnonymousSession — a ring over the app's Bindings", () => {
  it("refuses a binding Env does not declare at bun check, and takes one it does", () => {
    const missing = () =>
      createAnonymousSession<Env>({
        // @ts-expect-error — `SESSION_SECRETS` is not a binding of Env
        ring: (env) => importKeyRing([env.SESSION_SECRETS]),
        storage: "cookie",
      });
    const declared = () => createAnonymousSession<Env>({ ring: (env) => importKeyRing([env.SESSION_SECRET]), storage: "cookie" });
    void [missing, declared];
  });
});

describe("createAnonymousSession — a resolver still written against the request context", () => {
  const HANDED_ENV = "this resolver is handed `env`, not the request context — rewrite `(c) => c.env.X` as `(env) => env.X`";
  // oxlint-disable-next-line typescript/no-explicit-any -- a 0.7.7 resolver typed against the context it is no longer handed
  type ContextResolver = (c: any) => any;

  async function firstRequestError(options: AnonymousSessionOptions<Env>): Promise<string> {
    const app = new Forge<Env>();
    app.setOnError((err) => new Response(err.message, { status: 500 }));
    app.use("*", createAnonymousSession<Env>(options));
    mapHandler(app, "GET", "/", () => new Response("reached"));
    const res = await app.request("/", {}, { SESSION_SECRET: SECRET, SESSIONS: fakeSessionKV().kv });
    return `${res.status} ${await res.text()}`;
  }

  const unconverted: { name: string; options: AnonymousSessionOptions<Env> }[] = [
    {
      name: "a ring reading c.env",
      options: { ring: ((c) => importKeyRing([c.env.SESSION_SECRET])) as ContextResolver as KeyRingResolver<Env>, storage: "cookie" },
    },
    {
      name: "a ring reading c.get",
      options: { ring: ((c) => importKeyRing([c.get("SESSION_SECRET")])) as ContextResolver as KeyRingResolver<Env>, storage: "cookie" },
    },
    { name: "a kv reading c.env", options: { ring: envRing, kv: ((c) => c.env.SESSIONS) as ContextResolver as (env: Env) => SessionKVBinding } },
  ];

  for (const { name, options } of unconverted) {
    it(`answers the first request with the rewrite for ${name}`, async () => {
      expect(await firstRequestError(options)).toBe(`500 ${HANDED_ENV}`);
    });
  }

  it("resolves a correct ring and kv once per env object across requests, and once more for another", async () => {
    let rings = 0;
    let kvs = 0;
    const app = new Forge<Env>();
    app.use(
      "*",
      createAnonymousSession<Env>({
        ring: (env) => {
          rings++;
          return envRing(env);
        },
        kv: (env) => {
          kvs++;
          return env.SESSIONS;
        },
      }),
    );
    mapHandler(app, "GET", "/", () => new Response("reached"));
    const env = { SESSION_SECRET: SECRET, SESSIONS: fakeSessionKV().kv };
    const bodies = [];
    for (let i = 0; i < 3; i++) bodies.push(await (await app.request("/", {}, env)).text());
    const underOneEnv = { rings, kvs };
    await app.request("/", {}, { SESSION_SECRET: SECRET, SESSIONS: fakeSessionKV().kv });
    expect({ bodies, underOneEnv, afterAnother: { rings, kvs } }).toEqual({
      bodies: ["reached", "reached", "reached"],
      underOneEnv: { rings: 1, kvs: 1 },
      afterAnother: { rings: 2, kvs: 2 },
    });
  });

  it("lets a real binding named env through to the ring", async () => {
    type Named = { env: string };
    const app = new Forge<Named>();
    app.use("*", createAnonymousSession<Named>({ ring: (bindings) => importKeyRing([bindings.env]), storage: "cookie" }));
    mapHandler(app, "POST", "/save", (context) => {
      sessionCtx.get(context).set("n", 1);
      return new Response("saved");
    });
    const res = await app.request("/save", { method: "POST" }, { env: SECRET });
    expect({ status: res.status, body: await res.text() }).toEqual({ status: 200, body: "saved" });
  });
});
