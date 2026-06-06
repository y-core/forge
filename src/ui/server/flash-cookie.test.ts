import { describe, expect, it } from "bun:test";
import { Forge } from "../../app/forge-app";
import { mapHandler } from "../../app/route-test-helper";
import type { FlashMessage } from "./flash";
import { createFlash } from "./flash-cookie";

const SECRET = "a".repeat(32);

function extractCookieValue(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/flash=([^;]+)/);
  return match ? match[1]! : null;
}

describe("createFlash", () => {
  it("throws when a secret is shorter than 32 characters", () => {
    expect(() => createFlash({ secrets: ["too-short"] })).toThrow();
  });
});

describe("set", () => {
  it("writes a signed Set-Cookie header with correct attributes", async () => {
    const flash = createFlash({ secrets: [SECRET] });
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
    const flash = createFlash({ secrets: [SECRET] });
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
    const flash = createFlash({ secrets: [SECRET] });

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
    const flash = createFlash({ secrets: [SECRET] });
    const app = new Forge();
    mapHandler(app, "GET", "/", async (c) => Response.json(await flash.get(c)));
    const res = await app.request("/");
    expect(await res.json()).toEqual([]);
  });

  it("returns empty array for a tampered cookie value", async () => {
    const flash = createFlash({ secrets: [SECRET] });

    const setApp = new Forge();
    mapHandler(setApp, "GET", "/", async (c) => {
      await flash.set(c, [{ type: "success", text: "legit" }]);
      return new Response("ok");
    });
    const setRes = await setApp.request("/");
    const cookieValue = extractCookieValue(setRes.headers.get("Set-Cookie"));
    expect(cookieValue).not.toBeNull();

    const tampered = cookieValue!.slice(0, -1) + (cookieValue!.endsWith("x") ? "y" : "x");

    const getApp = new Forge();
    mapHandler(getApp, "GET", "/", async (c) => Response.json(await flash.get(c)));
    const getRes = await getApp.request("/", { headers: { Cookie: `flash=${tampered}` } });
    expect(await getRes.json()).toEqual([]);
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
      const flash = createFlash({ secrets: [SECRET] });

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
