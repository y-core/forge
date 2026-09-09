import { describe, expect, it } from "bun:test";

import { createRedirectResponse, fragmentResponse, htmlResponse, jsonResponse, redirect } from "./response";

describe("htmlResponse", () => {
  it("defaults to status 200", () => {
    const res = htmlResponse("<p>hello</p>");
    expect(res.status).toBe(200);
  });

  it("sets content-type to text/html; charset=utf-8 (normalized, even without a headers arg)", () => {
    const res = htmlResponse("<p>hello</p>");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("accepts a custom status code", () => {
    const res = htmlResponse("<p>not found</p>", 404);
    expect(res.status).toBe(404);
  });

  it("passes the HTML body through unchanged", async () => {
    const res = htmlResponse("<h1>Title</h1>");
    expect(await res.text()).toBe("<!DOCTYPE html><h1>Title</h1>");
  });

  it("prepends a leading <!DOCTYPE html> for full pages", async () => {
    const body = await htmlResponse("<html></html>").text();
    expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
  });
});

describe("fragmentResponse", () => {
  it("defaults to status 200", () => {
    const res = fragmentResponse("<div>x</div>");
    expect(res.status).toBe(200);
  });

  it("sets content-type to text/html; charset=utf-8 (lowercase)", () => {
    const res = fragmentResponse("<div>x</div>");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("passes the body through with no <!DOCTYPE html> prepended", async () => {
    const res = fragmentResponse("<div>x</div>");
    expect(await res.text()).toBe("<div>x</div>");
  });

  it("accepts a custom status code", () => {
    const res = fragmentResponse("<div>error</div>", 422);
    expect(res.status).toBe(422);
  });
});

describe("redirect", () => {
  it("returns a 302 response with the Location header set", () => {
    const res = redirect("/login", 302);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });
});

describe("fragmentResponse — content-type is fixed", () => {
  it("throws when a caller supplies a lowercase content-type key", () => {
    expect(() => fragmentResponse("<div>ok</div>", 200, { "content-type": "application/json" })).toThrow(
      "fragmentResponse: content-type is fixed for HTML responses — remove it from headers",
    );
  });

  it("throws when a caller supplies a mixed-case Content-Type key", () => {
    expect(() => fragmentResponse("<div>ok</div>", 200, { "Content-Type": "application/json" })).toThrow(
      "fragmentResponse: content-type is fixed for HTML responses — remove it from headers",
    );
  });
});

describe("htmlResponse — content-type is fixed", () => {
  it("throws when a caller supplies a lowercase content-type key", () => {
    expect(() => htmlResponse("<p>ok</p>", 200, { "content-type": "application/json" })).toThrow(
      "htmlResponse: content-type is fixed for HTML responses — remove it from headers",
    );
  });

  it("throws when a caller supplies a mixed-case Content-Type key", () => {
    expect(() => htmlResponse("<p>ok</p>", 200, { "Content-Type": "application/json" })).toThrow(
      "htmlResponse: content-type is fixed for HTML responses — remove it from headers",
    );
  });
});

describe("createRedirectResponse", () => {
  it("is the same function as the redirect alias", () => {
    expect(createRedirectResponse).toBe(redirect);
  });
});

describe("jsonResponse", () => {
  it("defaults to status 200 and the JSON content type", () => {
    const res = jsonResponse({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("serialises the body with JSON.stringify", async () => {
    expect(await jsonResponse({ id: 7, name: "aurora" }).text()).toBe('{"id":7,"name":"aurora"}');
  });

  it("serialises a bare array, string and null", async () => {
    expect(await jsonResponse([1, 2]).text()).toBe("[1,2]");
    expect(await jsonResponse("hello").text()).toBe('"hello"');
    expect(await jsonResponse(null).text()).toBe("null");
  });

  it("honours an explicit status", () => {
    expect(jsonResponse({ error: "nope" }, 422).status).toBe(422);
  });

  it("merges caller headers alongside the fixed content type", () => {
    const res = jsonResponse({}, 200, { "cache-control": "no-store" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
});

describe("jsonResponse — content-type is fixed", () => {
  it("throws on a lowercase caller-supplied content-type", () => {
    expect(() => jsonResponse({}, 200, { "content-type": "text/html" })).toThrow(
      "jsonResponse: content-type is fixed for JSON responses — remove it from headers",
    );
  });

  it("throws on any casing of a caller-supplied content-type", () => {
    expect(() => jsonResponse({}, 200, { "Content-Type": "text/html" })).toThrow(
      "jsonResponse: content-type is fixed for JSON responses — remove it from headers",
    );
  });
});
