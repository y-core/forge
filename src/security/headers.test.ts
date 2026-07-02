import { describe, expect, it } from "bun:test";
import { Forge } from "../app/forge-app";
import { mapHandler } from "../app/route-test-helper";
import { applySecurityHeaders, createSecurityHeaders, getNonce, mergeSecurityHeaders } from "./headers";
import { NONCE } from "./nonce";
import type { SecurityHeadersOptions } from "./types";

async function headersFor(middleware: ReturnType<typeof createSecurityHeaders>) {
  const app = new Forge();
  app.use("*", middleware);
  mapHandler(app, "GET", "/", () => new Response("ok"));
  const res = await app.request("/");
  return res.headers;
}

describe("createSecurityHeaders — defaults", () => {
  it("sets strict-transport-security with default max-age", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("sets content-security-policy", async () => {
    const headers = await headersFor(createSecurityHeaders());
    const csp = headers.get("content-security-policy");
    expect(csp).not.toBeNull();
    expect(csp).toContain("default-src 'self'");
  });

  it("includes a nonce in the CSP script-src", async () => {
    const headers = await headersFor(createSecurityHeaders());
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("'nonce-");
  });

  it("sets referrer-policy", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("sets x-content-type-options", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not include any hashes or external origins by default", async () => {
    const headers = await headersFor(createSecurityHeaders());
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("sha256-");
    expect(csp).not.toContain("http");
  });

  it("sets cross-origin-opener-policy to same-origin by default", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("sets cross-origin-resource-policy to same-origin by default", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("does not set cross-origin-embedder-policy by default (opt-in only)", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("cross-origin-embedder-policy")).toBeNull();
  });
});

describe("createSecurityHeaders — custom options", () => {
  it("overrides hstsMaxAge", async () => {
    const headers = await headersFor(createSecurityHeaders({ hstsMaxAge: 31536000 }));
    expect(headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
  });

  it("overrides scriptSrc", async () => {
    const headers = await headersFor(createSecurityHeaders({ scriptSrc: ["'self'", "https://cdn.example.com"] }));
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("cdn.example.com");
  });

  it("overrides connectSrc", async () => {
    const headers = await headersFor(createSecurityHeaders({ connectSrc: ["'self'", "https://api.example.com"] }));
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("api.example.com");
  });

  it("overrides frameSrc", async () => {
    const headers = await headersFor(createSecurityHeaders({ frameSrc: ["'self'", "https://embed.example.com"] }));
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("embed.example.com");
  });

  it("overrides cross-origin-opener-policy for popup flows", async () => {
    const headers = await headersFor(createSecurityHeaders({ crossOriginOpenerPolicy: "same-origin-allow-popups" }));
    expect(headers.get("cross-origin-opener-policy")).toBe("same-origin-allow-popups");
  });

  it("overrides cross-origin-resource-policy for embeddable resources", async () => {
    const headers = await headersFor(createSecurityHeaders({ crossOriginResourcePolicy: "cross-origin" }));
    expect(headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });

  it("emits cross-origin-embedder-policy only when opted in", async () => {
    const headers = await headersFor(createSecurityHeaders({ crossOriginEmbedderPolicy: "require-corp" }));
    expect(headers.get("cross-origin-embedder-policy")).toBe("require-corp");
  });
});

describe("createSecurityHeaders — directive validation", () => {
  it("throws when a custom directive contains an empty string", () => {
    expect(() => createSecurityHeaders({ scriptSrc: ["'self'", ""] })).toThrow();
  });

  it("throws on a whitespace-only connect-src entry", () => {
    expect(() => createSecurityHeaders({ connectSrc: ["   "] })).toThrow();
  });
});

describe("getNonce", () => {
  it("returns exactly the empty string when createSecurityHeaders did not run", async () => {
    let observed: string | undefined;
    const app = new Forge();
    mapHandler(app, "GET", "/", (context) => {
      observed = getNonce(context);
      return new Response("ok");
    });
    await app.request("/");
    expect(observed).toBe("");
  });

  it("is stable within a request and matches the CSP header", async () => {
    let observed = "";
    let observedAgain = "";
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    mapHandler(app, "GET", "/", (context) => {
      observed = getNonce(context);
      observedAgain = getNonce(context);
      return new Response("ok");
    });
    const res = await app.request("/");
    expect(observed).not.toBe("");
    expect(observed).toBe(observedAgain);
    expect(res.headers.get("content-security-policy")).toContain(`'nonce-${observed}'`);
  });

  it("differs across requests", async () => {
    const seen: string[] = [];
    const app = new Forge();
    app.use("*", createSecurityHeaders());
    mapHandler(app, "GET", "/", (context) => {
      seen.push(getNonce(context));
      return new Response("ok");
    });
    await app.request("/");
    await app.request("/");
    expect(seen[0]).not.toBe(seen[1]);
  });
});

describe("applySecurityHeaders", () => {
  it("embeds an explicit nonce and renders the exact default CSP", () => {
    const hardened = applySecurityHeaders(new Response("oops", { status: 500 }), { nonce: "test-nonce-abc" });
    expect(hardened.headers.get("content-security-policy")).toBe(
      "default-src 'self'; script-src 'self' 'nonce-test-nonce-abc'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; frame-src 'self'; object-src 'none'; base-uri 'self'; upgrade-insecure-requests",
    );
  });

  it("mints a fresh base64url nonce when options.nonce is omitted", () => {
    const hardened = applySecurityHeaders(new Response("ok"));
    const csp = hardened.headers.get("content-security-policy") ?? "";
    const match = csp.match(/'nonce-([A-Za-z0-9_-]{22})'/);
    expect(match).not.toBeNull();
  });

  it("mints distinct nonces across calls", () => {
    const extract = (r: Response) => (r.headers.get("content-security-policy") ?? "").match(/'nonce-([A-Za-z0-9_-]+)'/)?.[1];
    const first = extract(applySecurityHeaders(new Response("a")));
    const second = extract(applySecurityHeaders(new Response("b")));
    expect(first).not.toBe(second);
  });

  it("combines header options with an explicit nonce", () => {
    const hardened = applySecurityHeaders(new Response("ok"), {
      scriptSrc: ["'self'", NONCE, "https://cdn.example.com"],
      hstsMaxAge: 31536000,
      nonce: "fixed",
    });
    const csp = hardened.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self' 'nonce-fixed' https://cdn.example.com");
    expect(hardened.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
  });

  it("preserves status, statusText, body, and pre-existing headers", async () => {
    const original = new Response("teapot body", { status: 418, statusText: "I'm a teapot", headers: { "x-custom": "kept" } });
    const hardened = applySecurityHeaders(original, { nonce: "n" });
    expect(hardened.status).toBe(418);
    expect(hardened.statusText).toBe("I'm a teapot");
    expect(hardened.headers.get("x-custom")).toBe("kept");
    expect(hardened.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await hardened.text()).toBe("teapot body");
  });
});

describe("createSecurityHeaders — permissions-policy", () => {
  it("defaults to fail-closed for all four features", async () => {
    const headers = await headersFor(createSecurityHeaders());
    expect(headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=(), payment=()");
  });

  it("enables microphone with self keyword", async () => {
    const headers = await headersFor(createSecurityHeaders({ permissionsPolicy: { microphone: ["self"] } }));
    const policy = headers.get("permissions-policy") ?? "";
    expect(policy).toContain("microphone=(self)");
    expect(policy).toContain("camera=()");
  });

  it("quotes non-keyword origins in the allowlist", async () => {
    const headers = await headersFor(createSecurityHeaders({ permissionsPolicy: { microphone: ["https://example.com"] } }));
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

  it("overrides cross-origin policies when provided, preserving unset ones", () => {
    const base: SecurityHeadersOptions = { crossOriginOpenerPolicy: "same-origin" };
    const merged = mergeSecurityHeaders(base, { crossOriginOpenerPolicy: "same-origin-allow-popups", crossOriginEmbedderPolicy: "credentialless" });
    expect(merged.crossOriginOpenerPolicy).toBe("same-origin-allow-popups");
    expect(merged.crossOriginEmbedderPolicy).toBe("credentialless");
    expect(merged.crossOriginResourcePolicy).toBeUndefined();
  });
});
