import { describe, expect, it } from "bun:test";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
import { makeSecurityHeaders, mergeSecurityHeaders } from "./headers";

async function headersFor(middleware: ReturnType<typeof makeSecurityHeaders>) {
  const app = new Forge();
  app.use("*", middleware);
  mapHandler(app, "GET", "/", () => new Response("ok"));
  const res = await app.request("/");
  return res.headers;
}

describe("makeSecurityHeaders — defaults", () => {
  it("sets strict-transport-security with default max-age", async () => {
    const headers = await headersFor(makeSecurityHeaders());
    expect(headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("sets content-security-policy", async () => {
    const headers = await headersFor(makeSecurityHeaders());
    const csp = headers.get("content-security-policy");
    expect(csp).not.toBeNull();
    expect(csp).toContain("default-src 'self'");
  });

  it("includes a nonce in the CSP script-src", async () => {
    const headers = await headersFor(makeSecurityHeaders());
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("'nonce-");
  });

  it("sets referrer-policy", async () => {
    const headers = await headersFor(makeSecurityHeaders());
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("sets x-content-type-options", async () => {
    const headers = await headersFor(makeSecurityHeaders());
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not include any hashes or external origins by default", async () => {
    const headers = await headersFor(makeSecurityHeaders());
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("sha256-");
    expect(csp).not.toContain("http");
  });
});

describe("makeSecurityHeaders — custom options", () => {
  it("overrides hstsMaxAge", async () => {
    const headers = await headersFor(makeSecurityHeaders({ hstsMaxAge: 31536000 }));
    expect(headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
  });

  it("overrides scriptSrc", async () => {
    const headers = await headersFor(makeSecurityHeaders({ scriptSrc: ["'self'", "https://cdn.example.com"] }));
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("cdn.example.com");
  });

  it("overrides connectSrc", async () => {
    const headers = await headersFor(makeSecurityHeaders({ connectSrc: ["'self'", "https://api.example.com"] }));
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("api.example.com");
  });

  it("overrides frameSrc", async () => {
    const headers = await headersFor(makeSecurityHeaders({ frameSrc: ["'self'", "https://embed.example.com"] }));
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("embed.example.com");
  });
});

describe("makeSecurityHeaders — directive validation", () => {
  it("throws when a custom directive contains an empty string", () => {
    expect(() => makeSecurityHeaders({ scriptSrc: ["'self'", ""] })).toThrow();
  });

  it("throws on a whitespace-only connect-src entry", () => {
    expect(() => makeSecurityHeaders({ connectSrc: ["   "] })).toThrow();
  });
});

describe("makeSecurityHeaders — permissions-policy", () => {
  it("defaults to fail-closed for all four features", async () => {
    const headers = await headersFor(makeSecurityHeaders());
    expect(headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=(), payment=()");
  });

  it("enables microphone with self keyword", async () => {
    const headers = await headersFor(makeSecurityHeaders({ permissionsPolicy: { microphone: ["self"] } }));
    const policy = headers.get("permissions-policy") ?? "";
    expect(policy).toContain("microphone=(self)");
    expect(policy).toContain("camera=()");
  });

  it("quotes non-keyword origins in the allowlist", async () => {
    const headers = await headersFor(makeSecurityHeaders({ permissionsPolicy: { microphone: ["https://example.com"] } }));
    const policy = headers.get("permissions-policy") ?? "";
    expect(policy).toContain('microphone=("https://example.com")');
  });
});

describe("mergeSecurityHeaders — permissionsPolicy", () => {
  it("merges features independently, extra overrides base per-feature", () => {
    const base = { permissionsPolicy: { camera: ["self"] as string[] } };
    const merged = mergeSecurityHeaders(base, { permissionsPolicy: { microphone: ["self"] } });
    expect(merged.permissionsPolicy?.camera).toEqual(["self"]);
    expect(merged.permissionsPolicy?.microphone).toEqual(["self"]);
  });

  it("does not mutate base permissionsPolicy", () => {
    const base = { permissionsPolicy: { camera: ["self"] as string[] } };
    mergeSecurityHeaders(base, { permissionsPolicy: { camera: ["*"] } });
    expect(base.permissionsPolicy?.camera).toEqual(["self"]);
  });
});

describe("mergeSecurityHeaders", () => {
  it("concatenates sources onto a single directive", () => {
    const base = { scriptSrc: ["'self'"], connectSrc: ["'self'"] };
    const merged = mergeSecurityHeaders(base, { scriptSrc: ["'sha256-abc='"] });
    expect(merged.scriptSrc).toEqual(["'self'", "'sha256-abc='"]);
  });

  it("leaves untouched directives intact", () => {
    const base = { scriptSrc: ["'self'"], connectSrc: ["'self'", "https://api.example.com"] };
    const merged = mergeSecurityHeaders(base, { scriptSrc: ["'sha256-abc='"] });
    expect(merged.connectSrc).toEqual(["'self'", "https://api.example.com"]);
  });

  it("returns base unchanged for empty extra", () => {
    const base = { scriptSrc: ["'self'"], connectSrc: ["'self'"], hstsMaxAge: 100 };
    const merged = mergeSecurityHeaders(base, {});
    expect(merged).toEqual({ scriptSrc: ["'self'"], connectSrc: ["'self'"], hstsMaxAge: 100 });
  });

  it("does not mutate base", () => {
    const base = { scriptSrc: ["'self'"] };
    mergeSecurityHeaders(base, { scriptSrc: ["'sha256-abc='"] });
    expect(base.scriptSrc).toEqual(["'self'"]);
  });

  it("overrides hstsMaxAge when provided", () => {
    const base = { scriptSrc: ["'self'"], hstsMaxAge: 100 };
    const merged = mergeSecurityHeaders(base, { hstsMaxAge: 200 });
    expect(merged.hstsMaxAge).toBe(200);
  });
});
