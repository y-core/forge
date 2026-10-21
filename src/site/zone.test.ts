import { describe, expect, it } from "bun:test";

import type { ZoneSurface } from "./types";
import { buildAllowExpression, buildAllowRule, buildRedirectRule, EXPRESSION_MAX_CHARS, ZonePatternError } from "./zone";

const surface: ZoneSurface = {
  apex: "example.com",
  paths: ["/", "/fica", "/api/contact"],
  prefixes: ["/assets/"],
  files: ["/favicon.ico", "/robots.txt", "/sitemap.xml"],
};

const allowPaths = (...paths: string[]): string => buildAllowExpression({ apex: "example.com", paths, prefixes: [], files: [] });

const surfaceRefusal = (zone: ZoneSurface): ZonePatternError | undefined => {
  try {
    buildAllowExpression(zone);
  } catch (error) {
    if (error instanceof ZonePatternError) return error;
    throw error;
  }
  return undefined;
};

const refusal = (source: string): ZonePatternError | undefined => surfaceRefusal({ apex: "example.com", paths: [source], prefixes: [], files: [] });

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

  it("refuses a route a browser would percent-encode, in every place a path is written", () => {
    const surfaces: ZoneSurface[] = [
      { apex: "example.com", paths: ["/café/:id"], prefixes: [], files: [] },
      { apex: "example.com", paths: ["/über"], prefixes: [], files: [] },
      { apex: "example.com", paths: [], prefixes: [], files: ["/😀.txt"] },
      { apex: "example.com", paths: [], prefixes: ["/café/"], files: [] },
    ];
    for (const zone of surfaces) {
      const error = surfaceRefusal(zone);
      expect(error?.reason).toBe("encoding");
      expect(error?.message).toContain("percent-encoded");
    }
  });

  it("refuses every character of the browser path percent-encode set", () => {
    for (const char of [" ", '"', "#", "<", ">", "`", "{", "}", "\t", "\x7f"]) {
      expect(surfaceRefusal({ apex: "example.com", paths: [`/a${char}b`], prefixes: [], files: [] })?.reason).toBe("encoding");
      expect(surfaceRefusal({ apex: "example.com", paths: [`/a${char}b/:id`], prefixes: [], files: [] })?.reason).toBe("encoding");
    }
    expect(surfaceRefusal({ apex: "example.com", paths: [], prefixes: [], files: ["/a?b"] })?.reason).toBe("encoding");
  });

  it("accepts a route already written percent-encoded, unchanged", () => {
    const expression = buildAllowExpression({ apex: "example.com", paths: ["/caf%C3%A9/:id", "/%C3%BCber"], prefixes: ["/caf%C3%A9/"], files: [] });
    expect(expression).toContain('http.request.uri.path in {"/%C3%BCber"}');
    expect(expression).toContain('strict wildcard "/caf%C3%A9/*"');
    expect(expression).toContain('starts_with(http.request.uri.path, "/caf%C3%A9/")');
  });

  it("emits printable ASCII outside the set verbatim", () => {
    const ascii = "/a-z_A.Z~0!$&'+,;=@[]^|%";
    expect(buildAllowExpression({ apex: "example.com", paths: [ascii], prefixes: [], files: [] })).toContain(`{"${ascii}"}`);
  });
});

