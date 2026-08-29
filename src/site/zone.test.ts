import { describe, expect, it } from "bun:test";
import type { ZoneSurface } from "./types";
import { buildAllowExpression, buildAllowRule, buildRedirectRule, EXPRESSION_MAX_CHARS } from "./zone";

const surface: ZoneSurface = {
  apex: "example.com",
  paths: ["/", "/fica", "/api/contact"],
  prefixes: ["/assets/"],
  files: ["/favicon.ico", "/robots.txt", "/sitemap.xml"],
};

describe("buildAllowExpression", () => {
  it("puts every exact path and root file in one membership set, sorted", () => {
    expect(buildAllowExpression(surface)).toContain(
      'http.request.uri.path in {"/" "/api/contact" "/favicon.ico" "/fica" "/robots.txt" "/sitemap.xml"}',
    );
  });

  it("emits a starts_with clause per prefix", () => {
    expect(buildAllowExpression(surface)).toContain('starts_with(http.request.uri.path, "/assets/")');
  });

  it("always allows the reserved platform prefixes, even when the caller supplies none", () => {
    const expression = buildAllowExpression({ ...surface, prefixes: [] });
    expect(expression).toContain('starts_with(http.request.uri.path, "/cdn-cgi/")');
    expect(expression).toContain('starts_with(http.request.uri.path, "/.well-known/")');
  });

  it("refuses a surface with no application paths, files or prefixes of its own", () => {
    expect(() => buildAllowExpression({ apex: "example.com", paths: [], prefixes: [], files: [] })).toThrow(/empty/);
  });

  it("accepts a surface that carries only a prefix", () => {
    expect(buildAllowExpression({ apex: "example.com", paths: [], prefixes: ["/assets/"], files: [] })).toContain('"/assets/"');
  });

  it("refuses an expression over Cloudflare's per-rule character limit", () => {
    const paths = Array.from({ length: 400 }, (_, i) => `/a-fairly-long-route-path-number-${i}`);
    expect(() => buildAllowExpression({ ...surface, paths })).toThrow(new RegExp(String(EXPRESSION_MAX_CHARS)));
  });

  it("escapes a quote in a path rather than closing the literal early", () => {
    expect(buildAllowExpression({ ...surface, paths: ['/a"b'] })).toContain('"/a\\"b"');
  });
});

describe("buildAllowRule", () => {
  it("actions everything the surface does not account for, scoped to the apex host", () => {
    const rule = buildAllowRule(surface, { action: "managed_challenge" });
    expect(rule.action).toBe("managed_challenge");
    expect(rule.enabled).toBe(true);
    expect(rule.expression.startsWith('(http.host eq "example.com" and not (')).toBe(true);
    expect(rule.expression.endsWith("))")).toBe(true);
  });

  it("defaults a description naming the host whose surface was enumerated", () => {
    expect(buildAllowRule(surface, { action: "block" }).description).toBe("Allow-list: example.com served surface");
  });

  it("takes an explicit description over the default", () => {
    expect(buildAllowRule(surface, { action: "block", description: "custom" }).description).toBe("custom");
  });
});

describe("buildRedirectRule", () => {
  it("redirects the source hosts to the apex, preserving path and query", () => {
    expect(buildRedirectRule({ from: ["www.example.com"], apex: "example.com" })).toEqual({
      action: "redirect",
      expression: '(http.host in {"www.example.com"})',
      description: "Redirect www.example.com to example.com",
      enabled: true,
      action_parameters: {
        from_value: {
          status_code: 301,
          target_url: { expression: 'concat("https://example.com", http.request.uri.path)' },
          preserve_query_string: true,
        },
      },
    });
  });

  it("takes an explicit status code over the 301 default", () => {
    const rule = buildRedirectRule({ from: ["www.example.com"], apex: "example.com", statusCode: 308 });
    const fromValue = rule.action_parameters?.from_value as { status_code: number };
    expect(fromValue.status_code).toBe(308);
  });

  it("refuses a spec with no source host", () => {
    expect(() => buildRedirectRule({ from: [], apex: "example.com" })).toThrow(/no source host/);
  });
});
