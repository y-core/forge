import { describe, expect, it } from "bun:test";
import { createRedirectResponse, fragmentResponse, htmlResponse, redirect } from "./response";

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
