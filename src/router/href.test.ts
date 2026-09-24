import { describe, expect, it } from "bun:test";

import { get, route } from "@remix-run/fetch-router/routes";

import { createHref, CreateHrefError, joinPatterns } from "./mod";

describe("createHref re-export (F4)", () => {
  it("substitutes path params into the pattern", () => {
    expect(createHref("/users/:id", { id: "42" })).toBe("/users/42");
  });

  it("percent-encodes a search value so a reserved character cannot open a second parameter", () => {
    expect(createHref("/search", undefined, { searchParams: { q: "a b&c" } })).toBe("/search?q=a+b%26c");
  });

  it("accepts a URLSearchParams as readily as a record, so a caller may build the query however it has it", () => {
    expect(createHref("/search", undefined, { searchParams: new URLSearchParams({ q: "a b&c" }) })).toBe("/search?q=a+b%26c");
  });

  // A dot is a pathname delimiter now, so a param carrying one escapes rather than splitting.
  it("percent-encodes a dot inside a param value", () => {
    expect(createHref("/files/:name", { name: "report.pdf" })).toBe("/files/report%2Epdf");
  });

  it("renders a same-origin target path-relative against a baseURL", () => {
    expect(createHref("/users/:id", { id: "42" }, { baseURL: "https://a.example/admin/" })).toBe("../users/42");
  });

  it("refuses a baseURL that is not absolute, rather than resolving it against nothing", () => {
    expect(() => createHref("/users/:id", { id: "42" }, { baseURL: "/admin/" })).toThrow(TypeError);
  });

  it("refuses a pattern whose required param was not supplied, naming the one that is missing", () => {
    let thrown: unknown;
    try {
      createHref("/users/:id", {} as never);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CreateHrefError);
    expect((thrown as CreateHrefError).details.type).toBe("missing-params");
  });
});

describe("joinPatterns re-export (F4)", () => {
  const separators: readonly { base: string; next: string; joined: string }[] = [
    { base: "a", next: "b", joined: "/a/b" },
    { base: "a/", next: "b", joined: "/a/b" },
    { base: "a", next: "/b", joined: "/a/b" },
    { base: "a/", next: "/b", joined: "/a/b" },
    { base: "(a)", next: "(b)", joined: "/(a)/(b)" },
    { base: "(a/)", next: "(b)", joined: "/(a)/(b)" },
    { base: "(a)", next: "(/b)", joined: "/(a)(/b)" },
    { base: "(a/)", next: "(/b)", joined: "/(a)(/b)" },
  ];

  for (const { base, next, joined } of separators) {
    it(`joins \`${base}\` and \`${next}\` with exactly one separator, as \`${joined}\``, () => {
      expect(String(joinPatterns(base, next))).toBe(joined);
    });
  }

  it("joins the pattern a route map produces identically, which is what makes it usable for the same job", () => {
    const routes = route("/admin/", { edit: get("/:id/edit") });
    expect(String(joinPatterns("/admin/", "/:id/edit"))).toBe(String(routes.edit.pattern));
  });

  it("lets the joined segment override the base origin, so a mount can move a subtree to another host", () => {
    expect(String(joinPatterns("https://a.example/x", "http://b.example/y"))).toBe("http://b.example/x/y");
  });

  it("keeps the base origin where the joined segment names none", () => {
    expect(String(joinPatterns("https://a.example/x", "/y"))).toBe("https://a.example/x/y");
  });

  it("merges both sides' search constraints rather than letting the joined segment replace them", () => {
    expect(String(joinPatterns("/x?a", "/y?b"))).toBe("/x/y?a=&b=");
  });

  it("keeps both values of a constraint each side names differently", () => {
    expect(String(joinPatterns("/x?a=1", "/y?a=2"))).toBe("/x/y?a=1&a=2");
  });

  it("produces a pattern `createHref` can then fill, which is the whole point of joining before linking", () => {
    expect(createHref(String(joinPatterns("/admin", "/users/:id")), { id: "7" })).toBe("/admin/users/7");
  });
});
