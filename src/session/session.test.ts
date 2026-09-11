import { describe, expect, it } from "bun:test";

import type { SessionStorage } from "@remix-run/session";
import { createSession, createSessionId, Session } from "@remix-run/session";
import { createCookieSessionStorage } from "@remix-run/session/cookie-storage";
import { createMemorySessionStorage } from "@remix-run/session/memory-storage";

import { Forge } from "../app/forge-app";
import { setPendingHeader } from "../context/pending-headers";
import { mapHandler } from "../testing/route";
import { createSignedCookie, createUnsignedCookie } from "./cookie";
import { createKVSessionStorage } from "./kv-storage";
import { sessionCtx, sessionMiddleware } from "./session";
import type { SessionCookieOptions, SessionKVBinding } from "./types";

function fakeKV(): SessionKVBinding {
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

const sessionCookie = createUnsignedCookie("__session", { path: "/" });

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

    const setRes = await app.request("/set", { method: "POST" });
    const setCookieHeader = setRes.headers.get("set-cookie");
    expect(setCookieHeader).not.toBeNull();

    const match = setCookieHeader!.match(/__session=([^;]+)/);
    const sessionId = match?.[1] ?? "";

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

describe("sessionMiddleware id observation", () => {
  it("emits a Set-Cookie when a handler reads only session.id", async () => {
    const storage = createMemorySessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "GET", "/", (c) => new Response(sessionCtx.get(c).id));

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).not.toBeNull();
  });

  it("round-trips the observed id identically on the next request", async () => {
    const storage = createMemorySessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "GET", "/", (c) => new Response(sessionCtx.get(c).id));

    const first = await app.request("/");
    const firstId = await first.text();
    const cookieValue = first.headers.get("set-cookie")!.match(/__session=([^;]+)/)?.[1] ?? "";

    const second = await app.request("/", { headers: { cookie: `__session=${cookieValue}` } });
    expect(await second.text()).toBe(firstId);
  });

  // The defect this closes: the documented CSRF wiring reads `.id` on every request, so every one
  // of them re-wrote an unchanged record to KV and re-issued a cookie carrying the same id.
  it("emits nothing on the next request, where the cookie already reproduces the id", async () => {
    const storage = createMemorySessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "GET", "/", (c) => new Response(sessionCtx.get(c).id));

    const first = await app.request("/");
    const cookieValue = first.headers.get("set-cookie")!.match(/__session=([^;]+)/)?.[1] ?? "";

    const second = await app.request("/", { headers: { cookie: `__session=${cookieValue}` } });
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("round-trips the observed id identically with cookie storage", async () => {
    const storage = createCookieSessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "GET", "/", (c) => new Response(sessionCtx.get(c).id));

    const first = await app.request("/");
    const firstId = await first.text();
    const cookieValue = first.headers.get("set-cookie")!.match(/__session=([^;]+)/)?.[1] ?? "";

    const second = await app.request("/", { headers: { cookie: `__session=${cookieValue}` } });
    expect(await second.text()).toBe(firstId);
  });

  // Cookie storage never reproduces the id from its own cookie value — the value is `{"i":…,"d":…}`
  // — so the re-issue is caught one layer up, where the serialized record equals the value received.
  it("emits nothing on the next request with cookie storage", async () => {
    const storage = createCookieSessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "GET", "/", (c) => new Response(sessionCtx.get(c).id));

    const first = await app.request("/");
    const cookieValue = first.headers.get("set-cookie")!.match(/__session=([^;]+)/)?.[1] ?? "";

    const second = await app.request("/", { headers: { cookie: `__session=${cookieValue}` } });
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("still emits a Set-Cookie with cookie storage when the session also changed", async () => {
    const storage = createCookieSessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "GET", "/", (c) => new Response(sessionCtx.get(c).id));
    mapHandler(app, "POST", "/set", (c) => {
      const session = sessionCtx.get(c);
      session.set("role", "admin");
      return new Response(session.id);
    });

    const first = await app.request("/");
    const cookieValue = first.headers.get("set-cookie")!.match(/__session=([^;]+)/)?.[1] ?? "";

    const second = await app.request("/set", { method: "POST", headers: { cookie: `__session=${cookieValue}` } });
    expect(second.headers.get("set-cookie")).not.toBeNull();
  });

  // The comparison is like-for-like only because `cookie.parse` returns the verified payload and
  // `storage.save` returns the pre-signing one. Comparing against the raw signed header would not match.
  it("emits nothing on the next request through a signed cookie", async () => {
    const signed = createSignedCookie("__session", { secrets: ["s".repeat(32)] });
    const storage = createCookieSessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, signed));
    mapHandler(app, "GET", "/", (c) => new Response(sessionCtx.get(c).id));

    const first = await app.request("/");
    const cookieValue = first.headers.get("set-cookie")!.match(/__session=([^;]+)/)?.[1] ?? "";

    const second = await app.request("/", { headers: { cookie: `__session=${cookieValue}` } });
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("still clears the cookie when a cookie-storage session is destroyed", async () => {
    const storage = createCookieSessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "GET", "/", (c) => new Response(sessionCtx.get(c).id));
    mapHandler(app, "POST", "/logout", (c) => {
      sessionCtx.get(c).destroy();
      return new Response("bye");
    });

    const first = await app.request("/");
    const cookieValue = first.headers.get("set-cookie")!.match(/__session=([^;]+)/)?.[1] ?? "";

    const out = await app.request("/logout", { method: "POST", headers: { cookie: `__session=${cookieValue}` } });
    expect(out.headers.get("set-cookie")).toBe("__session=; Path=/; SameSite=Lax");
  });

  it("emits nothing when a handler reads the session but never its id", async () => {
    const storage = createMemorySessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "GET", "/", (c) => new Response(String(sessionCtx.get(c).get("role") ?? "none")));

    const res = await app.request("/");
    expect(await res.text()).toBe("none");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("keeps set/get/flash/destroy working through the wrapper", async () => {
    const storage = createMemorySessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "POST", "/set", (c) => {
      const session = sessionCtx.get(c);
      session.set("role", "admin");
      session.flash("notice", "Saved!");
      return new Response(session.id);
    });
    mapHandler(app, "GET", "/read", (c) => {
      const session = sessionCtx.get(c);
      return new Response(`${String(session.get("role"))}:${String(session.get("notice"))}`);
    });
    mapHandler(app, "POST", "/logout", (c) => {
      sessionCtx.get(c).destroy();
      return new Response("bye");
    });

    const setRes = await app.request("/set", { method: "POST" });
    const cookieValue = setRes.headers.get("set-cookie")!.match(/__session=([^;]+)/)?.[1] ?? "";
    expect(await setRes.text()).not.toBe("");

    const readRes = await app.request("/read", { headers: { cookie: `__session=${cookieValue}` } });
    expect(await readRes.text()).toBe("admin:Saved!");

    const logoutRes = await app.request("/logout", { method: "POST", headers: { cookie: `__session=${cookieValue}` } });
    expect(logoutRes.headers.get("set-cookie")).not.toBeNull();
  });

  it("still satisfies instanceof Session", async () => {
    const storage = createMemorySessionStorage();
    const app = new Forge();
    app.use("*", sessionMiddleware(storage, sessionCookie));
    mapHandler(app, "GET", "/", (c) => new Response(String(sessionCtx.get(c) instanceof Session)));

    expect(await (await app.request("/")).text()).toBe("true");
  });
});

