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

describe("the home page", () => {
  it("names the site and reports the database up", async () => {
    const res = await createWorker({ scriptSrc: ["'self'"] }).request("/", {}, testEnv(d1));

    expect(res.status).toBe(200);
    expect((await res.text()).split(/<[^>]+>/).filter(Boolean)).toEqual(["Forge Eval", "Forge Eval", "The database is up."]);
  });
});
