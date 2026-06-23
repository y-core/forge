import { describe, expect, it } from "bun:test";
import { effect } from "./signal";
import { signalRecord, writeSignal } from "./signal-record";

describe("signalRecord", () => {
  it("creates one signal per key carrying the initial value", () => {
    const rec = signalRecord({ a: 1, b: "x" });
    expect(rec.a.value).toBe(1);
    expect(rec.b.value).toBe("x");
  });

  it("produces independent signals", () => {
    const rec = signalRecord({ a: 1, b: 2 });
    rec.a.value = 99;
    expect(rec.a.value).toBe(99);
    expect(rec.b.value).toBe(2);
  });
});

describe("writeSignal", () => {
  it("updates only the targeted key", () => {
    const rec = signalRecord({ a: 1, b: 2 });
    writeSignal(rec, "a", 5);
    expect(rec.a.value).toBe(5);
    expect(rec.b.value).toBe(2);
  });

  it("re-runs an effect that reads the written member", () => {
    const rec = signalRecord({ a: 0 });
    let runs = 0;
    effect(() => {
      rec.a.value;
      runs++;
    });
    expect(runs).toBe(1);
    writeSignal(rec, "a", 1);
    expect(runs).toBe(2);
  });

  it("does not re-run an effect over an untouched member", () => {
    const rec = signalRecord({ a: 0, b: 0 });
    let runs = 0;
    effect(() => {
      rec.b.value;
      runs++;
    });
    expect(runs).toBe(1);
    writeSignal(rec, "a", 1);
    expect(runs).toBe(1);
  });
});
