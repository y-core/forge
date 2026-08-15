import { describe, expect, it } from "bun:test";
import { computed, createSignal, effect, type ReadonlySignal, withOwner } from "./signal";

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

  it("does not evaluate its body until the value is read", () => {
    const a = createSignal(1);
    let evaluations = 0;
    const doubled = computed(() => {
      evaluations++;
      return a.value * 2;
    });

    expect(evaluations).toBe(0);
    a.value = 4;
    expect(evaluations).toBe(0);
    expect(doubled.value).toBe(8);
    expect(evaluations).toBe(1);
  });

  it("throws on a computed that reads itself rather than overflowing the stack", () => {
    const self: ReadonlySignal<number> = computed(() => self.value + 1);
    expect(() => self.value).toThrow("the graph is cyclic");
  });

  it("settles a two-level computed chain through to its reader", () => {
    const a = createSignal(1);
    const doubled = computed(() => a.value * 2);
    const plusOne = computed(() => doubled.value + 1);
    let observed = 0;

    effect(() => {
      observed = plusOne.value;
    });

    expect(observed).toBe(3);
    a.value = 5;
    expect(observed).toBe(11);
  });

  it("never lets a reader observe a value inconsistent with its live sources", () => {
    const x = createSignal(0);
    const y = createSignal(0);
    const sum = computed(() => x.value + y.value);
    const observations: Array<{ derived: number; live: number }> = [];

    effect(() => {
      observations.push({ derived: sum.value, live: x.value + y.value });
    });
    // Both sources moved by one handler: the shape an eager computed tears on, since it would push a
    // value assembled before `y` moved. A handler may write; an effect may not.
    x.value = 1;
    y.value = 1;

    expect(observations.every((seen) => seen.derived === seen.live)).toBe(true);
    expect(observations.at(-1)).toEqual({ derived: 2, live: 2 });
  });

  it("re-runs a computed's reader after a flush an unrelated effect abandoned", () => {
    const s = createSignal(0);
    const tenfold = computed(() => s.value * 10);
    let observed = -1;

    effect(() => {
      if (s.value === 1) throw new Error("boom");
    });
    effect(() => {
      observed = tenfold.value;
    });

    expect(observed).toBe(0);
    expect(() => {
      s.value = 1;
    }).toThrow("boom");
    expect(observed).toBe(0);

    s.value = 2;
    expect(observed).toBe(20);
  });
});

const WRITE_REFUSED = "effects paint";

