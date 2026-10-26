import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import { importKeyRing } from "../../crypto/keyring/ring";
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
    const flash = createFlash({ ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await flash.set(c, [{ type: "info", text: "kid" }]);
      return new Response("ok");
    });
    const cookieValue = extractCookieValue((await app.request("/")).headers.get("Set-Cookie"));
    expect(cookieValue?.split(".").at(-2)).toBe(ring.activeKeyId);
  });
});

describe("set", () => {
  it("writes a signed Set-Cookie header with correct attributes", async () => {
    const flash = createFlash({ ring });
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
    const flash = createFlash({ ring });
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
    const flash = createFlash({ ring });

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
    const flash = createFlash({ ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => Response.json(await flash.get(c)));
    const res = await app.request("/");
    expect(await res.json()).toEqual([]);
  });

  it("returns empty array for a tampered cookie value", async () => {
    const flash = createFlash({ ring });

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
    const flash = createFlash({ ring, maxAge: 1 });

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
    const flash = createFlash({ ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => Response.json(await flash.get(c)));
    const res = await app.request("/", { headers: { Cookie: "other=1" } });
    expect(res.headers.get("Set-Cookie")).toBeNull();
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
      const flash = createFlash({ ring });

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
    const flash = createFlash({ ring });
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
    const flash = createFlash({ ring });
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
    const flash = createFlash({ ring });
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
    const flash = createFlash({ ring });
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
    const flash = createFlash({ ring });
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
    const flash = createFlash({ ring });
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
    const flash = createFlash({ ring });
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
    const flash = createFlash({ ring });
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
    const flash = createFlash({ ring });
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
    const flash = createFlash({ ring });
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
    const flash = createFlash({ ring });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => {
      await expect(flash.info(c, "a".repeat(4000))).rejects.toThrow(/at most 4096 bytes/);
      return new Response("ok");
    });
    expect((await app.request("/")).status).toBe(200);
  });
});
