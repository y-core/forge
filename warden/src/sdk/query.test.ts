import { describe, expect, it } from "bun:test";

import type { RegisteredRule } from "../rules/types";
import { QUERY_TIMEOUT_MS, type QueryData, runQuery } from "./query";

const RULE = { id: "forge-a", statement: "Never a.", detectors: [{ kind: "review" }], scope: ["libs"] } as unknown as RegisteredRule;
const DATA: QueryData = { rules: [RULE], corpus: [], steps: [{ tier: "static", label: "lint", fixable: true }] };

describe("runQuery()", () => {
  it("returns what the arrow resolves to, as JSON", async () => {
    expect(await runQuery("async () => rules.map((rule) => rule.id).concat(steps.map((step) => step.label))", DATA)).toEqual({
      ok: true,
      data: '["forge-a","lint"]',
    });
  });

  it("returns `null` for an arrow that resolves to nothing", async () => {
    expect(await runQuery("async () => {}", DATA)).toEqual({ ok: true, data: "null" });
  });

  it("hands the query frozen data, so one query cannot change what the next reads", async () => {
    const result = await runQuery("async () => { rules[0].id = 'x'; }", DATA);
    expect(result.ok).toBe(false);
    expect(RULE.id).toBe("forge-a");
  });

  it("offers no require, process, fetch or timer", async () => {
    expect(await runQuery("() => [typeof require, typeof process, typeof fetch, typeof setTimeout, typeof Bun]", DATA)).toEqual({
      ok: true,
      data: '["undefined","undefined","undefined","undefined","undefined"]',
    });
  });

  it("refuses code generation, the way out to the host's globals", async () => {
    const result = await runQuery("async () => (() => {}).constructor('return process')()", DATA);
    expect(result).toEqual({ ok: false, error: "the query threw — EvalError: Code generation from strings disallowed for this context" });
  });

  it("stops a query that runs past its limit, its microtasks included", async () => {
    expect(await runQuery("() => { while (true) {} }", DATA, 50)).toEqual({
      ok: false,
      error: "the query failed — Script execution timed out after 50ms",
    });
    expect((await runQuery("async () => { await null; while (true) {} }", DATA, 50)).ok).toBe(false);
  });

  it("names a query that never settles, and one that does not parse", async () => {
    expect(await runQuery("async () => new Promise(() => {})", DATA)).toEqual({
      ok: false,
      error: "the query never settled — it awaited something that cannot resolve here, where there is no I/O and no timer",
    });
    expect((await runQuery("async () => {", DATA)).ok).toBe(false);
  });

  it("never runs a getter the query defines on its result names, which would run on the host past the timeout", async () => {
    const started = Date.now();
    const code =
      "async () => { for (const name of ['__out', '__error']) Object.defineProperty(globalThis, name, { get() { while (true) {} }, configurable: true }); return 1; }";
    const result = await runQuery(code, DATA, 100);

    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("answers an error, and leaves the host running, when the query breaks the result write or throws what cannot be printed", async () => {
    const readOnly = await runQuery("async () => { Object.defineProperty(globalThis, '__out', { writable: false }); return 1; }", DATA);
    const unprintable = await runQuery("async () => { throw { toString() { throw 1; } }; }", DATA);

    expect(readOnly.ok).toBe(false);
    expect(unprintable).toEqual({ ok: false, error: "the query threw — a value that cannot be printed" });
    expect(await runQuery("async () => 2", DATA)).toEqual({ ok: true, data: "2" });
  });

  it("runs the query in a process of its own, so a promise it leaves rejected cannot stop the caller", async () => {
    expect(await runQuery("async () => { Promise.reject(1); return 1; }", DATA)).toEqual({ ok: true, data: "1" });
    expect(await runQuery("async () => { (async () => { throw new Error('floating'); })(); return 1; }", DATA)).toEqual({ ok: true, data: "1" });
    expect(await runQuery("async () => 2", DATA)).toEqual({ ok: true, data: "2" });
  });

  it("stops a query whose output passes the limit, rather than holding all of it in the caller", async () => {
    expect(await runQuery("async () => 'x'.repeat(10_000)", DATA, QUERY_TIMEOUT_MS, 1000)).toEqual({
      ok: false,
      error: "the query was stopped — its output passed 1000 characters",
    });
    expect(await runQuery("async () => 'x'.repeat(10)", DATA, QUERY_TIMEOUT_MS, 1000)).toEqual({ ok: true, data: '"xxxxxxxxxx"' });
  });
});
