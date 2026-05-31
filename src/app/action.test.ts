import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { applyRoutes, route } from "../router/mod";
import { defineAction } from "./action";

interface TestData {
  name: string;
}

function makeApp(action: ReturnType<typeof defineAction<TestData>>) {
  const app = new Hono();
  applyRoutes(app, [route("/test", action)]);
  return app;
}

const VALID_FORM = new URLSearchParams({ name: "Jane" });

describe("defineAction", () => {
  it("runs full pipeline successfully", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) =>
          data.name ? { ok: true, data } : { ok: false, errors: ["Name required"] },
        handle: (_data, c) => c.text("success"),
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: VALID_FORM.toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("success");
  });

  it("returns validation error fragment when validation fails", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (_data) => ({ ok: false, errors: ["Name required."] }),
        handle: (_data, c) => c.text("success"),
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Jane",
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Name required.");
    expect(text).toContain("Please correct the following fields.");
  });

  it("returns 400 when body cannot be parsed as form data", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) =>
          data.name ? { ok: true, data } : { ok: false, errors: ["Name required"] },
        handle: (_data, c) => c.text("success"),
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Jane" }),
    });
    expect(res.status).toBe(400);
  });

  it("calls onValidationError when provided", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (_data) => ({ ok: false, errors: ["Bad"] }),
        handle: (_data, c) => c.text("success"),
        onValidationError: (_errors, c) => c.text("custom error", 422),
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "name=Jane",
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toBe("custom error");
  });

  it("returns 500 fragment when handler throws", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) =>
          data.name ? { ok: true, data } : { ok: false, errors: ["Name required"] },
        handle: () => {
          throw new Error("downstream failure");
        },
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: VALID_FORM.toString(),
    });
    expect(res.status).toBe(500);
  });

  it("calls onError when handler throws and onError is provided", async () => {
    const app = makeApp(
      defineAction<TestData>({
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) =>
          data.name ? { ok: true, data } : { ok: false, errors: ["required"] },
        handle: () => {
          throw new Error("oops");
        },
        onError: (_err, c) => c.text("custom 500", 500),
      }),
    );

    const res = await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: VALID_FORM.toString(),
    });
    expect(await res.text()).toBe("custom 500");
  });

  it("runs middleware before the action", async () => {
    const order: string[] = [];
    const app = makeApp(
      defineAction<TestData>({
        middleware: async (_c, next) => {
          order.push("mw");
          return next();
        },
        parse: (fd) => ({ name: fd.get("name") as string }),
        validate: (data) =>
          data.name ? { ok: true, data } : { ok: false, errors: ["required"] },
        handle: (_data, c) => {
          order.push("handle");
          return c.text("ok");
        },
      }),
    );

    await app.request("/test", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: VALID_FORM.toString(),
    });
    expect(order).toEqual(["mw", "handle"]);
  });
});
