import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import { createKeyRingResolver } from "../../crypto/keyring/resolver";
import { importKeyRing } from "../../crypto/keyring/ring";
import type { KeyRingResolver } from "../../crypto/keyring/types";
import { mapHandler } from "../../testing/route";
import { createFlash } from "./flash-cookie";
import type { FlashMessage } from "./types";

const ring = await importKeyRing(["df7bc215d10b817ca5757fe2b023738f06d7ccb1de2f33087c06428643c8ee3b"]);

function extractCookieValue(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/flash=([^;]+)/);
  return match ? match[1]! : null;
}

describe("createFlash", () => {
  it("names the ring's active key id on the wire", async () => {
    const flash = createFlash({ ring: () => ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await flash.set(c, [{ type: "info", text: "kid" }]);
      return new Response("ok");
    });
    const cookieValue = extractCookieValue((await app.request("/")).headers.get("Set-Cookie"));
    expect(cookieValue?.split(".").at(-2)).toBe(ring.activeKeyId);
  });
});

describe("ring", () => {
  it("hands the resolver the request's context, env included", async () => {
    const seen: unknown[] = [];
    const flash = createFlash<{ FLASH_SECRET: string }>({
      ring: (env) => {
        seen.push(env.FLASH_SECRET);
        return ring;
      },
    });
    const app = new Forge<{ FLASH_SECRET: string }>();
    mapHandler(app, "GET", "/", async (c) => {
      await flash.success(c, "env");
      return new Response("ok");
    });
    await app.request("/", {}, { FLASH_SECRET: "from-env" });
    expect(seen).toEqual(["from-env"]);
  });

  it("resolves its ring once across set and get requests sharing one env, and again for another env", async () => {
    let calls = 0;
    const flash = createFlash({
      ring: () => {
        calls++;
        return ring;
      },
    });
    const app = new Forge();
    mapHandler(app, "GET", "/set", async (c) => {
      await flash.info(c, "memo");
      return new Response("ok");
    });
    mapHandler(app, "GET", "/get", async (c) => Response.json(await flash.get(c)));
    const env = {};
    const cookieValue = extractCookieValue((await app.request("/set", {}, env)).headers.get("Set-Cookie"));
    const read = await (await app.request("/get", { headers: { Cookie: `flash=${cookieValue}` } }, env)).json();
    await app.request("/set", {}, env);
    const callsUnderOneEnv = calls;
    await app.request("/set", {}, {});
    expect({ read, callsUnderOneEnv, callsAfterSecondEnv: calls }).toEqual({
      read: [{ type: "info", text: "memo" }],
      callsUnderOneEnv: 1,
      callsAfterSecondEnv: 2,
    });
  });

  it("signs each request under the ring its resolver returns then", async () => {
    const other = await importKeyRing(["8a51f3c09e27b4d6105c7ea3f9b28d4e6c0a17f5b3e9d2c48f6a0b1e7d3c5a92"]);
    const rings = [ring, other];
    const flash = createFlash({ ring: () => rings.shift() ?? ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await flash.info(c, "kid");
      return new Response("ok");
    });
    const kids = [];
    for (let i = 0; i < 2; i++)
      kids.push(
        extractCookieValue((await app.request("/")).headers.get("Set-Cookie"))
          ?.split(".")
          .at(-2),
      );
    expect(kids).toEqual([ring.activeKeyId, other.activeKeyId]);
  });
});

describe("set", () => {
  it("writes a signed Set-Cookie header with correct attributes", async () => {
    const flash = createFlash({ ring: () => ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await flash.set(c, [{ type: "success", text: "Hello" }]);
      return new Response("ok");
    });
    const res = await app.request("/");
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("flash=");
    expect(setCookie).toContain("Max-Age=60");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
  });
});