describe("the effects-paint rule", () => {
  it("throws when a signal is written while an effect is running", () => {
    const a = createSignal(0);
    const b = createSignal(0);

    expect(() =>
      effect(() => {
        b.value = a.value + 1;
      }),
    ).toThrow(WRITE_REFUSED);
  });

  // Never even warned before: `computed` tracked writes as reads, so a deriving function with a side
  // effect corrupted the graph silently.
  it("throws when a computed writes a signal", () => {
    const a = createSignal(1);
    const other = createSignal(0);
    const derived = computed(() => {
      other.value = a.value;
      return a.value * 2;
    });

    expect(() => derived.value).toThrow(WRITE_REFUSED);
  });

  // The shape the doc claimed topological ordering would fix. It would not: `mid` and `leaf` are
  // plain signals at read-depth 0, so E1, E2 and E3 all sit at depth 1 and ordering changes nothing.
  // The offending edge is the *write*, which the read graph cannot see. Banning it is the only route.
  it("throws on the E1-writes-mid / E2-reads-mid / E3-writes-leaf shape", () => {
    const root = createSignal(0);
    const mid = createSignal(0);
    const leaf = createSignal(0);

    expect(() =>
      effect(() => {
        mid.value = root.value + 1;
      }),
    ).toThrow(WRITE_REFUSED);

    effect(() => {
      mid.value;
    });

    expect(() =>
      effect(() => {
        leaf.value = mid.value;
      }),
    ).toThrow(WRITE_REFUSED);
  });

  it("allows a computed to derive its own value", () => {
    const a = createSignal(1);
    const doubled = computed(() => a.value * 2);

    expect(doubled.value).toBe(2);
    a.value = 3;
    expect(doubled.value).toBe(6);
  });

  it("allows a write from outside any effect, which is what a handler is", () => {
    const s = createSignal(0);
    effect(() => {
      s.value;
    });

    expect(() => {
      s.value = 1;
    }).not.toThrow();
  });

  it("allows a write from a listener an effect installed", () => {
    const s = createSignal(0);
    const deferred: Array<() => void> = [];
    effect(() => {
      s.value;
      deferred.push(() => {
        s.value = 2;
      });
    });

    expect(() => deferred[0]?.()).not.toThrow();
    expect(s.value).toBe(2);
  });

  // The sanctioned way to defer a command: the microtask runs with no active node, so the write is
  // an ordinary one made after the flush has settled.
  it("allows a write deferred to a microtask, and it still settles", async () => {
    const source = createSignal(0);
    const target = createSignal(0);
    effect(() => {
      const next = source.value;
      queueMicrotask(() => {
        target.value = next;
      });
    });

    source.value = 5;
    await Promise.resolve();
    expect(target.value).toBe(5);
  });

  // With no writes in effects there is no effect-to-effect edge, so no effect can be scheduled twice
  // by one write. Asserted over a DAG wide enough that an ordering bug would show.
  it("runs every effect body exactly once per write, across an arbitrary DAG", () => {
    const a = createSignal(1);
    const b = createSignal(2);
    const sum = computed(() => a.value + b.value);
    const scaled = computed(() => sum.value * 10);
    const mixed = computed(() => scaled.value + b.value);

    const runs = { one: 0, two: 0, three: 0, four: 0 };
    effect(() => {
      sum.value;
      runs.one += 1;
    });
    effect(() => {
      scaled.value;
      runs.two += 1;
    });
    effect(() => {
      mixed.value;
      sum.value;
      runs.three += 1;
    });
    effect(() => {
      a.value;
      mixed.value;
      runs.four += 1;
    });

    expect(runs).toEqual({ one: 1, two: 1, three: 1, four: 1 });

    a.value = 4;
    expect(runs).toEqual({ one: 2, two: 2, three: 2, four: 2 });

    b.value = 7;
    expect(runs).toEqual({ one: 3, two: 3, three: 3, four: 3 });
  });
});

