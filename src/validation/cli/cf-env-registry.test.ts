/** cf-env-registry.test.ts — the binding-kind data table + default policy.
 *
 *  Exercises the pure data (`cf-env-registry.ts`): `REGISTRY` coverage of the key
 *  wrangler binding kinds (valid name-field/shape per row, wrangler emission order)
 *  and `DEFAULT_OPTIONS` (an empty, generic policy carrying the presence/shape floor).
 */

import { describe, expect, it } from "bun:test";
import { DEFAULT_OPTIONS, REGISTRY } from "./cf-env-registry";

const CHECK = '(x) => typeof x === "object" && x !== null';

describe("REGISTRY", () => {
  it("covers the key wrangler binding kinds, each with a valid name-field and shape", () => {
    const byKey = new Map(REGISTRY.map((d) => [d.configKey, d]));
    for (const key of [
      "kv_namespaces",
      "r2_buckets",
      "d1_databases",
      "queues.producers",
      "ratelimits",
      "assets",
      "durable_objects.bindings",
      "services",
      "workflows",
    ]) {
      expect(byKey.has(key)).toBe(true);
    }
    for (const def of REGISTRY) {
      expect(["binding", "name"]).toContain(def.nameField);
      expect(["list", "object"]).toContain(def.shape);
    }
  });

  it("preserves wrangler's order: ratelimits before assets", () => {
    const keys = REGISTRY.map((d) => d.configKey);
    expect(keys.indexOf("ratelimits")).toBeLessThan(keys.indexOf("assets"));
  });
});

describe("DEFAULT_OPTIONS", () => {
  it("is an empty, generic policy carrying the presence/shape binding check", () => {
    expect(DEFAULT_OPTIONS.optional.size).toBe(0);
    expect(DEFAULT_OPTIONS.refinements).toEqual({});
    expect(DEFAULT_OPTIONS.bindingCheck).toBe(CHECK);
  });
});
