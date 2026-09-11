import { describe, expect, it } from "bun:test";

import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";

import { Forge } from "../app/forge-app";
import { csrfProtection, csrfTokenCtx, importCsrfKey } from "../form/csrf";
import { mapHandler } from "../testing/route";
import { createAnonymousSession } from "./anonymous";
import { createSignedCookie, createUnsignedCookie } from "./cookie";
import { sessionCtx, sessionMiddleware } from "./session";
import type { SessionKVBinding } from "./types";

const HEX_SECRET = "c".repeat(64);
const SESSION_SECRET = "s".repeat(48);
const sessionCookie = createUnsignedCookie("__session", { path: "/" });

function fakeSessionKV(): SessionKVBinding {
  const data = new Map<string, string>();
  return {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
  };
}

/** The cookie a browser would send back, from the `Set-Cookie` the response carried. */
function carry(res: Response): string {
  const header = res.headers.getSetCookie().find((c) => c.startsWith("__session="));
  if (!header) throw new Error("no session cookie on the response");
  return header.split(";")[0] ?? "";
}

describe("sessionMiddleware composed with csrfProtection", () => {
  it("lets an anonymous visitor complete a POST with no pre-seeded session", async () => {
    const key = await importCsrfKey(HEX_SECRET);
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
    app.use("*", csrfProtection({ secret: () => key, subject: (c) => sessionCtx.getOptional(c)?.id }));
    mapHandler(app, "GET", "/signup", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
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
    const key = await importCsrfKey(HEX_SECRET);
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
    app.use("*", csrfProtection({ secret: () => key, subject: (c) => sessionCtx.getOptional(c)?.id }));
    mapHandler(app, "GET", "/signup", (c) => new Response(sessionCtx.get(c).id));

    const first = await app.request("/signup");
    const cookie = carry(first);
    const second = await app.request("/signup", { headers: { cookie } });

    expect(await second.text()).toBe(await first.text());
  });

  it("emits a Set-Cookie on the GET, so the POST is not cookie-less", async () => {
    const key = await importCsrfKey(HEX_SECRET);
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
    app.use("*", csrfProtection({ secret: () => key, subject: (c) => sessionCtx.getOptional(c)?.id }));
    mapHandler(app, "GET", "/signup", () => new Response("ok"));

    const res = await app.request("/signup");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("__session="))).toBe(true);
  });

  it("refuses the POST when csrfProtection is registered before the session middleware", async () => {
    const key = await importCsrfKey(HEX_SECRET);
    const app = new Forge();
    app.use("*", csrfProtection({ secret: () => key, subject: (c) => sessionCtx.getOptional(c)?.id }));
    app.use("*", sessionMiddleware(createCookieSessionStorage(), sessionCookie));
    mapHandler(app, "GET", "/signup", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/signup", () => new Response("created"));

    const page = await app.request("/signup");
    const token = await page.text();

    const res = await app.request("/signup", { method: "POST", headers: { "X-CSRF-Token": token } });
    expect(res.status).toBe(403);
  });

  // The signature is upgraded under the visitor, so the id the token is bound to must not move.
  it("mints the same subject across a secret rotation", async () => {
    const key = await importCsrfKey(HEX_SECRET);
    const OLD = "o".repeat(32);
    const NEW = "n".repeat(32);
    const storage = createCookieSessionStorage();

    const build = (secrets: [string, ...string[]]) => {
      const app = new Forge();
      const cookie = createSignedCookie("__session", { path: "/", secrets });
      app.use("*", sessionMiddleware(storage, cookie, { rotating: secrets.length > 1 }));
      app.use("*", csrfProtection({ secret: () => key, subject: (c) => sessionCtx.getOptional(c)?.id }));
      mapHandler(app, "GET", "/id", (c) => new Response(sessionCtx.get(c).id));
      mapHandler(app, "GET", "/signup", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
      mapHandler(app, "POST", "/signup", () => new Response("created"));
      return app;
    };

    const first = await build([OLD]).request("/id");
    const beforeId = await first.text();
    const before = carry(first);

    const rotating = build([NEW, OLD]);
    const second = await rotating.request("/id", { headers: { cookie: before } });
    const after = carry(second);

    expect(await second.text()).toBe(beforeId);
    expect(after).not.toBe(before);

    // The token was minted under the pre-rotation cookie; it must still verify once the client
    // carries the re-signed one, and once the retired secret is gone.
    const token = await (await rotating.request("/signup", { headers: { cookie: before } })).text();
    const res = await build([NEW]).request("/signup", { method: "POST", headers: { "X-CSRF-Token": token, cookie: after } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("created");
  });

  it("works the same over a KV-backed anonymous session", async () => {
    type Env = { KV: SessionKVBinding };
    const key = await importCsrfKey(HEX_SECRET);
    const env: Env = { KV: fakeSessionKV() };
    const app = new Forge<Env>();
    app.use("*", createAnonymousSession<Env>({ secret: () => SESSION_SECRET, kv: (c) => c.env.KV }));
    app.use("*", csrfProtection({ secret: () => key, subject: (c) => sessionCtx.getOptional(c)?.id }));
    mapHandler(app, "GET", "/signup", (c) => new Response(csrfTokenCtx.getOptional(c) ?? ""));
    mapHandler(app, "POST", "/signup", () => new Response("created"));

    const page = await app.request("/signup", {}, env);
    const token = await page.text();
    const cookie = carry(page);

    const res = await app.request("/signup", { method: "POST", headers: { "X-CSRF-Token": token, cookie } }, env);
    expect(res.status).toBe(200);
  });
});
