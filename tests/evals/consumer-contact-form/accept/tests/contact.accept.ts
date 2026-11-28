import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { openBunD1 } from "@y-core/forge/testing/d1/bun";
import type { TestD1 } from "@y-core/forge/testing/d1/bun";

import { createWorker } from "../src/worker";
import { testEnv } from "./env";

let d1: TestD1;

beforeEach(async () => {
  d1 = await openBunD1();
});

afterEach(async () => {
  await d1.dispose();
});

const app = () => createWorker({ scriptSrc: ["'self'"] });

function submit(fields: Record<string, string>): Promise<Response> {
  return app().request("/contact", { method: "POST", body: new URLSearchParams(fields) }, testEnv(d1));
}

const spoken = async (res: Response) =>
  (await res.text())
    .split(/<[^>]+>/)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

describe("the contact form, from outside", () => {
  it("serves a form with name, email and message fields at /contact", async () => {
    const res = await app().request("/contact", {}, testEnv(d1));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect([...html.matchAll(/<(?:input|textarea)\b[^>]*\sname="([^"]+)"/g)].map((match) => match[1]).sort()).toEqual(["email", "message", "name"]);
  });

  it("thanks a valid sender by name, on behalf of the site", async () => {
    const res = await submit({ name: "Ada", email: "ada@example.com", message: "Hello there, Forge." });

    expect([res.status, await spoken(res)]).toEqual([200, "Thanks, Ada. Forge Eval will be in touch."]);
  });

  it("refuses an address that is not one with 422", async () => {
    expect((await submit({ name: "Ada", email: "not-an-address", message: "Hello there, Forge." })).status).toBe(422);
  });

  it("refuses a message shorter than ten characters with 422", async () => {
    expect((await submit({ name: "Ada", email: "ada@example.com", message: "Hi" })).status).toBe(422);
  });
});