const OLD_SECRET = "o".repeat(32);
const NEW_SECRET = "n".repeat(32);

/** The `name=value` pair a browser would send back from a response's `Set-Cookie`. */
function carry(res: Response): string {
  return (
    res.headers
      .getSetCookie()
      .find((c) => c.startsWith("__session="))
      ?.split(";")[0] ?? ""
  );
}

/** No `rotating` anywhere: the cookie holds the secrets, so the middleware derives it. */
function rotationApp(secrets: [string, ...string[]], storage: SessionStorage, options?: SessionCookieOptions) {
  const cookie = createSignedCookie("__session", { path: "/", secrets });
  const app = new Forge();
  app.use("*", sessionMiddleware(storage, cookie, options));
  mapHandler(app, "GET", "/id", (c) => new Response(sessionCtx.get(c).id));
  mapHandler(app, "GET", "/quiet", () => new Response("ok"));
  mapHandler(app, "POST", "/set", (c) => {
    sessionCtx.get(c).set("role", "admin");
    return new Response("ok");
  });
  mapHandler(app, "GET", "/read", (c) => new Response(String(sessionCtx.get(c).get("role") ?? "none")));
  return { app, cookie };
}

describe("sessionMiddleware secret rotation", () => {
  it("re-issues a cookie signed with a retired secret, preserving the payload", async () => {
    const seed = rotationApp([OLD_SECRET], createCookieSessionStorage());
    const seeded = await seed.app.request("/set", { method: "POST" });
    const sent = carry(seeded);

    const serve = rotationApp([NEW_SECRET, OLD_SECRET], createCookieSessionStorage());
    const res = await serve.app.request("/id", { headers: { cookie: sent } });
    const issued = carry(res);

    expect(issued).not.toBe("");
    expect(issued).not.toBe(sent);
    expect(await serve.cookie.parse(issued)).toBe(await seed.cookie.parse(sent));
  });

  it("emits nothing when the cookie is already signed with the current secret", async () => {
    const seed = rotationApp([NEW_SECRET, OLD_SECRET], createCookieSessionStorage());
    const sent = carry(await seed.app.request("/set", { method: "POST" }));

    const serve = rotationApp([NEW_SECRET, OLD_SECRET], createCookieSessionStorage());
    const res = await serve.app.request("/id", { headers: { cookie: sent } });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  // The headline defect: a KV session that only reads `.id` is not dirty, so it never reaches
  // `storage.save` — a check bolted onto the save path would leave rotation stuck forever.
  it("completes rotation for KV storage on a request that touches nothing", async () => {
    const kv = fakeKV();
    const seed = rotationApp([OLD_SECRET], createKVSessionStorage(kv));
    const sent = carry(await seed.app.request("/set", { method: "POST" }));

    const serve = rotationApp([NEW_SECRET, OLD_SECRET], createKVSessionStorage(kv));
    const res = await serve.app.request("/quiet", { headers: { cookie: sent } });
    const issued = carry(res);

    expect(issued).not.toBe("");
    expect(issued).not.toBe(sent);
    expect(await serve.cookie.parse(issued)).toBe(await seed.cookie.parse(sent));
  });

  it("completes rotation for cookie storage on a request that touches nothing", async () => {
    const seed = rotationApp([OLD_SECRET], createCookieSessionStorage());
    const sent = carry(await seed.app.request("/set", { method: "POST" }));

    const serve = rotationApp([NEW_SECRET, OLD_SECRET], createCookieSessionStorage());
    const issued = carry(await serve.app.request("/quiet", { headers: { cookie: sent } }));

    expect(issued).not.toBe("");
    expect(issued).not.toBe(sent);
    expect(await serve.cookie.parse(issued)).toBe(await seed.cookie.parse(sent));
  });

  it("lets the retired secret be dropped on the following request", async () => {
    const seed = rotationApp([OLD_SECRET], createCookieSessionStorage());
    const sent = carry(await seed.app.request("/set", { method: "POST" }));

    const during = rotationApp([NEW_SECRET, OLD_SECRET], createCookieSessionStorage());
    const rotated = carry(await during.app.request("/quiet", { headers: { cookie: sent } }));

    const after = rotationApp([NEW_SECRET], createCookieSessionStorage());
    const res = await after.app.request("/read", { headers: { cookie: rotated } });
    expect(await res.text()).toBe("admin");
  });

  it("does not re-sign a cookie signed with a secret no longer in the array", async () => {
    const seed = rotationApp([OLD_SECRET], createCookieSessionStorage());
    const seeded = await seed.app.request("/id", { method: "GET" });
    const seededId = await seeded.text();
    const sent = carry(seeded);

    const serve = rotationApp([NEW_SECRET], createCookieSessionStorage());
    const res = await serve.app.request("/id", { headers: { cookie: sent } });
    expect(await res.text()).not.toBe(seededId);
  });

  it("does not re-sign a tampered value", async () => {
    const seed = rotationApp([OLD_SECRET], createCookieSessionStorage());
    const seeded = await seed.app.request("/id");
    const seededId = await seeded.text();
    const sent = carry(seeded);
    const tampered = `${sent.slice(0, 12)}${sent[12] === "A" ? "B" : "A"}${sent.slice(13)}`;

    const serve = rotationApp([NEW_SECRET, OLD_SECRET], createCookieSessionStorage());
    const res = await serve.app.request("/id", { headers: { cookie: tampered } });
    expect(await res.text()).not.toBe(seededId);
  });

  // The cost trade, pinned: off rotation the payload decides alone, so an unchanged session is
  // never re-signed — and a retired signature it cannot see is therefore left in place.
  it("leaves a retired signature alone when rotating is not set", async () => {
    const seed = rotationApp([OLD_SECRET], createCookieSessionStorage());
    const sent = carry(await seed.app.request("/set", { method: "POST" }));

    const serve = rotationApp([NEW_SECRET, OLD_SECRET], createCookieSessionStorage(), { rotating: false });
    const res = await serve.app.request("/quiet", { headers: { cookie: sent } });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("derives rotating from the cookie's own secrets", async () => {
    expect(createSignedCookie("__session", { secrets: [OLD_SECRET] }).rotating).toBe(false);
    expect(createSignedCookie("__session", { secrets: [NEW_SECRET, OLD_SECRET] }).rotating).toBe(true);
  });

  // An unsigned cookie has no secrets to rotate, so the derivation must not reach for a field it
  // does not have — re-signing an unchanged value there would cost a comparison and buy nothing.
  it("leaves an unsigned cookie's unchanged session alone", async () => {
    const cookie = createUnsignedCookie("__session", { path: "/" });
    const storage = createCookieSessionStorage();
    const seedApp = new Forge();
    seedApp.use("*", sessionMiddleware(storage, cookie));
    mapHandler(seedApp, "POST", "/set", (c) => {
      sessionCtx.get(c).set("role", "admin");
      return new Response("ok");
    });
    mapHandler(seedApp, "GET", "/quiet", () => new Response("ok"));
    const sent = carry(await seedApp.request("/set", { method: "POST" }));
    const res = await seedApp.request("/quiet", { headers: { cookie: sent } });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("still emits on a genuine write when rotating is not set", async () => {
    const seed = rotationApp([OLD_SECRET], createCookieSessionStorage());
    const sent = carry(await seed.app.request("/id"));

    const serve = rotationApp([OLD_SECRET], createCookieSessionStorage(), { rotating: false });
    const res = await serve.app.request("/set", { method: "POST", headers: { cookie: sent } });
    expect(res.headers.getSetCookie().filter((c) => c.startsWith("__session="))).toHaveLength(1);
  });
});

describe("sessionMiddleware reissue", () => {
  it("re-issues an unchanged session cookie when set", async () => {
    const storage = createCookieSessionStorage();
    const seed = rotationApp([OLD_SECRET], storage);
    const sent = carry(await seed.app.request("/set", { method: "POST" }));

    const serve = rotationApp([OLD_SECRET], createCookieSessionStorage(), { reissue: true });
    const res = await serve.app.request("/quiet", { headers: { cookie: sent } });
    const cookies = res.headers.getSetCookie().filter((c) => c.startsWith("__session="));
    expect(cookies).toHaveLength(1);
  });

  it("emits nothing for a request carrying no session cookie", async () => {
    const serve = rotationApp([OLD_SECRET], createCookieSessionStorage(), { reissue: true });
    const res = await serve.app.request("/quiet");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("emits exactly one Set-Cookie when the session also changed", async () => {
    const seed = rotationApp([OLD_SECRET], createCookieSessionStorage());
    const sent = carry(await seed.app.request("/set", { method: "POST" }));

    const serve = rotationApp([OLD_SECRET], createCookieSessionStorage(), { reissue: true });
    const res = await serve.app.request("/set", { method: "POST", headers: { cookie: sent } });
    expect(res.headers.getSetCookie().filter((c) => c.startsWith("__session="))).toHaveLength(1);
  });

  it("re-arms Max-Age on an unchanged session", async () => {
    const cookie = createSignedCookie("__session", { path: "/", secrets: [OLD_SECRET], maxAge: 600 });
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), cookie, { reissue: true }));
    mapHandler(app, "POST", "/set", (c) => {
      sessionCtx.get(c).set("role", "admin");
      return new Response("ok");
    });
    mapHandler(app, "GET", "/quiet", () => new Response("ok"));

    const sent = carry(await app.request("/set", { method: "POST" }));
    const res = await app.request("/quiet", { headers: { cookie: sent } });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=600");
  });

  it("carries tightened attributes to a client holding a valid session", async () => {
    const loose = createSignedCookie("__session", { path: "/", secrets: [OLD_SECRET], sameSite: "Lax" });
    const seedApp = new Forge();
    seedApp.use("*", sessionMiddleware(createCookieSessionStorage(), loose));
    mapHandler(seedApp, "POST", "/set", (c) => {
      sessionCtx.get(c).set("role", "admin");
      return new Response("ok");
    });
    const sent = carry(await seedApp.request("/set", { method: "POST" }));

    const tight = createSignedCookie("__session", { path: "/", secrets: [OLD_SECRET], sameSite: "Strict" });
    const serveApp = new Forge();
    serveApp.use("*", sessionMiddleware(createCookieSessionStorage(), tight, { reissue: true }));
    mapHandler(serveApp, "GET", "/quiet", () => new Response("ok"));

    const header = (await serveApp.request("/quiet", { headers: { cookie: sent } })).headers.get("set-cookie") ?? "";
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Secure");
  });
});

describe("sessionMiddleware suppression edges", () => {
  it("emits nothing when a handler unsets an absent key", async () => {
    const storage = createCookieSessionStorage();
    const seed = rotationApp([OLD_SECRET], storage);
    const sent = carry(await seed.app.request("/set", { method: "POST" }));

    const cookie = createSignedCookie("__session", { path: "/", secrets: [OLD_SECRET] });
    const app = new Forge();
    app.use("*", sessionMiddleware(createCookieSessionStorage(), cookie));
    mapHandler(app, "GET", "/", (c) => {
      sessionCtx.get(c).unset("absent");
      return new Response("ok");
    });

    const res = await app.request("/", { headers: { cookie: sent } });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("emits nothing when the client sends an empty session cookie", async () => {
    for (const reissue of [false, true]) {
      const serve = rotationApp([OLD_SECRET], createCookieSessionStorage(), { reissue });
      const res = await serve.app.request("/quiet", { headers: { cookie: "__session=" } });
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("reads the first value on a duplicate cookie name", async () => {
    const seed = rotationApp([OLD_SECRET], createCookieSessionStorage());
    const sent = carry(await seed.app.request("/set", { method: "POST" }));

    const serve = rotationApp([OLD_SECRET], createCookieSessionStorage());
    const res = await serve.app.request("/read", { headers: { cookie: `${sent}; __session=junk` } });
    expect(await res.text()).toBe("admin");
    expect(res.headers.get("set-cookie")).toBeNull();
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