describe("buildAllowExpression — dynamic routes", () => {
  it("matches a param as a strict wildcard rather than as a literal path", () => {
    const expression = allowPaths("/admin/users/:id/edit");
    expect(expression).toContain('http.request.uri.path strict wildcard "/admin/users/*/edit"');
    expect(expression).not.toContain(":id");
  });

  it("emits one clause for a named and an unnamed wildcard of the same shape", () => {
    const expression = allowPaths("/files/*rest", "/files/*");
    expect(expression.split('strict wildcard "/files/*"').length).toBe(2);
  });

  it("allows an optional both with and without its contents", () => {
    const expression = allowPaths("/docs(/guides/:category)");
    expect(expression).toContain('http.request.uri.path in {"/docs"}');
    expect(expression).toContain('strict wildcard "/docs/guides/*"');
  });

  it("expands nested optionals into every reachable shape", () => {
    const expression = allowPaths("/api(/v:major(.:minor))");
    expect(expression).toContain('http.request.uri.path in {"/api"}');
    expect(expression).toContain('strict wildcard "/api/v*"');
    expect(expression).toContain('strict wildcard "/api/v*.*"');
  });

  it("keeps an escaped asterisk literal in the wildcard", () => {
    expect(allowPaths("/files/2\\*3/:id")).toContain('strict wildcard "/files/2\\\\*3/*"');
  });

  it("keeps an escaped backslash literal in the wildcard", () => {
    expect(allowPaths("/a\\\\b/:id")).toContain('strict wildcard "/a\\\\\\\\b/*"');
  });

  it("unescapes a colon that is not a param", () => {
    expect(allowPaths("/t/12\\:30/:id")).toContain('strict wildcard "/t/12:30/*"');
  });

  it("matches a route that is static once unescaped as an exact path", () => {
    const expression = allowPaths("/calc/2\\*3");
    expect(expression).toContain('http.request.uri.path in {"/calc/2*3"}');
    expect(expression).not.toContain("strict wildcard");
  });

  it("collapses adjacent wildcards, since Cloudflare rejects `**`", () => {
    const expression = allowPaths("/a/:x*y");
    expect(expression).toContain('strict wildcard "/a/*"');
    expect(expression).not.toContain("**");
  });

  it("refuses a route whose first segment is dynamic, since `*` spans `/` and would match nearly every path", () => {
    for (const source of ["/:slug", "/*", "/*rest", "/(:locale)", "/:a/:b", "/:name.:ext", "/:a/x", "/x:id/y"]) {
      const error = refusal(source);
      expect(error?.reason).toBe("catch-all");
      expect(error?.source).toBe(source);
    }
  });

  it("accepts a dynamic route behind a static first segment", () => {
    for (const source of ["/x/:id", "/x/:a/:b", "/api/v:major"]) expect(refusal(source)).toBeUndefined();
  });

  it("refuses a route that names a host", () => {
    for (const source of ["https://example.com/x/:id", "://:tenant.example.com/d"]) expect(refusal(source)?.reason).toBe("host");
  });

  it("refuses a route that carries a search constraint", () => {
    expect(refusal("/search?q=")?.reason).toBe("search");
  });

  it("refuses a source that is not a route pattern", () => {
    for (const source of ["/a(:b", "/a)", "/a\\", "/a/:"]) expect(refusal(source)?.reason).toBe("malformed");
  });

  it("names the refusal as a ZonePatternError", () => {
    const error = refusal("/:slug");
    expect(error).toBeInstanceOf(Error);
    expect(error?.name).toBe("ZonePatternError");
  });

  it("does not refuse a surface whose only path is dynamic as empty", () => {
    expect(allowPaths("/u/:id")).toContain('strict wildcard "/u/*"');
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

  it("refuses a source outside the apex — this consolidates a zone, it is not a URL forwarder", () => {
    expect(() => buildRedirectRule({ from: ["www.elsewhere.net"], apex: "example.com" })).toThrow(/not within "example.com"/);
  });

  it("refuses a source that merely ends in the apex without a label boundary", () => {
    expect(() => buildRedirectRule({ from: ["notexample.com"], apex: "example.com" })).toThrow(/not within/);
  });

  it("refuses the apex itself, which would redirect to itself", () => {
    expect(() => buildRedirectRule({ from: ["example.com"], apex: "example.com" })).toThrow(/apex itself/);
  });

  it("escapes a quote in the apex rather than letting it close the target literal", () => {
    const apex = 'example.com") or true or concat("';
    const rule = buildRedirectRule({ from: [`www.${apex}`], apex });
    const fromValue = rule.action_parameters?.from_value as { target_url: { expression: string } } | undefined;
    const target = fromValue?.target_url.expression;
    expect(target).toBe('concat("https://example.com\\") or true or concat(\\"", http.request.uri.path)');
  });

  it("holds the target expression to the same per-rule limit as the match expression", () => {
    // Long enough that the target expression is over the limit while the match expression, which is
    // eighteen characters shorter, is still under it.
    const apex = `${"a".repeat(EXPRESSION_MAX_CHARS - 40)}.com`;
    expect(`(http.host in {"www.${apex}"})`.length).toBeLessThanOrEqual(EXPRESSION_MAX_CHARS);
    expect(() => buildRedirectRule({ from: [`www.${apex}`], apex })).toThrow(/over Cloudflare's per-rule limit/);
  });

  it("accepts a deeper subdomain", () => {
    expect(buildRedirectRule({ from: ["old.www.example.com"], apex: "example.com" }).expression).toContain("old.www.example.com");
  });
});
