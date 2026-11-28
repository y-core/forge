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

async function textParts(path: string): Promise<[number, string[]]> {
  const res = await createWorker({ scriptSrc: ["'self'"] }).request(path, {}, testEnv(d1));
  const parts = (await res.text())
    .split(/<[^>]+>/)
    .map((part) => part.trim())
    .filter(Boolean);
  return [res.status, parts];
}

describe("the hello page, from outside", () => {
  it("greets the visitor its path names, worded as the home page greets", async () => {
    const [status, parts] = await textParts("/hello/Ada");

    expect(status).toBe(200);
    expect(parts.filter((part) => part.startsWith("Welcome to "))).toEqual(["Welcome to Forge Eval, Ada."]);
  });

  it("leaves the home page's own greeting as it was", async () => {
    const [status, parts] = await textParts("/");

    expect(status).toBe(200);
    expect(parts.filter((part) => part.startsWith("Welcome to "))).toEqual(["Welcome to Forge Eval, friend."]);
  });
});
