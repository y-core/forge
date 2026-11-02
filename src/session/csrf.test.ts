import { describe, expect, it } from "bun:test";

import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../app/forge-app";
import { importKeyRing } from "../crypto/keyring/ring";
import { csrfProtection, mintCsrf } from "../form/csrf";
import { mapHandler } from "../testing/route";
import { createAnonymousSession } from "./anonymous";
import { createSignedCookie } from "./cookie";
import { sessionCtx, sessionMiddleware } from "./session";
import type { SessionKVBinding } from "./types";

const HEX_SECRET = "8b7680f6f106e5235091e5cdcc23ed1f2bd06cd47e14022ec96f670b87a7157d";
const SESSION_SECRET = "c15f22e5e9af45d15e1068ac2186b479735f5c60e4fc302f8916ab67aaf6b2c6";
const sessionRing = await importKeyRing([SESSION_SECRET]);
const sessionCookie = createSignedCookie("__session", { path: "/", ring: sessionRing });

function fakeSessionKV(): { kv: SessionKVBinding; puts: string[]; deletes: string[] } {
  const data = new Map<string, string>();
  const puts: string[] = [];
  const deletes: string[] = [];
  const kv: SessionKVBinding = {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => {
      puts.push(key);
      data.set(key, value);
    },
    delete: async (key) => {
      deletes.push(key);
      data.delete(key);
    },
  };
  return { kv, puts, deletes };
}

/** The cookie a browser would send back, from the `Set-Cookie` the response carried. */
function carry(res: Response, name = "__session"): string {
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (!header) throw new Error("no session cookie on the response");
  return header.split(";")[0] ?? "";
}

describe("sessionMiddleware composed with csrfProtection", () => {
  it("lets an anonymous visitor complete a POST with no pre-seeded session", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
    app.use("*", csrfProtection({ ring: () => ring, subject: (c) => sessionCtx.getOptional(c)?.id }));
    mapHandler(app, "GET", "/signup", async (c) => new Response(await mintCsrf(c, "/signup")));
    mapHandler(app, "POST", "/signup", () => new Response("created"));

    const page = await app.request("/signup");
    expect(page.status).toBe(200);
    const token = await page.text();
    const cookie = carry(page);

    const res = await app.request("/signup", { method: "POST", headers: { "X-CSRF-Token": token, cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("created");
  });

  it("mints the same subject on two successive GETs once the cookie is carried", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
    app.use("*", csrfProtection({ ring: () => ring, subject: (c) => sessionCtx.getOptional(c)?.id }));
    mapHandler(app, "GET", "/signup", (c) => new Response(sessionCtx.get(c).id));

    const first = await app.request("/signup");
    const cookie = carry(first);
    const second = await app.request("/signup", { headers: { cookie } });

    expect(await second.text()).toBe(await first.text());
  });

  it("emits a Set-Cookie on a GET whose handler mints a token, so the POST is not cookie-less", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
    app.use("*", csrfProtection({ ring: () => ring, subject: (c) => sessionCtx.getOptional(c)?.id }));
    mapHandler(app, "GET", "/signup", async (c) => new Response(await mintCsrf(c, "/signup")));

    const res = await app.request("/signup");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("__session="))).toBe(true);
  });

  it("emits no Set-Cookie on a GET whose handler mints nothing", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
    app.use("*", csrfProtection({ ring: () => ring, subject: (c) => sessionCtx.getOptional(c)?.id }));
    mapHandler(app, "GET", "/signup", () => new Response("ok"));

    const res = await app.request("/signup");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("__session="))).toBe(false);
  });

  it("refuses the POST when csrfProtection is registered before the session middleware", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const app = new Forge();
    app.use("*", csrfProtection({ ring: () => ring, subject: (c) => sessionCtx.getOptional(c)?.id }));
    app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
    mapHandler(app, "GET", "/signup", async (c) => new Response(await mintCsrf(c, "/signup")));
    mapHandler(app, "POST", "/signup", () => new Response("created"));

    const page = await app.request("/signup");
    const token = await page.text();

    const res = await app.request("/signup", { method: "POST", headers: { "X-CSRF-Token": token } });
    expect(res.status).toBe(403);
  });

  // The signature is upgraded under the visitor, so the id the token is bound to must not move.
  it("mints the same subject across a key rotation", async () => {
    const ring = await importKeyRing([HEX_SECRET]);
    const OLD = "3e8f0241998536b82050a9b2cdb21c47ee4215e1bd4ec7a04ec2ad348757f370";
    const NEW = "17205855bdb251c4096292802c9a3aa04af4e27a549226c829204ab1fce2ea22";
    const storage = createCookieSessionStorage();

    const build = async (secrets: [string, ...string[]]) => {
      const app = new Forge();
      const cookie = createSignedCookie("__session", { path: "/", ring: await importKeyRing(secrets) });
      app.use("*", sessionMiddleware(storage, cookie, { rotating: secrets.length > 1 }));
      app.use("*", csrfProtection({ ring: () => ring, subject: (c) => sessionCtx.getOptional(c)?.id }));
      mapHandler(app, "GET", "/id", (c) => new Response(sessionCtx.get(c).id));
      mapHandler(app, "GET", "/signup", async (c) => new Response(await mintCsrf(c, "/signup")));
      mapHandler(app, "POST", "/signup", () => new Response("created"));
      return app;
    };

    const first = await (await build([OLD])).request("/id");
    const beforeId = await first.text();
    const before = carry(first);

    const rotating = await build([NEW, OLD]);
    const second = await rotating.request("/id", { headers: { cookie: before } });
    const after = carry(second);

    expect(await second.text()).toBe(beforeId);
    expect(after).not.toBe(before);

    // The token was minted under the pre-rotation cookie; it must still verify once the client
    // carries the re-signed one, and once the retired key is gone.
    const token = await (await rotating.request("/signup", { headers: { cookie: before } })).text();
    const res = await (await build([NEW])).request("/signup", { method: "POST", headers: { "X-CSRF-Token": token, cookie: after } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("created");
  });

  it("works the same over a KV-backed anonymous session", async () => {
    type Env = { KV: SessionKVBinding };
    const ring = await importKeyRing([HEX_SECRET]);
    const env: Env = { KV: fakeSessionKV().kv };
    const app = new Forge<Env>();
    app.use("*", createAnonymousSession<Env>({ ring: () => sessionRing, kv: (c) => c.env.KV }));
    app.use("*", csrfProtection({ ring: () => ring, subject: (c) => sessionCtx.getOptional(c)?.id }));
    mapHandler(app, "GET", "/signup", async (c) => new Response(await mintCsrf(c, "/signup")));
    mapHandler(app, "POST", "/signup", () => new Response("created"));

    const page = await app.request("/signup", {}, env);
    const token = await page.text();
    const cookie = carry(page, "__Host-session");

    const res = await app.request("/signup", { method: "POST", headers: { "X-CSRF-Token": token, cookie } }, env);
    expect(res.status).toBe(200);
  });
});

