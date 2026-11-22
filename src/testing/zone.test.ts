import { describe, expect, it } from "bun:test";

import { buildAllowExpression, buildAllowRule } from "../site/zone";
import { zoneAllows } from "./zone";

const wildcard = (pattern: string, path: string, strict: boolean): boolean =>
  zoneAllows(`http.request.uri.path ${strict ? "strict " : ""}wildcard ${JSON.stringify(pattern)}`, path);

const allowPaths = (...paths: string[]): string => buildAllowExpression({ apex: "example.com", paths, prefixes: [], files: [] });

describe("zoneAllows, against Cloudflare's documented wildcard semantics", () => {
  it("matches the documented example A, where * spans zero characters", () => {
    const pattern = "http*://example.com/a/*";
    for (const uri of [
      "https://example.com/a/",
      "http://example.com/a/",
      "https://example.com/a/page.html",
      "https://example.com/a/sub/folder/?name=value",
    ])
      expect(wildcard(pattern, uri, false)).toBe(true);
    for (const uri of ["https://example.com/ab/", "https://example.com/b/page.html", "https://sub.example.com/a/"])
      expect(wildcard(pattern, uri, false)).toBe(false);
  });

  it("matches the documented example B, where * spans a slash", () => {
    const pattern = "*.example.com/*/page.html";
    for (const uri of [
      "http://sub.example.com/folder/page.html",
      "https://admin.example.com/team/page.html",
      "https://admin.example.com/team/subteam/page.html",
    ])
      expect(wildcard(pattern, uri, false)).toBe(true);
    for (const uri of ["https://example.com/ab/page.html", "https://sub.example.com/folder2/page.html?s=value", "https://sub.example.com/a/"])
      expect(wildcard(pattern, uri, false)).toBe(false);
  });

  it("folds case under wildcard and not under strict wildcard", () => {
    expect(wildcard("/articles/*", "/ARTICLES/2008", false)).toBe(true);
    expect(wildcard("/AdminTeam/*", "/AdminTeam/x", true)).toBe(true);
    expect(wildcard("/AdminTeam/*", "/adminteam/x", true)).toBe(false);
  });

  it("reads \\* as a literal star and \\\\ as a literal backslash", () => {
    expect(wildcard("/a\\*b", "/a*b", true)).toBe(true);
    expect(wildcard("/a\\*b", "/axb", true)).toBe(false);
    expect(wildcard("/a\\\\b", "/a\\b", true)).toBe(true);
    expect(wildcard("/a\\\\*", "/a\\xyz", true)).toBe(true);
  });

  it("reads contains and ends_with as case-sensitive literal substring and suffix tests", () => {
    expect(zoneAllows('http.request.uri.path contains "//"', "/a//b")).toBe(true);
    expect(zoneAllows('http.request.uri.path contains "/B"', "/a/b")).toBe(false);
    expect(zoneAllows('ends_with(http.request.uri.path, "/")', "/a/")).toBe(true);
    expect(zoneAllows('ends_with(http.request.uri.path, "*")', "/a/b")).toBe(false);
  });

  it("refuses a pattern Cloudflare would reject rather than guessing its meaning", () => {
    for (const pattern of ["/a/**", "/a/\\\\**", "/a\\", "/a\\b"]) expect(() => wildcard(pattern, "/a/b", true)).toThrow();
    expect(() => zoneAllows('http.request.uri.path contains "/a\\n"', "/a")).toThrow(/undocumented escape/);
  });
});

