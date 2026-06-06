import { describe, expect, it } from "bun:test";
import { computed, createSignal, effect } from "./signal";

describe("createSignal", () => {
  it("returns initial value", () => {
    const s = createSignal(42);
    expect(s.value).toBe(42);
  });

  it("setter updates value", () => {
    const s = createSignal(0);
    s.value = 99;
    expect(s.value).toBe(99);
  });
});

describe("effect", () => {
  it("runs immediately on creation", () => {
    let ran = false;
    effect(() => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("re-runs when a tracked signal changes", () => {
    const s = createSignal(0);
    let runs = 0;
    effect(() => {
      s.value;
      runs++;
    });
    expect(runs).toBe(1);
    s.value = 1;
    expect(runs).toBe(2);
  });

  it("tracks multiple signals and re-runs when either changes", () => {
    const a = createSignal(0);
    const b = createSignal(0);
    let runs = 0;
    effect(() => {
      a.value;
      b.value;
      runs++;
    });
    expect(runs).toBe(1);
    a.value = 1;
    expect(runs).toBe(2);
    b.value = 1;
    expect(runs).toBe(3);
  });

  it("dispose stops the effect from re-running", () => {
    const s = createSignal(0);
    let runs = 0;
    const dispose = effect(() => {
      s.value;
      runs++;
    });
    dispose();
    s.value = 1;
    expect(runs).toBe(1);
  });

  it("skips re-run when the same value is written (Object.is equality)", () => {
    const s = createSignal("hello");
    let runs = 0;
    effect(() => {
      s.value;
      runs++;
    });
    expect(runs).toBe(1);
    s.value = "hello";
    expect(runs).toBe(1);
  });

  it("re-tracks conditional dependencies after a re-run", () => {
    const condition = createSignal(true);
    const a = createSignal(1);
    const b = createSignal(10);
    let result = 0;
    let runs = 0;
    effect(() => {
      runs++;
      result = condition.value ? a.value : b.value;
    });
    expect(result).toBe(1);
    a.value = 2;
    expect(runs).toBe(2);
    expect(result).toBe(2);
    condition.value = false;
    expect(runs).toBe(3);
    expect(result).toBe(10);
    b.value = 20;
    expect(runs).toBe(4);
    expect(result).toBe(20);
    // a is no longer tracked after condition switched
    a.value = 99;
    expect(runs).toBe(4);
  });

  it("nested effect — manually disposing inner stops it from re-running", () => {
    const a = createSignal(0);
    const b = createSignal(0);
    let innerRuns = 0;
    let disposeInner: (() => void) | null = null;

    effect(() => {
      a.value;
      if (disposeInner) disposeInner();
      disposeInner = effect(() => {
        b.value;
        innerRuns++;
      });
    });

    expect(innerRuns).toBe(1);
    b.value = 1;
    expect(innerRuns).toBe(2);
    // outer re-runs → disposes old inner, creates new inner
    a.value = 1;
    expect(innerRuns).toBe(3);
    b.value = 2;
    expect(innerRuns).toBe(4);
  });
});

describe("computed", () => {
  it("derives a value from a signal", () => {
    const a = createSignal(3);
    const doubled = computed(() => a.value * 2);
    expect(doubled.value).toBe(6);
  });

  it("updates when its dependency changes", () => {
    const a = createSignal(1);
    const doubled = computed(() => a.value * 2);
    a.value = 5;
    expect(doubled.value).toBe(10);
  });

  it("does not trigger downstream effects when the computed value is unchanged", () => {
    const a = createSignal(0);
    // floor always returns 0 for values in [0, 1)
    const floored = computed(() => Math.floor(a.value));
    let sideEffectRuns = 0;
    effect(() => {
      floored.value;
      sideEffectRuns++;
    });
    expect(sideEffectRuns).toBe(1);
    a.value = 0.5; // floored is still 0 → downstream skipped
    expect(sideEffectRuns).toBe(1);
    a.value = 1; // floored changes to 1 → downstream fires
    expect(sideEffectRuns).toBe(2);
  });
});

describe("diamond dependency", () => {
  it("fires the downstream effect exactly once when two branches update", () => {
    // A → effectB (writes B), A → effectC (writes C), B + C → effectD
    const a = createSignal(0);
    const b = createSignal(0);
    const c = createSignal(0);
    let dRuns = 0;

    effect(() => {
      b.value = a.value;
    });
    effect(() => {
      c.value = a.value;
    });
    effect(() => {
      b.value;
      c.value;
      dRuns++;
    });

    expect(dRuns).toBe(1);
    a.value = 1; // triggers both branches, D should fire exactly once
    expect(dRuns).toBe(2);
  });
});