describe("get", () => {
  it("round-trips a message array", async () => {
    const flash = createFlash({ ring: () => ring });
    const messages: FlashMessage[] = [
      { type: "info", text: "test message" },
      { type: "warning", text: "watch out" },
    ];

    const setApp = new Forge();
    mapHandler(setApp, "GET", "/", async (c) => {
      await flash.set(c, messages);
      return new Response("ok");
    });
    const setRes = await setApp.request("/");
    const cookieValue = extractCookieValue(setRes.headers.get("Set-Cookie"));
    expect(cookieValue).not.toBeNull();

    const getApp = new Forge();
    mapHandler(getApp, "GET", "/", async (c) => Response.json(await flash.get(c)));
    const getRes = await getApp.request("/", { headers: { Cookie: `flash=${cookieValue}` } });
    expect(await getRes.json()).toEqual(messages);
  });

  it("clears the cookie after reading (read-once)", async () => {
    const flash = createFlash({ ring: () => ring });

    const setApp = new Forge();
    mapHandler(setApp, "GET", "/", async (c) => {
      await flash.set(c, [{ type: "success", text: "once" }]);
      return new Response("ok");
    });
    const setRes = await setApp.request("/");
    const cookieValue = extractCookieValue(setRes.headers.get("Set-Cookie"));

    const getApp = new Forge();
    mapHandler(getApp, "GET", "/", async (c) => {
      await flash.get(c);
      return new Response("ok");
    });
    const getRes = await getApp.request("/", { headers: { Cookie: `flash=${cookieValue}` } });
    const clearHeader = getRes.headers.get("Set-Cookie") ?? "";
    expect(clearHeader).toContain("Max-Age=0");
  });

  it("returns empty array when no flash cookie is present", async () => {
    const flash = createFlash({ ring: () => ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => Response.json(await flash.get(c)));
    const res = await app.request("/");
    expect(await res.json()).toEqual([]);
  });

  it("returns empty array for a tampered cookie value", async () => {
    const flash = createFlash({ ring: () => ring });

    const setApp = new Forge();
    mapHandler(setApp, "GET", "/", async (c) => {
      await flash.set(c, [{ type: "success", text: "legit" }]);
      return new Response("ok");
    });
    const setRes = await setApp.request("/");
    const cookieValue = extractCookieValue(setRes.headers.get("Set-Cookie"));
    expect(cookieValue).not.toBeNull();

    // The first character, not the last: base64url drops the low bits of a final character whenever
    // the length is not a multiple of four, so `x` and `y` there decode to the same bytes.
    const tampered = (cookieValue!.startsWith("x") ? "y" : "x") + cookieValue!.slice(1);

    const getApp = new Forge();
    mapHandler(getApp, "GET", "/", async (c) => Response.json(await flash.get(c)));
    const getRes = await getApp.request("/", { headers: { Cookie: `flash=${tampered}` } });
    expect(await getRes.json()).toEqual([]);
    expect(getRes.headers.get("Set-Cookie") ?? "").toContain("Max-Age=0");
  });

  // The clear is keyed on the cookie being present, not on its value verifying: a value the server
  // now refuses is re-sent by the browser on every request, and would be re-refused forever.
  it("clears a cookie the signed expiry has since put out of reach", async () => {
    const flash = createFlash({ ring: () => ring, maxAge: 1 });

    const setApp = new Forge();
    mapHandler(setApp, "GET", "/", async (c) => {
      await flash.set(c, [{ type: "info", text: "stale" }]);
      return new Response("ok");
    });
    const cookieValue = extractCookieValue((await setApp.request("/")).headers.get("Set-Cookie"));
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const getApp = new Forge();
    mapHandler(getApp, "GET", "/", async (c) => Response.json(await flash.get(c)));
    const getRes = await getApp.request("/", { headers: { Cookie: `flash=${cookieValue}` } });
    expect(await getRes.json()).toEqual([]);
    expect(getRes.headers.get("Set-Cookie") ?? "").toContain("Max-Age=0");
  });

  it("emits no clear at all where the request carried no flash cookie", async () => {
    const flash = createFlash({ ring: () => ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => Response.json(await flash.get(c)));
    const res = await app.request("/", { headers: { Cookie: "other=1" } });
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
});

describe("shared cookie attributes", () => {
  /** Sets one message under `flash`, then reads it back; answers the set's and the read's Set-Cookie. */
  async function setThenRead(flash: ReturnType<typeof createFlash>): Promise<{ set: string; clear: string }> {
    const setApp = new Forge();
    mapHandler(setApp, "GET", "/", async (c) => {
      await flash.set(c, [{ type: "info", text: "scoped" }]);
      return new Response("ok");
    });
    const set = (await setApp.request("/")).headers.get("Set-Cookie") ?? "";
    const getApp = new Forge();
    mapHandler(getApp, "GET", "/", async (c) => {
      await flash.get(c);
      return new Response("ok");
    });
    const clear = (await getApp.request("/", { headers: { Cookie: `flash=${extractCookieValue(set)}` } })).headers.get("Set-Cookie") ?? "";
    return { set, clear };
  }

  it("sets with exactly HttpOnly, Max-Age=60, Path=/, SameSite=Lax and Secure, and clears on Path=/", async () => {
    const { set, clear } = await setThenRead(createFlash({ ring: () => ring }));
    expect({ set: set.split("; ").slice(1), clear }).toEqual({
      set: ["HttpOnly", "Max-Age=60", "Path=/", "SameSite=Lax", "Secure"],
      clear: "flash=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax; Secure",
    });
  });

  it("sets and clears on a custom path, keeping the shared attributes", async () => {
    const { set, clear } = await setThenRead(createFlash({ ring: () => ring, path: "/app" }));
    expect({ set: set.split("; ").slice(1), clear }).toEqual({
      set: ["HttpOnly", "Max-Age=60", "Path=/app", "SameSite=Lax", "Secure"],
      clear: "flash=; HttpOnly; Max-Age=0; Path=/app; SameSite=Lax; Secure",
    });
  });

  it("sets and clears with a Strict sameSite override", async () => {
    const { set, clear } = await setThenRead(createFlash({ ring: () => ring, sameSite: "Strict" }));
    expect({ set: set.split("; ").slice(1), clear }).toEqual({
      set: ["HttpOnly", "Max-Age=60", "Path=/", "SameSite=Strict", "Secure"],
      clear: "flash=; HttpOnly; Max-Age=0; Path=/; SameSite=Strict; Secure",
    });
  });
});

describe("convenience methods", () => {
  const cases = [
    { name: "success", type: "success" },
    { name: "info", type: "info" },
    { name: "warning", type: "warning" },
    { name: "error", type: "error" },
  ] as const;

  for (const { name, type } of cases) {
    it(`${name}() stores exactly one message of type "${type}"`, async () => {
      const flash = createFlash({ ring: () => ring });

      const setApp = new Forge();
      mapHandler(setApp, "GET", "/", async (c) => {
        await flash[name](c, "the text");
        return new Response("ok");
      });
      const setRes = await setApp.request("/");
      const cookieValue = extractCookieValue(setRes.headers.get("Set-Cookie"));
      expect(cookieValue).not.toBeNull();

      const getApp = new Forge();
      mapHandler(getApp, "GET", "/", async (c) => Response.json(await flash.get(c)));
      const getRes = await getApp.request("/", { headers: { Cookie: `flash=${cookieValue}` } });
      expect(await getRes.json()).toEqual([{ type, text: "the text" }]);
    });
  }
});

const flashCookies = (res: Response) => res.headers.getSetCookie().filter((h) => h.startsWith("flash="));

async function wireFor(flash: ReturnType<typeof createFlash>, messages: FlashMessage[]): Promise<string> {
  const app = new Forge();
  mapHandler(app, "GET", "/", async (c) => {
    await flash.set(c, messages);
    return new Response("ok");
  });
  return extractCookieValue((await app.request("/")).headers.get("Set-Cookie"))!;
}

async function readBack(flash: ReturnType<typeof createFlash>, setCookie: string): Promise<unknown> {
  const app = new Forge();
  mapHandler(app, "GET", "/", async (c) => Response.json(await flash.get(c)));
  return (await app.request("/", { headers: { Cookie: `flash=${extractCookieValue(setCookie)}` } })).json();
}

describe("one cookie per response", () => {
  it("merges a success then a warning into one cookie that reads back as both, in order", async () => {
    const flash = createFlash({ ring: () => ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await flash.success(c, "Saved");
      await flash.warning(c, "Quota nearly full");
      return new Response("ok");
    });
    const cookies = flashCookies(await app.request("/"));
    expect(cookies).toHaveLength(1);
    expect(await readBack(flash, cookies[0]!)).toEqual([
      { type: "success", text: "Saved" },
      { type: "warning", text: "Quota nearly full" },
    ]);
  });

  it("appends a later set to an earlier set of several, keeping call order", async () => {
    const flash = createFlash({ ring: () => ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await flash.set(c, [
        { type: "info", text: "first" },
        { type: "error", text: "second" },
      ]);
      await flash.set(c, [{ type: "success", text: "third" }]);
      return new Response("ok");
    });
    const cookies = flashCookies(await app.request("/"));
    expect(cookies).toHaveLength(1);
    expect(await readBack(flash, cookies[0]!)).toEqual([
      { type: "info", text: "first" },
      { type: "error", text: "second" },
      { type: "success", text: "third" },
    ]);
  });

  it("replaces the read's clear with a set made after it, carrying only the new messages", async () => {
    const flash = createFlash({ ring: () => ring });
    const incoming = await wireFor(flash, [{ type: "info", text: "from last page" }]);
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await flash.get(c);
      await flash.success(c, "fresh");
      return new Response("ok");
    });
    const cookies = flashCookies(await app.request("/", { headers: { Cookie: `flash=${incoming}` } }));
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).not.toMatch(/Max-Age=0(;|$)/);
    expect(await readBack(flash, cookies[0]!)).toEqual([{ type: "success", text: "fresh" }]);
  });

  it("keeps a set made before the read instead of queuing the read's clear", async () => {
    const flash = createFlash({ ring: () => ring });
    const incoming = await wireFor(flash, [{ type: "info", text: "from last page" }]);
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await flash.success(c, "fresh");
      await flash.get(c);
      return new Response("ok");
    });
    const cookies = flashCookies(await app.request("/", { headers: { Cookie: `flash=${incoming}` } }));
    expect(cookies).toHaveLength(1);
    expect(await readBack(flash, cookies[0]!)).toEqual([{ type: "success", text: "fresh" }]);
  });

  it("queues a single clear when the flash is read twice", async () => {
    const flash = createFlash({ ring: () => ring });
    const incoming = await wireFor(flash, [{ type: "info", text: "from last page" }]);
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await flash.get(c);
      await flash.get(c);
      return new Response("ok");
    });
    const cookies = flashCookies(await app.request("/", { headers: { Cookie: `flash=${incoming}` } }));
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/Max-Age=0(;|$)/);
  });

  it("merges two flash calls made together into one cookie, in the order they were called", async () => {
    const flash = createFlash({ ring: () => ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await Promise.all([flash.success(c, "a"), flash.warning(c, "b")]);
      return new Response("ok");
    });
    const cookies = flashCookies(await app.request("/"));
    expect(cookies).toHaveLength(1);
    expect(await readBack(flash, cookies[0]!)).toEqual([
      { type: "success", text: "a" },
      { type: "warning", text: "b" },
    ]);
  });

  it("a refused call between two others leaves both of their messages queued", async () => {
    const flash = createFlash({ ring: () => ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      const settled = await Promise.allSettled([flash.success(c, "a"), flash.info(c, "a".repeat(4000)), flash.warning(c, "b")]);
      expect(settled.map((s) => s.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
      expect((settled[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
      expect(((settled[1] as PromiseRejectedResult).reason as Error).message).toMatch(/at most 4096 bytes/);
      return new Response("ok");
    });
    const cookies = flashCookies(await app.request("/"));
    expect(cookies).toHaveLength(1);
    expect(await readBack(flash, cookies[0]!)).toEqual([
      { type: "success", text: "a" },
      { type: "warning", text: "b" },
    ]);
  });

  it("a read made alongside two calls neither clears nor drops them", async () => {
    const flash = createFlash({ ring: () => ring });
    const incomingMessages: FlashMessage[] = [{ type: "info", text: "from last page" }];
    const incoming = await wireFor(flash, incomingMessages);
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      const [read] = await Promise.all([flash.get(c), flash.success(c, "a"), flash.warning(c, "b")]);
      expect(read).toEqual(incomingMessages);
      return new Response("ok");
    });
    const cookies = flashCookies(await app.request("/", { headers: { Cookie: `flash=${incoming}` } }));
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).not.toMatch(/Max-Age=0(;|$)/);
    expect(await readBack(flash, cookies[0]!)).toEqual([
      { type: "success", text: "a" },
      { type: "warning", text: "b" },
    ]);
  });
});

