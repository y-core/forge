import { describe, expect, it } from "bun:test";

import { createAutosave } from "./autosave";
import type { Autosave, AutosaveTimers } from "./types";

interface FakeTimers extends AutosaveTimers {
  now(): number;
  advanceTo(at: number): void;
  armed(): number;
}

function fakeTimers(): FakeTimers {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    advanceTo(at) {
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= at).sort(([a, x], [b, y]) => x.at - y.at || a - b)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.fn();
      }
      now = at;
    },
    armed: () => timers.size,
  };
}

function harness(): { autosave: Autosave; timers: FakeTimers; saves: number[] } {
  const timers = fakeTimers();
  const saves: number[] = [];
  const autosave = createAutosave({ save: () => saves.push(timers.now()), timers });
  return { autosave, timers, saves };
}

describe("createAutosave", () => {
  it("saves one touch once, 2 s after it and not at 1999 ms", () => {
    const { autosave, timers, saves } = harness();

    autosave.touch();
    timers.advanceTo(1999);
    expect(saves).toEqual([]);

    timers.advanceTo(2000);
    expect(saves).toEqual([2000]);

    timers.advanceTo(60_000);
    expect(saves).toEqual([2000]);
  });

  it("restarts the 2 s quiet period on each touch", () => {
    const { autosave, timers, saves } = harness();

    autosave.touch();
    timers.advanceTo(1500);
    autosave.touch();
    timers.advanceTo(3499);
    expect(saves).toEqual([]);

    timers.advanceTo(3500);
    expect(saves).toEqual([3500]);
  });

  it("saves every 20 s while touches keep arriving, then once 2 s after the last touch", () => {
    const { autosave, timers, saves } = harness();

    for (let at = 0; at < 45_000; at += 100) {
      timers.advanceTo(at);
      autosave.touch();
    }
    timers.advanceTo(90_000);

    expect(saves).toEqual([20_000, 40_000, 46_900]);
  });

  it("saves immediately on flush when dirty, and the armed timers then save nothing more", () => {
    const { autosave, timers, saves } = harness();

    autosave.touch();
    timers.advanceTo(300);
    expect(autosave.dirty()).toBe(true);

    autosave.flush();
    expect(saves).toEqual([300]);
    expect(autosave.dirty()).toBe(false);

    timers.advanceTo(60_000);
    expect(saves).toEqual([300]);
  });

  it("never saves on flush when clean", () => {
    const { autosave, timers, saves } = harness();

    autosave.flush();
    timers.advanceTo(60_000);

    expect(saves).toEqual([]);
  });

  it("drops a pending save on cancel", () => {
    const { autosave, timers, saves } = harness();

    autosave.touch();
    expect([autosave.dirty(), timers.armed()]).toEqual([true, 2]);

    autosave.cancel();
    timers.advanceTo(60_000);

    expect([saves, autosave.dirty(), timers.armed()]).toEqual([[], false, 0]);
  });

  it("keeps saving after a cancel when touched again", () => {
    const { autosave, timers, saves } = harness();

    autosave.touch();
    autosave.cancel();
    timers.advanceTo(1000);
    autosave.touch();
    timers.advanceTo(3000);

    expect(saves).toEqual([3000]);
  });

  it("saves a touch inside the debounce window exactly once when torn down as the README does, flush then dispose", () => {
    const timers = fakeTimers();
    const saves: number[] = [];
    const autosave = createAutosave({ save: () => saves.push(timers.now()), timers });

    autosave.touch();
    timers.advanceTo(500);
    autosave.flush();
    autosave.dispose();
    timers.advanceTo(60_000);

    expect([saves, timers.armed()]).toEqual([[500], 0]);
  });

  it("drops the pending save on dispose, and ignores every later call", () => {
    const { autosave, timers, saves } = harness();

    autosave.touch();
    expect(timers.armed()).toBe(2);

    autosave.dispose();
    autosave.touch();
    autosave.flush();
    timers.advanceTo(60_000);

    expect([saves, autosave.dirty(), timers.armed()]).toEqual([[], false, 0]);
  });

  it("honours a configured debounce and max wait", () => {
    const timers = fakeTimers();
    const saves: number[] = [];
    const autosave = createAutosave({ save: () => saves.push(timers.now()), timers, debounceMs: 50, maxWaitMs: 120 });

    for (let at = 0; at < 300; at += 40) {
      timers.advanceTo(at);
      autosave.touch();
    }
    timers.advanceTo(1000);

    expect(saves).toEqual([120, 240, 330]);
  });
});
