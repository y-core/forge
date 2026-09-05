import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { resume, resumeScope } from "../client/resume";
import { FakeElement, FakeEvent, fakeTree } from "../client/test-dom";
import { ALERT_SCOPE } from "../contracts/alert-contract";
import { DIALOG_OPEN_MODAL_ATTR, DIALOG_SCOPE } from "../contracts/dialog-contract";
import { ISLAND_STATE_KEY } from "../contracts/island-contract";
import { TOAST_DURATION_KEY, TOAST_SCOPE } from "../contracts/toast-contract";
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
    // Built from the contracts the component writes, never from a second hardcoded spelling: a
    // fixture that restates the names cannot catch a rename of them.
    this.dataset = { scope: scopeName };
    if (state !== undefined) this.dataset[ISLAND_STATE_KEY] = JSON.stringify(state);
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

/** A `<dialog>` whose `showModal` is countable. A realm without it is the `?.` branch, so the method
 *  is present only when the fixture asks for it. */
class FakeDialog extends FakeElement {
  modalOpens = 0;

  constructor(attrs: Record<string, string>, modal = true) {
    super("DIALOG", { "data-scope": DIALOG_SCOPE, ...attrs });
    if (modal) {
      this.showModal = () => {
        this.modalOpens += 1;
      };
    }
  }

  showModal?: () => void;
}

function captureErrors<T>(run: () => T): { result: T; errors: string[] } {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  try {
    return { result: run(), errors };
  } finally {
    console.error = original;
  }
}

describe("dialog scope", () => {
  it("calls showModal only on the dialog the server marked open, because open alone is never modal", () => {
    const { doc } = fakeTree();
    const marked = new FakeDialog({ [DIALOG_OPEN_MODAL_ATTR]: "", id: "marked" });
    const unmarked = new FakeDialog({ id: "unmarked" });
    doc.root.append(marked, unmarked);

    resume(doc as never)();

    expect({ marked: marked.modalOpens, unmarked: unmarked.modalOpens }).toEqual({ marked: 1, unmarked: 0 });
  });

  it("carries on in a realm whose dialog has no showModal, and still opens the one that has", () => {
    const { doc } = fakeTree();
    const legacy = new FakeDialog({ [DIALOG_OPEN_MODAL_ATTR]: "", id: "legacy" }, false);
    const modern = new FakeDialog({ [DIALOG_OPEN_MODAL_ATTR]: "", id: "modern" });
    doc.root.append(legacy, modern);

    const { errors } = captureErrors(() => resume(doc as never)());

    expect({ errors, opened: modern.modalOpens }).toEqual({ errors: [], opened: 1 });
  });
});

describe("toast scope — registration", () => {
  it("is registered and returns state on resumeScope", () => {
    const root = new FakeEl(TOAST_SCOPE) as unknown as HTMLElement;
    const state = resumeScope(root);
    expect(state).toBeDefined();
  });
});

describe("toast scope — auto-close", () => {
  it("schedules removal after configured duration", () => {
    const root = new FakeEl(TOAST_SCOPE, { [TOAST_DURATION_KEY]: 3000 }) as unknown as HTMLElement;
    resumeScope(root);
    expect(capturedTimer?.ms).toBe(3000);
    capturedTimer?.fn();
    expect((root as unknown as FakeEl).removed).toBe(true);
  });

  it("does not schedule a timer when duration is absent", () => {
    const root = new FakeEl(TOAST_SCOPE) as unknown as HTMLElement;
    resumeScope(root);
    expect(capturedTimer).toBeUndefined();
  });

  it("does not schedule a timer when duration is 0", () => {
    const root = new FakeEl(TOAST_SCOPE, { [TOAST_DURATION_KEY]: 0 }) as unknown as HTMLElement;
    resumeScope(root);
    expect(capturedTimer).toBeUndefined();
  });
});

describe("alert scope", () => {
  it("is registered and can be resumed", () => {
    const root = new FakeEl(ALERT_SCOPE) as unknown as HTMLElement;
    const state = resumeScope(root);
    expect(state).toBeDefined();
  });

  // Drives the registered handler through a real click and the delegated runtime, rather than
  // calling `root.remove()` by hand: the old spelling passed whether or not `client.ts` registered
  // a `dismiss` action at all, which is the one thing this test exists to prove.
  it("removes the alert when its dismiss button is clicked", () => {
    const { doc, el } = fakeTree();
    const root = el("DIV", { "data-scope": ALERT_SCOPE, id: "alert" });
    const close = el("BUTTON", { "data-slot": "alert-dismiss", "data-on-click": "dismiss" });
    root.append(close);
    doc.root.append(root);

    const release = resume(doc as never);
    close.dispatchEvent(new FakeEvent("click"));
    release();

    expect(doc.root.querySelector("#alert")).toBe(null);
  });
});