describe("a KV-backed anonymous session under csrfProtection", () => {
  type Env = { KV: SessionKVBinding };

  async function build() {
    const ring = await importKeyRing([HEX_SECRET]);
    const { kv, puts, deletes } = fakeSessionKV();
    const env: Env = { KV: kv };
    const app = new Forge<Env>();
    app.use("*", createAnonymousSession<Env>({ ring: () => sessionRing, kv: (c) => c.env.KV, prefix: "visitor" }));
    app.use("*", csrfProtection({ ring: () => ring, subject: (c) => sessionCtx.getOptional(c)?.id }));
    mapHandler(app, "GET", "/signin", async (c) => new Response(await mintCsrf(c, "/signin")));
    mapHandler(app, "GET", "/remember", async (c) => new Response(await mintCsrf(c, "/remember")));
    mapHandler(app, "GET", "/about", () => new Response("about"));
    mapHandler(app, "GET", "/id", (c) => new Response(sessionCtx.get(c).id));
    mapHandler(app, "POST", "/signin", () => new Response("signed in"));
    mapHandler(app, "POST", "/remember", (c) => {
      sessionCtx.get(c).set("remembered", true);
      return new Response("remembered");
    });
    const request = (path: string, init?: RequestInit) => app.request(path, init ?? {}, env);
    return { request, puts, deletes };
  }

  it("a cookie-less GET of a page rendering a csrf-protected form performs no session store write", async () => {
    const { request, puts, deletes } = await build();
    const page = await request("/signin");

    expect(page.status).toBe(200);
    expect(page.headers.getSetCookie().some((c) => c.startsWith("__Host-session="))).toBe(true);
    expect(puts).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it("a refused cookie-less POST to a csrf-protected route performs no session store write", async () => {
    const { request, puts, deletes } = await build();
    const res = await request("/signin", { method: "POST" });

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
    expect(puts).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it("the GET's token verifies on a POST carrying its cookie, and neither request writes", async () => {
    const { request, puts, deletes } = await build();
    const page = await request("/signin");
    const token = await page.text();
    const cookie = carry(page, "__Host-session");

    const res = await request("/signin", { method: "POST", headers: { "X-CSRF-Token": token, cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("signed in");
    expect(puts).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it("a GET whose handler mints nothing sets no cookie and writes nothing", async () => {
    const { request, puts, deletes } = await build();
    const res = await request("/about");

    expect(await res.text()).toBe("about");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(puts).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it("a visitor who stores data is still written", async () => {
    const { request, puts } = await build();
    const page = await request("/remember");
    const token = await page.text();
    const cookie = carry(page, "__Host-session");
    const id = await (await request("/id", { headers: { cookie } })).text();

    const res = await request("/remember", { method: "POST", headers: { "X-CSRF-Token": token, cookie } });
    expect(await res.text()).toBe("remembered");
    expect(puts).toEqual([`visitor:${id}`]);
  });
});
