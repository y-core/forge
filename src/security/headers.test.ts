import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { makeSecurityHeaders } from "./headers";

async function headersFor(middleware: ReturnType<typeof makeSecurityHeaders>) {
  const app = new Hono();
  app.use("*", middleware);
  app.get("/", (c) => c.text("ok"));
  const res = await app.request("/");
  return res.headers;
}

describe("makeSecurityHeaders — defaults", () => {
  it("sets strict-transport-security with default max-age", async () => {
    const headers = await headersFor(makeSecurityHeaders());
    expect(headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
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
    expect(headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains; preload",
    );
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
