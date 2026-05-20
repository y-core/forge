import { describe, expect, it } from "bun:test";
import { createCookie } from "@remix-run/cookie";
import type { Session } from "@remix-run/session";
import { Hono } from "hono";
import { createCookieSessionStorage, createMemorySessionStorage, sessionMiddleware } from "./mod";

type TestVars = { Variables: { session: Session } };

const sessionCookie = createCookie("__session", { path: "/" });

describe("sessionMiddleware with cookie storage", () => {
  it("creates a new session for requests with no session cookie", async () => {
    const storage = createCookieSessionStorage();
    const app = new Hono<TestVars>();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    app.get("/", (c) => {
      const session = c.get("session");
      return c.text(session.id ? "has-id" : "no-id");
    });

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("has-id");
  });

  it("sets Set-Cookie when session is dirty", async () => {
    const storage = createCookieSessionStorage();
    const app = new Hono<TestVars>();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    app.post("/login", (c) => {
      const session = c.get("session");
      session.set("userId", "42");
      return c.text("ok");
    });

    const res = await app.request("/login", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).not.toBeNull();
  });

  it("does not set Set-Cookie when session is untouched", async () => {
    const storage = createCookieSessionStorage();
    const app = new Hono<TestVars>();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("sessionMiddleware with memory storage", () => {
  it("persists session data across requests", async () => {
    const storage = createMemorySessionStorage();
    const app = new Hono<TestVars>();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    app.post("/set", (c) => {
      const session = c.get("session");
      session.set("role", "admin");
      return c.text("ok");
    });
    app.get("/get", (c) => {
      const session = c.get("session");
      return c.text(String(session.get("role") ?? "none"));
    });

    // First request: set the value
    const setRes = await app.request("/set", { method: "POST" });
    const setCookieHeader = setRes.headers.get("set-cookie");
    expect(setCookieHeader).not.toBeNull();

    // Parse session ID from Set-Cookie to send on next request
    const match = setCookieHeader!.match(/__session=([^;]+)/);
    const sessionId = match?.[1] ?? "";

    // Second request: read the value back
    const getRes = await app.request("/get", {
      headers: { cookie: `__session=${sessionId}` },
    });
    expect(await getRes.text()).toBe("admin");
  });

  it("supports flash values consumed on next read", async () => {
    const storage = createMemorySessionStorage();
    const app = new Hono<TestVars>();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    app.post("/flash", (c) => {
      const session = c.get("session");
      session.flash("notice", "Saved!");
      return c.text("ok");
    });
    app.get("/read", (c) => {
      const session = c.get("session");
      return c.text(String(session.get("notice") ?? "empty"));
    });

    const flashRes = await app.request("/flash", { method: "POST" });
    const cookieHeader = flashRes.headers.get("set-cookie")!;
    const match = cookieHeader.match(/__session=([^;]+)/);
    const sessionId = match?.[1] ?? "";

    const readRes = await app.request("/read", {
      headers: { cookie: `__session=${sessionId}` },
    });
    expect(await readRes.text()).toBe("Saved!");
  });
});
