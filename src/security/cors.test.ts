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
  it("accepts a readonly pattern list", () => {
    const patterns: readonly string[] = Object.freeze(["https://example.com"]);
    expect(matchOrigin("https://example.com", patterns)).toBe(true);
  });

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

describe("cors origins resolver", () => {
  const ALLOWED = "https://app.example.com";

  function resolverApp(origins: Parameters<typeof cors<{ ORIGINS: string }>>[0]["origins"], credentials = false, errors: string[] = []) {
    const app = new Forge<{ ORIGINS: string }>();
    app.setOnError((err) => {
      errors.push(err.message);
      return new Response(null, { status: 500 });
    });
    app.use("*", cors({ origins, credentials }));
    mapHandler(app, "GET", "/test", () => new Response("ok"));
    return app;
  }

  it("hands the resolver the env alone, so an answer cannot be keyed on one request's host", () => {
    // @ts-expect-error -- the resolver is cached per env, so it is given no request to read
    const refused: Parameters<typeof resolverApp>[0] = (c: { url: URL }) => [c.url.origin];
    expect(typeof refused).toBe("function");
  });

  it("allows an origin the resolver returns, read from env", async () => {
    const app = resolverApp((env) => env.ORIGINS.split(","));
    const res = await app.request("/test", { headers: { Origin: ALLOWED } }, { ORIGINS: ALLOWED });
    expect({ acao: res.headers.get("Access-Control-Allow-Origin"), vary: res.headers.get("Vary") }).toEqual({ acao: ALLOWED, vary: "Origin" });
  });

  it("refuses an origin the resolver does not return", async () => {
    const app = resolverApp(async () => [ALLOWED]);
    const res = await app.request("/test", { headers: { Origin: "https://evil.com" } }, { ORIGINS: "" });
    expect({ acao: res.headers.get("Access-Control-Allow-Origin"), vary: res.headers.get("Vary") }).toEqual({ acao: null, vary: "Origin" });
  });

  it("sends Vary: Origin even when the resolved list is the wildcard", async () => {
    const app = resolverApp(() => ["*"]);
    const res = await app.request("/test", { headers: { Origin: ALLOWED } }, { ORIGINS: "" });
    expect({ acao: res.headers.get("Access-Control-Allow-Origin"), vary: res.headers.get("Vary") }).toEqual({ acao: "*", vary: "Origin" });
  });

  it("resolves once per env object", async () => {
    let calls = 0;
    const app = resolverApp(() => {
      calls++;
      return [ALLOWED];
    });
    const env = { ORIGINS: "" };
    await app.request("/test", { headers: { Origin: ALLOWED } }, env);
    await app.request("/test", { headers: { Origin: ALLOWED } }, env);
    expect(calls).toBe(1);
  });

  it("refuses a resolved wildcard with credentials at first resolution, as a 500", async () => {
    const app = resolverApp(() => ["*"], true);
    expect(() => cors({ origins: () => ["*"], credentials: true })).not.toThrow();
    const res = await app.request("/test", { headers: { Origin: ALLOWED } }, { ORIGINS: "" });
    expect(res.status).toBe(500);
  });

  function corsHeadersOf(res: Response) {
    return {
      status: res.status,
      acao: res.headers.get("Access-Control-Allow-Origin"),
      credentials: res.headers.get("Access-Control-Allow-Credentials"),
      vary: res.headers.get("Vary"),
    };
  }

  const resolverCases = [
    { name: "a sync resolver allows a listed origin", origins: () => [ALLOWED], origin: ALLOWED, acao: ALLOWED },
    { name: "an async resolver allows a listed origin", origins: async () => [ALLOWED], origin: ALLOWED, acao: ALLOWED },
    { name: "a sync resolver refuses an unlisted origin", origins: () => [ALLOWED], origin: "https://evil.com", acao: null },
    { name: "an async resolver refuses an unlisted origin", origins: async () => [ALLOWED], origin: "https://evil.com", acao: null },
    {
      name: "a resolved subdomain pattern allows a matching subdomain",
      origins: async () => ["https://*.example.com"],
      origin: "https://api.example.com",
      acao: "https://api.example.com",
    },
    {
      name: "a resolved subdomain pattern refuses the apex",
      origins: async () => ["https://*.example.com"],
      origin: "https://example.com",
      acao: null,
    },
  ];

  for (const { name, origins, origin, acao } of resolverCases) {
    it(name, async () => {
      const res = await resolverApp(origins).request("/test", { headers: { Origin: origin } }, { ORIGINS: "" });
      expect(corsHeadersOf(res)).toEqual({ status: 200, acao, credentials: null, vary: "Origin" });
    });
  }

  it("sends Vary: Origin on a request with no Origin header in resolver mode", async () => {
    const res = await resolverApp(() => [ALLOWED]).request("/test", {}, { ORIGINS: "" });
    expect(corsHeadersOf(res)).toEqual({ status: 200, acao: null, credentials: null, vary: "Origin" });
  });

  it("answers a preflight for a resolved origin with the full preflight header set", async () => {
    const res = await resolverApp(async () => [ALLOWED]).request(
      "/test",
      { method: "OPTIONS", headers: { Origin: ALLOWED, "Access-Control-Request-Method": "GET" } },
      { ORIGINS: "" },
    );
    expect({ status: res.status, headers: Object.fromEntries(res.headers) }).toEqual({
      status: 204,
      headers: {
        "access-control-allow-origin": ALLOWED,
        "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers": "Content-Type",
        "access-control-max-age": "86400",
        vary: "Origin",
      },
    });
  });

  it("refuses a preflight for an origin the resolver does not return, still varying on Origin", async () => {
    const res = await resolverApp(async () => [ALLOWED]).request(
      "/test",
      { method: "OPTIONS", headers: { Origin: "https://evil.com", "Access-Control-Request-Method": "GET" } },
      { ORIGINS: "" },
    );
    expect({ status: res.status, headers: Object.fromEntries(res.headers) }).toEqual({ status: 204, headers: { vary: "Origin" } });
  });

  it("resolves afresh for a new env object, and that env's list governs", async () => {
    let calls = 0;
    const app = resolverApp((env) => {
      calls++;
      return env.ORIGINS.split(",");
    });
    const first = await app.request("/test", { headers: { Origin: ALLOWED } }, { ORIGINS: ALLOWED });
    const second = await app.request("/test", { headers: { Origin: ALLOWED } }, { ORIGINS: "https://other.example.com" });
    expect({ first: corsHeadersOf(first).acao, second: corsHeadersOf(second).acao, calls }).toEqual({ first: ALLOWED, second: null, calls: 2 });
  });

  it("resolves once for two concurrent first requests under one env", async () => {
    let calls = 0;
    const app = resolverApp(async () => {
      calls++;
      await Promise.resolve();
      return [ALLOWED];
    });
    const env = { ORIGINS: "" };
    const responses = await Promise.all([
      app.request("/test", { headers: { Origin: ALLOWED } }, env),
      app.request("/test", { headers: { Origin: ALLOWED } }, env),
    ]);
    expect({ acao: responses.map((res) => corsHeadersOf(res).acao), calls }).toEqual({ acao: [ALLOWED, ALLOWED], calls: 1 });
  });

  it("answers 500 when the resolver rejects, then retries under the same env", async () => {
    let calls = 0;
    const errors: string[] = [];
    const app = resolverApp(
      async () => {
        calls++;
        if (calls === 1) throw new Error("config unavailable");
        return [ALLOWED];
      },
      false,
      errors,
    );
    const env = { ORIGINS: "" };
    const failed = await app.request("/test", { headers: { Origin: ALLOWED } }, env);
    const retried = await app.request("/test", { headers: { Origin: ALLOWED } }, env);
    expect({ failed: failed.status, retried: corsHeadersOf(retried), calls, errors }).toEqual({
      failed: 500,
      retried: { status: 200, acao: ALLOWED, credentials: null, vary: "Origin" },
      calls: 2,
      errors: ["config unavailable"],
    });
  });

  function staticWildcardRefusal(): string {
    try {
      cors({ origins: ["*"], credentials: true });
    } catch (err) {
      return (err as Error).message;
    }
    throw new Error("the static wildcard-with-credentials list was not refused");
  }

  it("keeps refusing a resolved wildcard with credentials on every request, with the construction-time error", async () => {
    const errors: string[] = [];
    const app = resolverApp(() => ["*"], true, errors);
    const env = { ORIGINS: "" };
    const first = await app.request("/test", { headers: { Origin: ALLOWED } }, env);
    const second = await app.request("/test", { headers: { Origin: ALLOWED } }, env);
    const refusal = staticWildcardRefusal();
    expect({ responses: [corsHeadersOf(first), corsHeadersOf(second)], errors }).toEqual({
      responses: [
        { status: 500, acao: null, credentials: null, vary: null },
        { status: 500, acao: null, credentials: null, vary: null },
      ],
      errors: [refusal, refusal],
    });
  });

  it("refuses a resolved list mixing an origin and the wildcard with credentials on a preflight", async () => {
    const errors: string[] = [];
    const res = await resolverApp(() => [ALLOWED, "*"], true, errors).request(
      "/test",
      { method: "OPTIONS", headers: { Origin: ALLOWED, "Access-Control-Request-Method": "GET" } },
      { ORIGINS: "" },
    );
    expect({ headers: corsHeadersOf(res), errors }).toEqual({
      headers: { status: 500, acao: null, credentials: null, vary: null },
      errors: [staticWildcardRefusal()],
    });
  });

  it("serves a resolved explicit list with credentials, echoing the origin", async () => {
    const res = await resolverApp(() => [ALLOWED], true).request("/test", { headers: { Origin: ALLOWED } }, { ORIGINS: "" });
    expect(corsHeadersOf(res)).toEqual({ status: 200, acao: ALLOWED, credentials: "true", vary: "Origin" });
  });
});
