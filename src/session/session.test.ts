import { describe, expect, it } from "bun:test";
import { createCookie } from "@remix-run/cookie";
import { createSession, createSessionId, Session } from "@remix-run/session";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";
import { createMemorySessionStorage } from "@remix-run/session/memory-storage";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
import { setPendingHeader } from "../context/pending-headers";
import { sessionCtx, sessionMiddleware } from "./session";

const sessionCookie = createCookie("__session", { path: "/" });

describe("sessionMiddleware with cookie storage", () => {
  it("creates a new session for requests with no session cookie", async () => {
    const storage = createCookieSessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "GET", "/", (c) => {
      const session = sessionCtx.get(c);
      return new Response(session.id ? "has-id" : "no-id");
    });

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("has-id");
  });

  it("sets Set-Cookie when session is dirty", async () => {
    const storage = createCookieSessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "POST", "/login", (c) => {
      const session = sessionCtx.get(c);
      session.set("userId", "42");
      return new Response("ok");
    });

    const res = await app.request("/login", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).not.toBeNull();
  });

  it("appends the session cookie without overwriting existing Set-Cookie headers", async () => {
    const storage = createCookieSessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "POST", "/login", (c) => {
      const session = sessionCtx.get(c);
      session.set("userId", "42");
      setPendingHeader(c, "set-cookie", "flash=1; Path=/", { append: true });
      return new Response("ok");
    });

    const res = await app.request("/login", { method: "POST" });
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    // Both cookies survive; set-cookie order is not semantically meaningful.
    expect(cookies.some((c) => c.includes("__session="))).toBe(true);
    expect(cookies.some((c) => c.includes("flash=1"))).toBe(true);
  });

  it("does not set Set-Cookie when session is untouched", async () => {
    const storage = createCookieSessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "GET", "/", () => new Response("ok"));

    const res = await app.request("/");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("emits exactly one Set-Cookie when a session is mutated", async () => {
    const storage = createCookieSessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "POST", "/login", (c) => {
      sessionCtx.get(c).set("userId", "42");
      return new Response("ok");
    });

    const res = await app.request("/login", { method: "POST" });
    expect(res.headers.getSetCookie()).toHaveLength(1);
  });
});

describe("sessionMiddleware destroy", () => {
  it("emits a Set-Cookie when a seeded session is destroyed", async () => {
    const storage = createMemorySessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "POST", "/set", (c) => {
      sessionCtx.get(c).set("userId", "42");
      return new Response("ok");
    });
    mapHandler(app, "POST", "/logout", (c) => {
      sessionCtx.get(c).destroy();
      return new Response("ok");
    });

    // Seed an existing session and capture its cookie.
    const setRes = await app.request("/set", { method: "POST" });
    const setCookie = setRes.headers.get("set-cookie")!;
    const sessionId = setCookie.match(/__session=([^;]+)/)?.[1] ?? "";

    const res = await app.request("/logout", { method: "POST", headers: { cookie: `__session=${sessionId}` } });
    expect(res.headers.get("set-cookie")).not.toBeNull();
  });
});

describe("sessionMiddleware with memory storage", () => {
  it("persists session data across requests", async () => {
    const storage = createMemorySessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "POST", "/set", (c) => {
      const session = sessionCtx.get(c);
      session.set("role", "admin");
      return new Response("ok");
    });
    mapHandler(app, "GET", "/get", (c) => {
      const session = sessionCtx.get(c);
      return new Response(String(session.get("role") ?? "none"));
    });

    // First request: set the value
    const setRes = await app.request("/set", { method: "POST" });
    const setCookieHeader = setRes.headers.get("set-cookie");
    expect(setCookieHeader).not.toBeNull();

    // Parse session ID from Set-Cookie to send on next request
    const match = setCookieHeader!.match(/__session=([^;]+)/);
    const sessionId = match?.[1] ?? "";

    // Second request: read the value back
    const getRes = await app.request("/get", { headers: { cookie: `__session=${sessionId}` } });
    expect(await getRes.text()).toBe("admin");
  });

  it("supports flash values consumed on next read", async () => {
    const storage = createMemorySessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "POST", "/flash", (c) => {
      const session = sessionCtx.get(c);
      session.flash("notice", "Saved!");
      return new Response("ok");
    });
    mapHandler(app, "GET", "/read", (c) => {
      const session = sessionCtx.get(c);
      return new Response(String(session.get("notice") ?? "empty"));
    });

    const flashRes = await app.request("/flash", { method: "POST" });
    const cookieHeader = flashRes.headers.get("set-cookie")!;
    const match = cookieHeader.match(/__session=([^;]+)/);
    const sessionId = match?.[1] ?? "";

    const readRes = await app.request("/read", { headers: { cookie: `__session=${sessionId}` } });
    expect(await readRes.text()).toBe("Saved!");
  });
});

describe("session primitives (facade re-exports)", () => {
  it("createSessionId returns unique non-empty string ids", () => {
    const a = createSessionId();
    const b = createSessionId();
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it("createSession and new Session() expose an id and typed get/set", () => {
    const s = createSession();
    expect(typeof s.id).toBe("string");
    s.set("user", "jane");
    expect(s.get("user")).toBe("jane");

    const direct = new Session();
    expect(typeof direct.id).toBe("string");
    expect(direct.id).not.toBe(s.id);
  });
});
