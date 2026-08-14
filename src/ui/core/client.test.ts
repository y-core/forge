import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resumeScope } from "../client/resume";

// Import client.ts to register the toast and alert scopes as a side effect.
import "./client";

class FakeEl {
  dataset: Record<string, string>;
  removed = false;
  // Names `globalThis` as the owning realm so `ownerWindow` routes the toast's timer to the captured `setTimeout`.
  ownerDocument = { defaultView: globalThis };
  remove() {
    this.removed = true;
  }
  constructor(scopeName: string, state?: Record<string, unknown>) {
    this.dataset = { scope: scopeName };
    if (state !== undefined) this.dataset.state = JSON.stringify(state);
  }
}

type TimerCapture = { fn: () => void; ms: number } | undefined;
let capturedTimer: TimerCapture;
const origSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  capturedTimer = undefined;
  // @ts-expect-error — intentionally replacing global for test isolation
  globalThis.setTimeout = (fn: () => void, ms: number) => {
    capturedTimer = { fn, ms };
    return 0;
  };
});

afterEach(() => {
  globalThis.setTimeout = origSetTimeout;
});

describe("toast scope — registration", () => {
  it("is registered and returns state on resumeScope", () => {
    const root = new FakeEl("toast") as unknown as HTMLElement;
    const state = resumeScope(root);
    expect(state).toBeDefined();
  });
});

describe("toast scope — auto-close", () => {
  it("schedules removal after configured duration", () => {
    const root = new FakeEl("toast", { duration: 3000 }) as unknown as HTMLElement;
    resumeScope(root);
    expect(capturedTimer?.ms).toBe(3000);
    capturedTimer?.fn();
    expect((root as unknown as FakeEl).removed).toBe(true);
  });

  it("does not schedule a timer when duration is absent", () => {
    const root = new FakeEl("toast") as unknown as HTMLElement;
    resumeScope(root);
    expect(capturedTimer).toBeUndefined();
  });

  it("does not schedule a timer when duration is 0", () => {
    const root = new FakeEl("toast", { duration: 0 }) as unknown as HTMLElement;
    resumeScope(root);
    expect(capturedTimer).toBeUndefined();
  });
});

describe("alert scope", () => {
  it("is registered and can be resumed", () => {
    const root = new FakeEl("alert") as unknown as HTMLElement;
    const state = resumeScope(root);
    expect(state).toBeDefined();
  });

  it("removes root when remove is called (dismiss contract)", () => {
    const root = new FakeEl("alert") as unknown as HTMLElement;
    resumeScope(root);
    root.remove();
    expect((root as unknown as FakeEl).removed).toBe(true);
  });
});