describe("withOwner", () => {
  it("disposes an effect whose disposer the callback discarded", () => {
    const s = createSignal(0);
    let runs = 0;
    const owned = withOwner(() => {
      effect(() => {
        s.value;
        runs++;
      });
    });
    s.value = 1;
    expect(runs).toBe(2);
    owned.dispose();
    s.value = 2;
    expect(runs).toBe(2);
  });

  it("returns the callback's value", () => {
    const owned = withOwner(() => 42);
    expect(owned.result).toBe(42);
  });

  it("yields a no-op disposer for a callback that creates nothing", () => {
    const owned = withOwner(() => "nothing");
    expect(() => owned.dispose()).not.toThrow();
  });

  it("leaves an effect created outside the owner untouched", () => {
    const s = createSignal(0);
    let runs = 0;
    effect(() => {
      s.value;
      runs++;
    });
    const owned = withOwner(() => undefined);
    owned.dispose();
    s.value = 1;
    expect(runs).toBe(2);
  });

  it("collects only the effects created inside a nested owner", () => {
    const outerSignal = createSignal(0);
    const innerSignal = createSignal(0);
    let outerRuns = 0;
    let innerRuns = 0;

    const outer = withOwner(() => {
      effect(() => {
        outerSignal.value;
        outerRuns++;
      });
      return withOwner(() => {
        effect(() => {
          innerSignal.value;
          innerRuns++;
        });
      });
    });

    outer.result.dispose();
    innerSignal.value = 1;
    outerSignal.value = 1;
    expect({ outerRuns, innerRuns }).toEqual({ outerRuns: 2, innerRuns: 1 });

    outer.dispose();
    outerSignal.value = 2;
    expect(outerRuns).toBe(2);
  });

  it("collects an effect created inside another effect's first run", () => {
    const s = createSignal(0);
    let innerRuns = 0;
    const owned = withOwner(() => {
      effect(() => {
        effect(() => {
          s.value;
          innerRuns++;
        });
      });
    });
    expect(innerRuns).toBe(1);
    owned.dispose();
    s.value = 1;
    expect(innerRuns).toBe(1);
  });

  it("does not collect an effect created by a re-run after the owned window closed", () => {
    const a = createSignal(0);
    const b = createSignal(0);
    let innerRuns = 0;

    const owned = withOwner(() => {
      effect(() => {
        a.value;
        effect(() => {
          b.value;
          innerRuns++;
        });
      });
    });

    expect(innerRuns).toBe(1);
    a.value = 1;
    expect(innerRuns).toBe(2);
    owned.dispose();
    b.value = 1;
    expect(innerRuns).toBe(3);
  });

  it("disposes what a throwing callback created and rethrows", () => {
    const s = createSignal(0);
    let runs = 0;

    expect(() =>
      withOwner(() => {
        effect(() => {
          s.value;
          runs++;
        });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(runs).toBe(1);

    s.value = 1;
    expect(runs).toBe(1);
  });

  it("leaves nothing subscribed when an effect's first run throws inside the owner", () => {
    const s = createSignal(0);
    let runs = 0;

    expect(() =>
      withOwner(() => {
        effect(() => {
          runs++;
          s.value;
          throw new Error("poison");
        });
      }),
    ).toThrow("poison");
    expect(runs).toBe(1);

    expect(() => {
      s.value = 1;
    }).not.toThrow();
    expect(runs).toBe(1);
  });

  it("is a no-op to dispose an owned run twice", () => {
    const s = createSignal(0);
    let runs = 0;
    const owned = withOwner(() =>
      effect(() => {
        s.value;
        runs++;
      }),
    );
    owned.dispose();
    owned.dispose();
    s.value = 1;
    expect(runs).toBe(1);
  });

  it("does not collect a computed created inside the callback — a lazy computed is not an effect", () => {
    const a = createSignal(1);
    const owned = withOwner(() => computed(() => a.value * 2));
    expect(owned.result.value).toBe(2);
    owned.dispose();
    a.value = 5;
    expect(owned.result.value).toBe(10);
  });
});

// What "batching" now means: a write settles the whole graph before any effect sees a partial state.
// It used to mean "a chain of writing effects converges", a shape the effects-paint rule has removed.
describe("batching", () => {
  it("coalesces a fan-out through one computed into exactly one downstream re-run", () => {
    const trigger = createSignal(0);
    const a = computed(() => trigger.value);
    const b = computed(() => trigger.value);
    const c = computed(() => trigger.value);
    let downstreamRuns = 0;
    let observed = 0;

    effect(() => {
      observed = a.value + b.value + c.value;
      downstreamRuns++;
    });

    expect(downstreamRuns).toBe(1);
    trigger.value = 1;
    expect(downstreamRuns).toBe(2);
    expect(observed).toBe(3);
  });

  it("flushes a shared downstream effect once across a chain of computeds", () => {
    const trigger = createSignal(0);
    const mid = computed(() => trigger.value);
    const leaf = computed(() => mid.value);
    let downstreamRuns = 0;
    let observed = "";

    effect(() => {
      observed = `${mid.value}/${leaf.value}`;
      downstreamRuns++;
    });

    expect(downstreamRuns).toBe(1);
    trigger.value = 1;
    expect(downstreamRuns).toBe(2);
    expect(observed).toBe("1/1");
  });

  it("never shows an effect a half-settled graph, whatever order the readers registered in", () => {
    const trigger = createSignal(0);
    const mid = computed(() => trigger.value);
    const leaf = computed(() => mid.value);
    const seen: string[] = [];

    effect(() => {
      seen.push(`early:${mid.value}/${leaf.value}`);
    });
    effect(() => {
      seen.push(`late:${leaf.value}/${mid.value}`);
    });

    trigger.value = 1;
    expect(seen).toEqual(["early:0/0", "late:0/0", "early:1/1", "late:1/1"]);
  });

  it("refuses the in-effect fan-out these cases used to be written with", () => {
    const trigger = createSignal(0);
    const x = createSignal(0);

    expect(() =>
      effect(() => {
        x.value = trigger.value;
      }),
    ).toThrow(WRITE_REFUSED);
  });
});

describe("flush queue", () => {
  it("skips an effect disposed while it sits in the queue", () => {
    const s = createSignal(0);
    let laterRuns = 0;
    let disposeLater: (() => void) | null = null;

    effect(() => {
      s.value;
      disposeLater?.();
    });
    disposeLater = effect(() => {
      s.value;
      laterRuns++;
    });

    expect(laterRuns).toBe(1);
    s.value = 1;
    expect(laterRuns).toBe(1);
    s.value = 2;
    expect(laterRuns).toBe(1);
  });

  it("drops the effects queued behind a thrower rather than running them on the next write", () => {
    const trigger = createSignal(0);
    const other = createSignal(0);
    let behindRuns = 0;
    let otherRuns = 0;

    effect(() => {
      if (trigger.value > 0) throw new Error("boom");
    });
    effect(() => {
      trigger.value;
      behindRuns++;
    });
    effect(() => {
      other.value;
      otherRuns++;
    });
    expect(behindRuns).toBe(1);

    expect(() => {
      trigger.value = 1;
    }).toThrow("boom");
    expect(behindRuns).toBe(1);

    other.value = 1;
    expect(otherRuns).toBe(2);
    expect(behindRuns).toBe(1);
  });

  // The cap is per node per drain, so a long *legal* chain must not trip it. Built from computeds
  // rather than writing effects, which is now the only way to express a chain at all.
  it("flushes a chain of more than a hundred derivations without hitting the cap", () => {
    const head = createSignal(0);
    let tail: ReadonlySignal<number> = head;
    for (let i = 0; i < 150; i += 1) {
      const previous = tail;
      tail = computed(() => previous.value + 1);
    }

    let observed = 0;
    let runs = 0;
    effect(() => {
      observed = tail.value;
      runs++;
    });

    expect(observed).toBe(150);
    head.value = 1;
    expect(observed).toBe(151);
    // One write, one run of the reader at the end of a 150-deep chain.
    expect(runs).toBe(2);
  });

  it("refuses a self-writing effect outright, so the run cap is never what catches it", () => {
    const s = createSignal(0);
    expect(() =>
      effect(() => {
        s.value = s.value + 1;
      }),
    ).toThrow(WRITE_REFUSED);

    const other = createSignal(0);
    let runs = 0;
    effect(() => {
      other.value;
      runs++;
    });
    other.value = 1;
    expect(runs).toBe(2);
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
  it("fires the downstream effect exactly once when both branches update", () => {
    // A → b (computed), A → c (computed), b + c → effectD. The branches are derivations rather than
    // writing effects, which is the only shape the effects-paint rule leaves.
    const a = createSignal(0);
    const b = computed(() => a.value);
    const c = computed(() => a.value);
    let dRuns = 0;
    let observed = 0;

    effect(() => {
      observed = b.value + c.value;
      dRuns++;
    });

    expect(dRuns).toBe(1);
    a.value = 1;
    expect(dRuns).toBe(2);
    expect(observed).toBe(2);
  });

  it("does not re-run the reader when a branch re-derives to the same value", () => {
    const a = createSignal(0);
    const parity = computed(() => a.value % 2);
    let runs = 0;
    effect(() => {
      parity.value;
      runs++;
    });

    expect(runs).toBe(1);
    a.value = 2;
    // 0 % 2 and 2 % 2 are both 0 — the value never moved.
    expect(runs).toBe(1);
    a.value = 3;
    expect(runs).toBe(2);
  });
});
