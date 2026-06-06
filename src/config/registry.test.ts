import { describe, expect, it } from "bun:test";
import { registerConfig, retrieveConfig } from "./registry";

describe("retrieveConfig", () => {
  it("returns undefined for a target that has never been registered", () => {
    const target = {};
    expect(retrieveConfig(target)).toBeUndefined();
  });
});

describe("registerConfig / retrieveConfig — round-trip", () => {
  it("returns the stored value after registration", () => {
    const target = {};
    registerConfig(target, { theme: "dark" });
    const result = retrieveConfig<{ theme: string }>(target);
    expect(result).toBeDefined();
  });

  it("returns a value whose resolved output matches the stored config", () => {
    const target = {};
    const stored = { theme: "dark" };
    registerConfig(target, stored);
    const config = retrieveConfig<{ theme: string }>(target);
    // Config<T> is the raw stored value when retrieveConfig is used without a real Config instance
    // The registry stores whatever is passed in, returned as Config<T> | undefined.
    // We can verify identity by checking the reference.
    expect(config).toBe(stored as unknown as typeof config);
  });
});

describe("registerConfig — isolation", () => {
  it("two different target objects are fully isolated", () => {
    const targetA = {};
    const targetB = {};
    registerConfig(targetA, { name: "A" });
    expect(retrieveConfig(targetB)).toBeUndefined();
  });

  it("does not leak registrations between targets", () => {
    const targetA = {};
    const targetB = {};
    const storeA = { name: "A" };
    registerConfig(targetA, storeA);
    registerConfig(targetB, { name: "B" });
    // retrieveConfig for targetA should return what was registered for targetA
    expect(retrieveConfig(targetA)).toBe(storeA as unknown as ReturnType<typeof retrieveConfig>);
    // targetB registration does not bleed into targetA
    expect(retrieveConfig(targetA)).not.toBe(retrieveConfig(targetB) as unknown as ReturnType<typeof retrieveConfig>);
  });
});

describe("registerConfig — overwrite", () => {
  it("overwriting a registration returns the newer value", () => {
    const target = {};
    const valueA = { version: 1 };
    const valueB = { version: 2 };
    registerConfig(target, valueA);
    registerConfig(target, valueB);
    const result = retrieveConfig<{ version: number }>(target);
    expect(result).toBe(valueB as unknown as typeof result);
  });
});