describe("past 4096 bytes", () => {
  const long = (lead: string) => lead + "a".repeat(1200);

  it("drops the oldest message when a third call would overflow the cookie", async () => {
    const flash = createFlash({ ring: () => ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await flash.info(c, long("1"));
      await flash.info(c, long("2"));
      await flash.info(c, long("3"));
      return new Response("ok");
    });
    const cookies = flashCookies(await app.request("/"));
    expect(cookies).toHaveLength(1);
    expect(await readBack(flash, cookies[0]!)).toEqual([
      { type: "info", text: long("2") },
      { type: "info", text: long("3") },
    ]);
  });

  it("drops the oldest of one oversized batch rather than failing the request", async () => {
    const flash = createFlash({ ring: () => ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await flash.set(c, [
        { type: "info", text: long("1") },
        { type: "info", text: long("2") },
        { type: "info", text: long("3") },
      ]);
      return new Response("ok");
    });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const cookies = flashCookies(res);
    expect(cookies).toHaveLength(1);
    expect(await readBack(flash, cookies[0]!)).toEqual([
      { type: "info", text: long("2") },
      { type: "info", text: long("3") },
    ]);
  });

  it("refuses a lone message too large for the cookie", async () => {
    const flash = createFlash({ ring: () => ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await expect(flash.info(c, "a".repeat(4000))).rejects.toThrow(/at most 4096 bytes/);
      return new Response("ok");
    });
    expect((await app.request("/")).status).toBe(200);
  });
});