describe("zoneAllows, against every clause buildAllowExpression emits", () => {
  it("answers the membership set of exact paths and root files", () => {
    const expression = buildAllowExpression({ apex: "example.com", paths: ["/", "/fica"], prefixes: [], files: ["/robots.txt"] });
    expect(expression).toContain('http.request.uri.path in {"/" "/fica" "/robots.txt"}');
    for (const path of ["/", "/fica", "/robots.txt"]) expect(zoneAllows(expression, path)).toBe(true);
    for (const path of ["/fica/", "/FICA", "/robots.txt/x", "/other"]) expect(zoneAllows(expression, path)).toBe(false);
  });

  it("answers a starts_with clause per prefix, the reserved prefixes included", () => {
    const expression = buildAllowExpression({ apex: "example.com", paths: ["/"], prefixes: ["/assets/"], files: [] });
    expect(expression).toContain('starts_with(http.request.uri.path, "/assets/")');
    for (const path of ["/assets/app.css", "/assets/a//b", "/cdn-cgi/trace", "/.well-known/security.txt"])
      expect(zoneAllows(expression, path)).toBe(true);
    for (const path of ["/assets", "/Assets/app.css", "/x/assets/app.css"]) expect(zoneAllows(expression, path)).toBe(false);
  });

  it("answers the bounded-wildcard clause, holding each param to one non-empty segment", () => {
    const expression = allowPaths("/admin/users/:id", "/admin/users/:id/edit");
    expect(expression).toContain('(not http.request.uri.path contains "//" and (');
    expect(expression).toContain('and not http.request.uri.path wildcard "/*/*/*/*"');
    expect(expression).toContain('and not ends_with(http.request.uri.path, "/")');
    for (const path of ["/admin/users/1", "/admin/users/1/edit"]) expect(zoneAllows(expression, path)).toBe(true);
    for (const path of ["/admin/users/", "/admin/users/1/", "/admin/users/1/x", "/admin/users/1/edit/x", "/admin/users//edit", "/ADMIN/users/1"])
      expect(zoneAllows(expression, path)).toBe(false);
  });

  it("answers a bounded wildcard whose param shares its segment, which carries no ends_with clause", () => {
    const expression = allowPaths("/files/:name.pdf");
    expect(expression).not.toContain("ends_with");
    expect(zoneAllows(expression, "/files/report.pdf")).toBe(true);
    for (const path of ["/files/a/b.pdf", "/files/report.txt", "/files/report.pdf/x"]) expect(zoneAllows(expression, path)).toBe(false);
  });

  it("answers an unbounded splat clause across segments, still behind the empty-segment guard", () => {
    const expression = allowPaths("/files/*rest");
    expect(expression).toContain('(not http.request.uri.path contains "//" and (http.request.uri.path strict wildcard "/files/*"))');
    for (const path of ["/files/a", "/files/a/b/c"]) expect(zoneAllows(expression, path)).toBe(true);
    for (const path of ["/files//a", "/file/a"]) expect(zoneAllows(expression, path)).toBe(false);
  });

  it("answers every clause type together in one surface", () => {
    const expression = buildAllowExpression({
      apex: "example.com",
      paths: ["/", "/docs/", "/orgs/:org/repos/:repo", "/files/*rest"],
      prefixes: ["/assets/"],
      files: ["/favicon.ico"],
    });
    for (const path of ["/", "/docs/", "/favicon.ico", "/orgs/acme/repos/forge", "/files/a/b", "/assets/x", "/cdn-cgi//x"])
      expect(zoneAllows(expression, path)).toBe(true);
    for (const path of ["/docs", "/orgs/acme/repos/forge/x", "/orgs/acme/repos/", "/files//a", "/unknown"])
      expect(zoneAllows(expression, path)).toBe(false);
  });
});

describe("zoneAllows, on syntax it does not evaluate", () => {
  it("throws rather than answering allow or refuse", () => {
    for (const expression of [
      "",
      "true",
      'http.host eq "example.com"',
      'http.request.uri.path eq "/"',
      'http.request.uri.path matches "^/"',
      'lower(http.request.uri.path) in {"/"}',
      "http.request.uri.path in {foo}",
      'http.request.uri.path == "/"',
      'http.request.uri.path in {"/"} or',
      'http.request.uri.path in {"/"})',
      'starts_with(http.request.uri.path, "/a"',
    ])
      expect(() => zoneAllows(expression, "/")).toThrow(/^zoneAllows: /);
  });

  it("throws on a whole buildAllowRule expression, which scopes by host as well as by path", () => {
    const rule = buildAllowRule({ apex: "example.com", paths: ["/"], prefixes: [], files: [] }, { action: "block" });
    expect(() => zoneAllows(rule.expression, "/")).toThrow(/expected http\.request\.uri\.path, got http\.host/);
  });
});
