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

describe("batching", () => {
  it("coalesces several writes inside one batch into exactly one downstream re-run", () => {
    const trigger = createSignal(0);
    const a = createSignal(0);
    const b = createSignal(0);
    const c = createSignal(0);
    let downstreamRuns = 0;

    // one write to `trigger` opens a batch in which three signals are written
    effect(() => {
      const n = trigger.value;
      a.value = n;
      b.value = n;
      c.value = n;
    });
    effect(() => {
      a.value;
      b.value;
      c.value;
      downstreamRuns++;
    });

    expect(downstreamRuns).toBe(1);
    trigger.value = 1;
    expect(downstreamRuns).toBe(2);
  });

  it("flushes a shared downstream effect once across nested batches", () => {
    const trigger = createSignal(0);
    const mid = createSignal(0);
    const leaf = createSignal(0);
    let downstreamRuns = 0;

    effect(() => {
      mid.value = trigger.value;
    });
    // writing `mid` re-runs this inside the outer batch, opening a nested one
    effect(() => {
      leaf.value = mid.value;
    });
    effect(() => {
      mid.value;
      leaf.value;
      downstreamRuns++;
    });

    expect(downstreamRuns).toBe(1);
    trigger.value = 1;
    expect(downstreamRuns).toBe(2);
  });
});

describe("effect that throws", () => {
  it("does not wedge notification for unrelated effects", () => {
    const trigger = createSignal(0);
    const other = createSignal(0);
    let otherRuns = 0;

    effect(() => {
      if (trigger.value > 0) throw new Error("boom");
    });
    effect(() => {
      other.value;
      otherRuns++;
    });
    expect(otherRuns).toBe(1);

    expect(() => {
      trigger.value = 1;
    }).toThrow("boom");

    // two consecutive writes: the second only re-runs if the batch depth —
    // and therefore the epoch counter — recovered from the throw
    other.value = 1;
    expect(otherRuns).toBe(2);
    other.value = 2;
    expect(otherRuns).toBe(3);
  });

  it("does not stay installed as the dependency-tracking target", () => {
    let deadRuns = 0;
    expect(() =>
      effect(() => {
        deadRuns++;
        throw new Error("dead");
      }),
    ).toThrow("dead");
    expect(deadRuns).toBe(1);

    const s = createSignal(0);
    s.value; // read outside any effect — must not subscribe the dead node
    expect(() => {
      s.value = 1;
    }).not.toThrow();
    expect(deadRuns).toBe(1);
  });

  // The case above throws *before reading anything*, so it never subscribes and cannot detect an
  // orphaned subscription. Reading first is what makes the leak reachable — and it is unbounded,
  // not one-shot: the disposer never reaches the caller, so nothing can ever unsubscribe the node.
  it("leaves nothing subscribed when the first run reads a signal and then throws", () => {
    const s = createSignal(0);
    let runs = 0;

    expect(() =>
      effect(() => {
        runs++;
        s.value;
        throw new Error("poison");
      }),
    ).toThrow("poison");
    expect(runs).toBe(1);

    // Each of these would rethrow "poison" out of the *setter* — an unrelated call site — while the
    // dead node stayed subscribed, and would keep doing so for every write for the signal's life.
    expect(() => {
      s.value = 1;
    }).not.toThrow();
    expect(() => {
      s.value = 2;
    }).not.toThrow();
    expect(runs).toBe(1);
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
