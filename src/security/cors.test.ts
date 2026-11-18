import { describe, expect, it } from "bun:test";

import { Forge } from "../app/forge-app";
import { mapHandler } from "../testing/route";
import { cors, matchOrigin } from "./cors";

function makeApp(options: Parameters<typeof cors>[0]) {
  const app = new Forge();
  app.use("*", cors(options));
  mapHandler(app, "GET", "/test", () => new Response("ok"));
  mapHandler(app, "POST", "/test", () => new Response("ok"));
  return app;
}

describe("matchOrigin", () => {
  it("returns true for an exact match", () => {
    expect(matchOrigin("https://example.com", ["https://example.com"])).toBe(true);
  });

  it("returns false for a non-matching exact origin", () => {
    expect(matchOrigin("https://evil.com", ["https://example.com"])).toBe(false);
  });

  it("returns true for a subdomain matching a wildcard pattern", () => {
    expect(matchOrigin("https://api.example.com", ["https://*.example.com"])).toBe(true);
  });

  it("returns false for a non-matching subdomain pattern", () => {
    expect(matchOrigin("https://evil.com", ["https://*.example.com"])).toBe(false);
  });

  it("returns false for the apex domain against a subdomain pattern", () => {
    expect(matchOrigin("https://example.com", ["https://*.example.com"])).toBe(false);
  });

  it("returns false when scheme does not match the pattern", () => {
    expect(matchOrigin("http://api.example.com", ["https://*.example.com"])).toBe(false);
  });

  it("returns false for evil-example.com that looks like a subdomain", () => {
    expect(matchOrigin("https://evil-example.com", ["https://*.example.com"])).toBe(false);
  });

  it("returns false for a nested subdomain (two labels) against a single-wildcard pattern", () => {
    expect(matchOrigin("https://sub.api.example.com", ["https://*.example.com"])).toBe(false);
  });

  describe("wildcard delimiter confusion", () => {
    it("returns false when a path separator precedes the trusted suffix", () => {
      expect(matchOrigin("https://a/b.example.com", ["https://*.example.com"])).toBe(false);
    });

    it("returns false when userinfo precedes the trusted suffix", () => {
      expect(matchOrigin("https://evil.com@attacker.example.com", ["https://*.example.com"])).toBe(false);
    });

    it("returns false when a port separator precedes the trusted suffix", () => {
      expect(matchOrigin("https://evil.com:8080.example.com", ["https://*.example.com"])).toBe(false);
    });

    it("returns false when a query delimiter precedes the trusted suffix", () => {
      expect(matchOrigin("https://evil.com?x.example.com", ["https://*.example.com"])).toBe(false);
    });

    it("returns false when a fragment delimiter precedes the trusted suffix", () => {
      expect(matchOrigin("https://evil.com#x.example.com", ["https://*.example.com"])).toBe(false);
    });

    it("still matches a legitimate single-label subdomain", () => {
      expect(matchOrigin("https://api.example.com", ["https://*.example.com"])).toBe(true);
    });

    it("escapes `?` rather than making the previous character optional", () => {
      // The `*` is what reaches the regex branch; the `?` is the adversarial part of the pattern.
      expect(matchOrigin("https://x.a.example.com", ["https://*.ab?.example.com"])).toBe(false);
      expect(matchOrigin("https://x.ab.example.com", ["https://*.ab?.example.com"])).toBe(false);
    });
  });
});

