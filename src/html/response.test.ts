import { describe, expect, it } from "bun:test";
import { htmlResponse } from "./response";

describe("htmlResponse", () => {
  it("defaults to status 200", () => {
    const res = htmlResponse("<p>hello</p>");
    expect(res.status).toBe(200);
  });

  it("sets content-type to text/html; charset=utf-8", () => {
    const res = htmlResponse("<p>hello</p>");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("accepts a custom status code", () => {
    const res = htmlResponse("<p>not found</p>", 404);
    expect(res.status).toBe(404);
  });

  it("passes the HTML body through unchanged", async () => {
    const res = htmlResponse("<h1>Title</h1>");
    expect(await res.text()).toBe("<h1>Title</h1>");
  });
});