describe("ring — createKeyRingResolver's wrapper", () => {
  interface AppEnv {
    readonly FLASH_SECRET: string;
  }
  const UNWRAP = "createFlash: pass the `(env) => importKeyRing(…)` function itself, not `createKeyRingResolver(…)`";

  it("is refused at bun check whatever Bindings it was made under, and throws at construction", () => {
    const inferred = () =>
      createFlash({
        // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
        ring: createKeyRingResolver(() => ring),
      });
    const typed = () =>
      createFlash<AppEnv>({
        // @ts-expect-error — createKeyRingResolver's wrapper takes a request, not the env a ring option is handed
        ring: createKeyRingResolver<AppEnv>((env) => importKeyRing([env.FLASH_SECRET])),
      });
    expect(inferred).toThrow(new Error(UNWRAP));
    expect(typed).toThrow(new Error(UNWRAP));
  });

  it("cast past the type, throws at construction naming createFlash and the fix", () => {
    const wrapped = createKeyRingResolver<AppEnv>(() => ring) as unknown as KeyRingResolver<AppEnv>;
    expect(() => createFlash<AppEnv>({ ring: wrapped })).toThrow(new Error(UNWRAP));
  });
});

describe("ring — over the app's Bindings", () => {
  interface AppEnv {
    readonly FLASH_SECRET: string;
  }

  it("refuses a binding AppEnv does not declare at bun check, and takes one it does", () => {
    const missing = () =>
      createFlash<AppEnv>({
        // @ts-expect-error — `FLASH_SECRETS` is not a binding of AppEnv
        ring: (env) => importKeyRing([env.FLASH_SECRETS]),
      });
    const declared = () => createFlash<AppEnv>({ ring: (env) => importKeyRing([env.FLASH_SECRET]) });
    void [missing, declared];
  });
});