describe("cors factory", () => {
  it("throws synchronously when credentials:true combined with wildcard origin", () => {
    expect(() => cors({ origins: ["*"], credentials: true })).toThrow('cors: cannot use wildcard origin "*" with credentials: true');
  });

  it("returns 204 with CORS headers on a preflight for an allowed origin", async () => {
    const app = makeApp({ origins: ["https://example.com"] });
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com", "Access-Control-Request-Method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("returns 204 with no CORS headers on a preflight for a disallowed origin", async () => {
    const app = makeApp({ origins: ["https://example.com"] });
    const res = await app.request("/test", { method: "OPTIONS", headers: { Origin: "https://evil.com", "Access-Control-Request-Method": "GET" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(null);
  });

  it("echoes the specific allowed origin and Vary on an actual request", async () => {
    const app = makeApp({ origins: ["https://example.com"] });
    const res = await app.request("/test", { method: "GET", headers: { Origin: "https://example.com" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("does not set Access-Control-Allow-Origin for a disallowed origin", async () => {
    const app = makeApp({ origins: ["https://example.com"] });
    const res = await app.request("/test", { method: "GET", headers: { Origin: "https://evil.com" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(null);
  });

  it("emits wildcard Access-Control-Allow-Origin when origins is ['*'] and credentials is false", async () => {
    const app = makeApp({ origins: ["*"] });
    const res = await app.request("/test", { method: "GET", headers: { Origin: "https://anyone.example.com" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("echoes specific origin and sets credentials header for credentialed requests", async () => {
    const app = makeApp({ origins: ["https://example.com"], credentials: true });
    const res = await app.request("/test", { method: "GET", headers: { Origin: "https://example.com" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("matches a subdomain pattern on an actual request", async () => {
    const app = makeApp({ origins: ["https://*.example.com"] });
    const res = await app.request("/test", { method: "GET", headers: { Origin: "https://api.example.com" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://api.example.com");
  });

  it("uses custom methods on preflight", async () => {
    const app = makeApp({ origins: ["https://example.com"], methods: ["GET", "POST"] });
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com", "Access-Control-Request-Method": "POST" },
    });
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST");
  });
});

describe("cors response rebuild", () => {
  it("preserves status and body while injecting CORS headers", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["https://example.com"] }));
    mapHandler(app, "GET", "/created", () => new Response("payload", { status: 201 }));
    const res = await app.request("/created", { method: "GET", headers: { Origin: "https://example.com" } });
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("payload");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com");
  });

  it("does not alter the response for a disallowed origin", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["https://example.com"] }));
    mapHandler(app, "GET", "/x", () => new Response("body", { status: 200 }));
    const res = await app.request("/x", { method: "GET", headers: { Origin: "https://evil.com" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("body");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("appendVary (via cors middleware)", () => {
  it("sets Vary: Origin when the downstream response has no Vary header", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["https://example.com"] }));
    mapHandler(app, "GET", "/no-vary", () => new Response("ok"));
    const res = await app.request("/no-vary", { method: "GET", headers: { Origin: "https://example.com" } });
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("appends Origin to an existing Vary value without dropping downstream tokens", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["https://example.com"] }));
    mapHandler(app, "GET", "/with-vary", () => new Response("ok", { headers: { Vary: "Accept-Encoding" } }));
    const res = await app.request("/with-vary", { method: "GET", headers: { Origin: "https://example.com" } });
    expect(res.headers.get("Vary")).toBe("Accept-Encoding, Origin");
  });

  it("does not duplicate Origin when downstream already sends Vary: Origin", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["https://example.com"] }));
    mapHandler(app, "GET", "/already-origin", () => new Response("ok", { headers: { Vary: "Origin" } }));
    const res = await app.request("/already-origin", { method: "GET", headers: { Origin: "https://example.com" } });
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("leaves Vary: * untouched and does not append Origin", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["https://example.com"] }));
    mapHandler(app, "GET", "/vary-star", () => new Response("ok", { headers: { Vary: "*" } }));
    const res = await app.request("/vary-star", { method: "GET", headers: { Origin: "https://example.com" } });
    expect(res.headers.get("Vary")).toBe("*");
  });

  it("marks Vary: Origin on a refused origin, so a cache cannot replay the refusal to an allowed one", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["https://example.com"] }));
    mapHandler(app, "GET", "/disallowed", () => new Response("ok", { headers: { Vary: "Accept-Encoding" } }));
    const res = await app.request("/disallowed", { method: "GET", headers: { Origin: "https://evil.com" } });
    expect(res.headers.get("Vary")).toBe("Accept-Encoding, Origin");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("marks Vary: Origin on a request that sends no Origin at all", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["https://example.com"] }));
    mapHandler(app, "GET", "/no-origin", () => new Response("ok"));
    const res = await app.request("/no-origin", { method: "GET" });
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("marks Vary: Origin on a refused preflight", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["https://example.com"] }));
    mapHandler(app, "GET", "/preflight", () => new Response("ok"));
    const res = await app.request("/preflight", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.com", "Access-Control-Request-Method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Vary")).toBe("Origin");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("dedupes a lowercase downstream `origin` token on the refused path", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["https://example.com"] }));
    mapHandler(app, "GET", "/lower", () => new Response("ok", { headers: { Vary: "origin" } }));
    const res = await app.request("/lower", { method: "GET", headers: { Origin: "https://evil.com" } });
    expect(res.headers.get("Vary")).toBe("origin");
  });

  it("leaves Vary: * untouched on the refused path too", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["https://example.com"] }));
    mapHandler(app, "GET", "/refused-star", () => new Response("ok", { headers: { Vary: "*" } }));
    const res = await app.request("/refused-star", { method: "GET", headers: { Origin: "https://evil.com" } });
    expect(res.headers.get("Vary")).toBe("*");
  });

  it("omits Vary entirely when the allowlist is `*` without credentials", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["*"] }));
    mapHandler(app, "GET", "/star", () => new Response("ok"));
    const res = await app.request("/star", { method: "GET", headers: { Origin: "https://anywhere.example" } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Vary")).toBeNull();
  });

  it("leaves a downstream Vary untouched when the allowlist is `*` without credentials", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: ["*"] }));
    mapHandler(app, "GET", "/star-vary", () => new Response("ok", { headers: { Vary: "Accept-Encoding" } }));
    const res = await app.request("/star-vary", { method: "GET", headers: { Origin: "https://anywhere.example" } });
    expect(res.headers.get("Vary")).toBe("Accept-Encoding");
  });
});

