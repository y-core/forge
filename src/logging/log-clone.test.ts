import { describe, expect, it } from "bun:test";

import { cloneLogValue, LOG_REDACTED } from "./log-clone";
import type { LogKeyVerdict } from "./types";

const KEEP = (): LogKeyVerdict => "keep";

function verdicts(map: Record<string, LogKeyVerdict>): (key: string) => LogKeyVerdict {
  return (key) => map[key] ?? "keep";
}

describe("cloneLogValue — JSON-stable shapes", () => {
  it("renders a Date as its ISO instant", () => {
    expect(cloneLogValue({ at: new Date("2026-05-31T10:00:00.000Z") }, KEEP)).toStrictEqual({ at: "2026-05-31T10:00:00.000Z" });
  });

  it("renders an invalid Date as null rather than throwing on the log path", () => {
    expect(cloneLogValue({ at: new Date("nonsense") }, KEEP)).toStrictEqual({ at: null });
  });

  it("narrows a URL to origin and path, dropping the query a toJSON would have kept", () => {
    expect(cloneLogValue({ to: new URL("https://app.example.com/reset?token=SECRET#f") }, KEEP)).toStrictEqual({
      to: "https://app.example.com/reset",
    });
  });

  it("tags a Map and a Set with their payload", () => {
    expect(cloneLogValue({ m: new Map([["a", 1]]), s: new Set(["x"]) }, KEEP)).toStrictEqual({
      m: { type: "Map", entries: [["a", 1]] },
      s: { type: "Set", values: ["x"] },
    });
  });

  it("marks a reference that reappears on its own path as circular", () => {
    const node: Record<string, unknown> = { id: 1 };
    node.self = node;
    expect(cloneLogValue(node, KEEP)).toStrictEqual({ id: 1, self: "[circular]" });
  });

  it("keeps a repeated sibling reference, which is not a cycle", () => {
    const shared = { id: 1 };
    expect(cloneLogValue({ a: shared, b: shared }, KEEP)).toStrictEqual({ a: { id: 1 }, b: { id: 1 } });
  });

  it("honours a value's own toJSON and then walks the result", () => {
    const holder = { toJSON: () => ({ at: new Date("2026-05-31T10:00:00.000Z") }) };
    expect(cloneLogValue({ holder }, KEEP)).toStrictEqual({ holder: { at: "2026-05-31T10:00:00.000Z" } });
  });

  it("leaves the input untouched", () => {
    const input = { secret: "live", nested: { secret: "live" } };
    cloneLogValue(input, () => "mask");
    expect(input).toStrictEqual({ secret: "live", nested: { secret: "live" } });
  });
});

describe("cloneLogValue — the per-key verdict", () => {
  it("replaces a masked key's value with the fixed literal", () => {
    expect(cloneLogValue({ a: "live", b: "kept" }, verdicts({ a: "mask" }))).toStrictEqual({ a: LOG_REDACTED, b: "kept" });
  });

  it("drops a removed key entirely rather than leaving it undefined", () => {
    const cloned = cloneLogValue({ a: "live", b: "kept" }, verdicts({ a: "remove" })) as Record<string, unknown>;
    expect("a" in cloned).toBe(false);
    expect(cloned).toStrictEqual({ b: "kept" });
  });

  it("applies the verdict at every depth, not only the top level", () => {
    expect(cloneLogValue({ user: { a: "live" } }, verdicts({ a: "mask" }))).toStrictEqual({ user: { a: LOG_REDACTED } });
  });

  it("masks a whole subtree when the key holding it matches", () => {
    expect(cloneLogValue({ a: { deep: [1, 2] } }, verdicts({ a: "mask" }))).toStrictEqual({ a: LOG_REDACTED });
  });

  it("reaches a key inside an array element", () => {
    expect(cloneLogValue({ users: [{ a: "live" }] }, verdicts({ a: "mask" }))).toStrictEqual({ users: [{ a: LOG_REDACTED }] });
  });

  it("does not consult the verdict for a Map key, which is a value rather than a property name", () => {
    expect(cloneLogValue({ m: new Map([["a", "live"]]) }, verdicts({ a: "mask" }))).toStrictEqual({ m: { type: "Map", entries: [["a", "live"]] } });
  });

  it("applies the verdict to a toJSON result's keys", () => {
    const failure = { toJSON: () => ({ message: "boom", a: "live" }) };
    expect(cloneLogValue({ failure }, verdicts({ a: "remove" }))).toStrictEqual({ failure: { message: "boom" } });
  });

  it("masks rather than recursing into a cyclic value whose key matches", () => {
    const node: Record<string, unknown> = { id: 1 };
    node.self = node;
    expect(cloneLogValue({ a: node }, verdicts({ a: "mask" }))).toStrictEqual({ a: LOG_REDACTED });
  });
});
