import { describe, expect, it } from "bun:test";
import { diffConfig, formatPath } from "./diff";

describe("formatPath()", () => {
  it("renders keys and indices the way a user would point at them", () => {
    expect(formatPath(["kv_namespaces", 0, "id"])).toBe("kv_namespaces[0].id");
    expect(formatPath(["vars"])).toBe("vars");
    expect(formatPath([])).toBe("");
  });
});

describe("diffConfig()", () => {
  it("finds nothing when the two are identical", () => {
    expect(diffConfig({ name: "w", a: 1 }, { name: "w", a: 1 })).toEqual([]);
  });

  it("reports a changed primitive as a set", () => {
    expect(diffConfig({ a: 1 }, { a: 2 })).toEqual([{ kind: "set", path: ["a"], value: 2 }]);
  });

  it("reports an added primitive as a set", () => {
    expect(diffConfig({}, { a: "x" })).toEqual([{ kind: "set", path: ["a"], value: "x" }]);
  });

  it("finds a set nested inside an array", () => {
    const before = { kv: [{ binding: "A" }] };
    const after = { kv: [{ binding: "A", id: "ns" }] };
    expect(diffConfig(before, after)).toEqual([{ kind: "set", path: ["kv", 0, "id"], value: "ns" }]);
  });

  it("treats a removed key as unsupported rather than dropping it silently", () => {
    const diffs = diffConfig({ a: 1, b: 2 }, { a: 1 });
    expect(diffs).toEqual([{ kind: "unsupported", path: ["b"], reason: "key removed" }]);
  });

  it("treats an array length change as unsupported", () => {
    const diffs = diffConfig({ kv: [{ binding: "A" }] }, { kv: [{ binding: "A" }, { binding: "B" }] });
    expect(diffs[0]?.kind).toBe("unsupported");
    expect((diffs[0] as { reason: string }).reason).toMatch(/array length changed \(1 → 2\)/);
  });

  it("treats an added container as unsupported", () => {
    const diffs = diffConfig({}, { kv: [{ binding: "A" }] });
    expect(diffs).toEqual([{ kind: "unsupported", path: ["kv"], reason: "added array value" }]);
  });

  it("treats a type change as unsupported", () => {
    const diffs = diffConfig({ a: 1 }, { a: { b: 2 } });
    expect(diffs[0]?.kind).toBe("unsupported");
    expect((diffs[0] as { reason: string }).reason).toMatch(/type changed \(number → object\)/);
  });

  it("reports every difference, not just the first", () => {
    const diffs = diffConfig({ a: 1, b: 2, c: 3 }, { a: 9, b: 8, c: 3 });
    expect(diffs).toHaveLength(2);
  });

  it("distinguishes null from a missing key", () => {
    expect(diffConfig({ a: null }, { a: null })).toEqual([]);
    expect(diffConfig({ a: null }, { a: 1 })).toEqual([{ kind: "set", path: ["a"], value: 1 }]);
  });
});