describe("cors exposedHeaders", () => {
  const ORIGIN = "https://example.com";

  it("sends the joined names on an allowed actual request", async () => {
    const app = makeApp({ origins: [ORIGIN], exposedHeaders: ["ETag", "X-Total-Count"] });
    const res = await app.request("/test", { method: "GET", headers: { Origin: ORIGIN } });
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("ETag, X-Total-Count");
  });

  it("sends the names beside Access-Control-Allow-Credentials when credentials is true", async () => {
    const app = makeApp({ origins: [ORIGIN], credentials: true, exposedHeaders: ["ETag"] });
    const res = await app.request("/test", { method: "GET", headers: { Origin: ORIGIN } });
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("ETag");
  });

  it("sends the names under a wildcard origin without credentials", async () => {
    const app = makeApp({ origins: ["*"], exposedHeaders: ["ETag"] });
    const res = await app.request("/test", { method: "GET", headers: { Origin: "https://anyone.example" } });
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("ETag");
  });

  it("sends a wildcard name when credentials is off", async () => {
    const app = makeApp({ origins: [ORIGIN], exposedHeaders: ["*"] });
    const res = await app.request("/test", { method: "GET", headers: { Origin: ORIGIN } });
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("*");
  });

  it("never sends the header on a preflight for an allowed origin", async () => {
    const app = makeApp({ origins: [ORIGIN], exposedHeaders: ["ETag"] });
    const res = await app.request("/test", { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Expose-Headers")).toBeNull();
  });

  it("sends the header on an actual OPTIONS request, which carries no Access-Control-Request-Method", async () => {
    const app = new Forge();
    app.use("*", cors({ origins: [ORIGIN], exposedHeaders: ["ETag"] }));
    mapHandler(app, "OPTIONS", "/test", () => new Response("options"));
    const res = await app.request("/test", { method: "OPTIONS", headers: { Origin: ORIGIN } });
    expect([res.status, await res.text(), res.headers.get("Access-Control-Expose-Headers")]).toEqual([200, "options", "ETag"]);
  });

  it("never sends the header to a disallowed origin", async () => {
    const app = makeApp({ origins: [ORIGIN], exposedHeaders: ["ETag"] });
    const res = await app.request("/test", { method: "GET", headers: { Origin: "https://evil.com" } });
    expect(res.headers.get("Access-Control-Expose-Headers")).toBeNull();
  });

  it("never sends the header on a request without an Origin", async () => {
    const app = makeApp({ origins: [ORIGIN], exposedHeaders: ["ETag"] });
    const res = await app.request("/test", { method: "GET" });
    expect(res.headers.get("Access-Control-Expose-Headers")).toBeNull();
  });

  it("sends no header when the option is omitted", async () => {
    const app = makeApp({ origins: [ORIGIN] });
    const res = await app.request("/test", { method: "GET", headers: { Origin: ORIGIN } });
    expect(res.headers.get("Access-Control-Expose-Headers")).toBeNull();
  });

  it("sends no header when the option is empty", async () => {
    const app = makeApp({ origins: [ORIGIN], exposedHeaders: [] });
    const res = await app.request("/test", { method: "GET", headers: { Origin: ORIGIN } });
    expect(res.headers.get("Access-Control-Expose-Headers")).toBeNull();
  });

  it("throws synchronously when a wildcard name is combined with credentials", () => {
    expect(() => cors({ origins: [ORIGIN], credentials: true, exposedHeaders: ["*"] })).toThrow(
      'cors: cannot use wildcard exposedHeaders "*" with credentials: true — a credentialed response reads "*" as a header named "*", so it would expose nothing.',
    );
  });

  for (const name of ["", "X Total", "ETag,Link", "X-A\r\nSet-Cookie: a=b", "Über"]) {
    it(`throws synchronously for the non-token name ${JSON.stringify(name)}`, () => {
      expect(() => cors({ origins: [ORIGIN], exposedHeaders: [name] })).toThrow(
        `cors: exposedHeaders entry ${JSON.stringify(name)} is not a header name`,
      );
    });
  }

  it("throws for a non-token name listed after a valid one", () => {
    expect(() => cors({ origins: [ORIGIN], exposedHeaders: ["ETag", "X Total"] })).toThrow(
      `cors: exposedHeaders entry "X Total" is not a header name`,
    );
  });

  it("accepts every tchar class in a name", () => {
    expect(() => cors({ origins: [ORIGIN], exposedHeaders: ["X-Custom_1.v2", "!#$%&'*+^`|~"] })).not.toThrow();
  });
});

describe("cors allowedHeaders", () => {
  const ORIGIN = "https://example.com";

  for (const name of ["", "X Total", "Content-Type,Authorization", "X-A\r\nSet-Cookie: a=b", "Über"]) {
    it(`throws synchronously for the non-token name ${JSON.stringify(name)}`, () => {
      expect(() => cors({ origins: [ORIGIN], allowedHeaders: [name] })).toThrow(
        `cors: allowedHeaders entry ${JSON.stringify(name)} is not a header name — an RFC 9110 token has no whitespace, comma or control character, and one that did would split or corrupt Access-Control-Allow-Headers.`,
      );
    });
  }

  it("throws for a non-token name listed after a valid one", () => {
    expect(() => cors({ origins: [ORIGIN], allowedHeaders: ["Content-Type", "X Total"] })).toThrow(
      `cors: allowedHeaders entry "X Total" is not a header name`,
    );
  });

  it("accepts valid tokens and sends them on the preflight", async () => {
    const app = makeApp({ origins: [ORIGIN], allowedHeaders: ["Content-Type", "X-Custom_1.v2", "!#$%&'*+^`|~"] });
    const res = await app.request("/test", { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" } });
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, X-Custom_1.v2, !#$%&'*+^`|~");
  });
});
