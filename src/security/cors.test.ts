import { describe, expect, it } from "bun:test";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
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