describe("ring — cast past its type to read the request context", () => {
  const HANDED_ENV = "this resolver is handed `env`, not the request context — rewrite `(c) => c.env.X` as `(env) => env.X`";
  const SECRET = "df7bc215d10b817ca5757fe2b023738f06d7ccb1de2f33087c06428643c8ee3b";
  // oxlint-disable-next-line typescript/no-explicit-any -- a 0.7.7 resolver typed against the context it is no longer handed
  type ContextResolver = (c: any) => ReturnType<typeof importKeyRing>;
  const unconverted: { name: string; resolve: ContextResolver }[] = [
    { name: "c.env", resolve: (c) => importKeyRing([c.env.FLASH_SECRET]) },
    { name: "c.get", resolve: (c) => importKeyRing([c.get("FLASH_SECRET")]) },
  ];

  for (const { name, resolve } of unconverted) {
    it(`answers the first request that sets a flash with the rewrite, for a ring reading ${name}`, async () => {
      const flash = createFlash({ ring: resolve as KeyRingResolver });
      const app = new Forge<{ FLASH_SECRET: string }>();
      app.setOnError((err) => new Response(err.message, { status: 500 }));
      mapHandler(app, "GET", "/", async (c) => {
        await flash.success(c, "saved");
        return new Response("ok");
      });
      const res = await app.request("/", {}, { FLASH_SECRET: SECRET });
      expect({ status: res.status, body: await res.text(), cookies: res.headers.getSetCookie() }).toEqual({
        status: 500,
        body: HANDED_ENV,
        cookies: [],
      });
    });
  }
});
