import { describe, expect, it } from "bun:test";

import { bindingSchema, bindingSetSchema, validateEnv } from "./env-validation";

const KV = { get: () => undefined, put: () => undefined };

describe("bindingSchema()", () => {
  it("accepts an env whose binding carries every named method", () => {
    expect(validateEnv({ LOGS_KV: KV }, bindingSchema("LOGS_KV", ["get", "put"], "a KV namespace binding"))).toEqual({ LOGS_KV: KV });
  });

  it("fails a required binding that is absent", () => {
    expect(() => validateEnv({}, bindingSchema("LOGS_KV", ["get", "put"], "a KV namespace binding"))).toThrow(
      "Invalid environment: LOGS_KV: missing",
    );
  });

  it("passes an optional binding that is absent", () => {
    expect(validateEnv({}, bindingSchema("LOGS_KV", ["get", "put"], "a KV namespace binding", { optional: true }))).toEqual({});
  });

  it("still fails an optional binding that is present with the wrong shape", () => {
    expect(() =>
      validateEnv({ LOGS_KV: { get: () => undefined } }, bindingSchema("LOGS_KV", ["get", "put"], "a KV namespace binding", { optional: true })),
    ).toThrow("Invalid environment: LOGS_KV: LOGS_KV must be a KV namespace binding");
  });

  it("fails a required binding present with the wrong shape", () => {
    expect(() => validateEnv({ LOGS_KV: {} }, bindingSchema("LOGS_KV", ["get", "put"], "a KV namespace binding"))).toThrow(
      "Invalid environment: LOGS_KV: LOGS_KV must be a KV namespace binding",
    );
  });
});

describe("bindingSetSchema()", () => {
  const SPECS = [
    { name: "DB", methods: ["prepare"], label: "a D1 database binding" },
    { name: "LOGS_KV", methods: ["get", "put"], label: "a KV namespace binding", optional: true },
  ];

  it("validates several bindings in one pass, the optional one absent", () => {
    const db = { prepare: () => undefined };

    expect(validateEnv({ DB: db }, bindingSetSchema(SPECS))).toEqual({ DB: db });
  });

  it("fails on the required binding while the optional one is absent", () => {
    expect(() => validateEnv({}, bindingSetSchema(SPECS))).toThrow("Invalid environment: DB: missing");
  });

  it("fails on the optional binding when it is present with the wrong shape", () => {
    expect(() => validateEnv({ DB: { prepare: () => undefined }, LOGS_KV: {} }, bindingSetSchema(SPECS))).toThrow(
      "Invalid environment: LOGS_KV: LOGS_KV must be a KV namespace binding",
    );
  });
});
