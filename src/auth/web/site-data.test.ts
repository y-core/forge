import { describe, expect, it } from "bun:test";

import { Forge } from "../../app/forge-app";
import { setPendingHeader } from "../../context/pending-headers";
import { getAppContext } from "../../context/types";
import { mapHandler } from "../../testing/route";
import { clearSiteDataOwedCookie, hasSiteDataOwedCookie, markSiteDataOwedCookie } from "./site-data";

const MARKED = "__Host-auth-site-data-owed=MQ==; HttpOnly; Max-Age=300; Path=/; SameSite=Lax; Secure";
const CLEARED = "__Host-auth-site-data-owed=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax; Secure";

/** An app answering whether the request carries the mark, after `queue` has run on it. */
function app(queue: (c: ReturnType<typeof getAppContext>) => Promise<void> = async () => undefined): Forge {
  const forge = new Forge();
  mapHandler(forge, "GET", "/", async (context) => {
    const c = getAppContext(context);
    await queue(c);
    return Response.json({ owed: await hasSiteDataOwedCookie(c) });
  });
  return forge;
}

async function owedWith(cookie: string | undefined): Promise<boolean> {
  const res = await app().request("/", cookie === undefined ? {} : { headers: { cookie } });
  return ((await res.json()) as { owed: boolean }).owed;
}

describe("hasSiteDataOwedCookie", () => {
  for (const { input, expected } of [
    { input: undefined, expected: false },
    { input: "__Host-auth-site-data-owed=MQ==", expected: true },
    { input: "theme=dark; __Host-auth-site-data-owed=MQ==; __Host-session=abc", expected: true },
    { input: "theme=dark; __Host-session=abc", expected: false },
    // base64 of "0": a well-formed payload carrying another value
    { input: "__Host-auth-site-data-owed=MA==", expected: false },
    // base64 of "11"
    { input: "__Host-auth-site-data-owed=MTE=", expected: false },
    // the bare value, never base64-encoded on the wire
    { input: "__Host-auth-site-data-owed=1", expected: false },
    { input: "__Host-auth-site-data-owed=%%%not-base64", expected: false },
    { input: "__Host-auth-site-data-owed=", expected: false },
    // the right payload under a name without the __Host- prefix, as a subdomain could plant
    { input: "auth-site-data-owed=MQ==", expected: false },
  ]) {
    it(`answers ${expected} for ${input === undefined ? "a request with no Cookie header" : `Cookie: ${input}`}`, async () => {
      expect(await owedWith(input)).toBe(expected);
    });
  }
});

describe("markSiteDataOwedCookie", () => {
  it("sets the mark as a __Host- cookie living five minutes, HttpOnly, Secure and SameSite=Lax", async () => {
    const res = await app(markSiteDataOwedCookie).request("/");
    expect(res.headers.getSetCookie()).toEqual([MARKED]);
  });

  it("queues beside a cookie already queued this request rather than replacing it", async () => {
    const res = await app(async (c) => {
      setPendingHeader(c, "set-cookie", "theme=dark; Path=/", { append: true });
      await markSiteDataOwedCookie(c);
    }).request("/");
    expect(res.headers.getSetCookie()).toEqual(["theme=dark; Path=/", MARKED]);
  });

  it("writes a value the next request reads back as owed", async () => {
    const res = await app(markSiteDataOwedCookie).request("/");
    const sent = res.headers.getSetCookie()[0]?.split(";")[0];
    expect(await owedWith(sent)).toBe(true);
  });
});

describe("clearSiteDataOwedCookie", () => {
  it("expires the mark at once on the same name, path and attributes", async () => {
    const res = await app(clearSiteDataOwedCookie).request("/", { headers: { cookie: "__Host-auth-site-data-owed=MQ==" } });
    expect(res.headers.getSetCookie()).toEqual([CLEARED]);
  });

  it("queues beside a cookie already queued this request rather than replacing it", async () => {
    const res = await app(async (c) => {
      setPendingHeader(c, "set-cookie", "theme=dark; Path=/", { append: true });
      await clearSiteDataOwedCookie(c);
    }).request("/");
    expect(res.headers.getSetCookie()).toEqual(["theme=dark; Path=/", CLEARED]);
  });

  it("writes a value the next request reads back as not owed", async () => {
    const res = await app(clearSiteDataOwedCookie).request("/");
    const sent = res.headers.getSetCookie()[0]?.split(";")[0];
    expect(await owedWith(sent)).toBe(false);
  });
});
