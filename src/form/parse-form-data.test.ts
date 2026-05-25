import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { parseFormData } from "./parse-form-data";
import type { ReadonlyFormData } from "./types";

describe("parseFormData", () => {
  it("parses form data and returns it", async () => {
    let fd: ReadonlyFormData | undefined;
    const app = new Hono();
    app.post("/test", async (c) => {
      fd = await parseFormData(c);
      return c.text("ok");
    });

    await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Alice",
    });
    expect(fd).toBeInstanceOf(FormData);
    expect(fd?.get("name")).toBe("Alice");
  });

  it("memoizes — repeated calls return the same FormData instance", async () => {
    let first: ReadonlyFormData | undefined;
    let second: ReadonlyFormData | undefined;
    const app = new Hono();
    app.post("/test", async (c) => {
      first = await parseFormData(c);
      second = await parseFormData(c);
      return c.text("ok");
    });

    await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Alice",
    });
    expect(first).toBe(second);
  });

  it("propagates errors from body parsing", async () => {
    const app = new Hono();
    app.post("/test", async (c) => {
      try {
        await parseFormData(c);
        return c.text("ok");
      } catch {
        return c.text("error", 400);
      }
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("error");
  });
});
