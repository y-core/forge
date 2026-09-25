import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { FakeElement, FakeEvent, fakeTree } from "../client/dom.fixture";
import { resume, resumeScope } from "../client/resume";
import { ALERT_SCOPE } from "../contracts/alert-contract";
import { ANNOUNCE_FAILURE_ATTR, ANNOUNCER_REGION_SLOTS, ANNOUNCER_SCOPE } from "../contracts/announcer-contract";
import { DIALOG_OPEN_MODAL_ATTR, DIALOG_SCOPE } from "../contracts/dialog-contract";
import { ISLAND_STATE_KEY } from "../contracts/island-contract";
import { TOAST_CONTAINER_SCOPE, TOAST_DURATION_KEY, TOAST_SCOPE } from "../contracts/toast-contract";
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

/** A `<dialog>` whose `showModal` is countable, and absent when the fixture asks for the `?.` branch. */
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

/** A page with an `<Announcer />`, so a scope's announcement has somewhere to land. */
function announcedPage() {
  const { doc, el } = fakeTree();
  const polite = el("DIV", { "data-slot": ANNOUNCER_REGION_SLOTS.polite });
  const assertive = el("DIV", { "data-slot": ANNOUNCER_REGION_SLOTS.assertive });
  doc.root.append(el("DIV", { "data-scope": ANNOUNCER_SCOPE }).append(polite, assertive));
  return { doc, el, win: doc.defaultView, polite, assertive };
}

/** The messages `region` holds now, one per node. */
const heldBy = (region: FakeElement): string[] => region.children.map((node) => node.textContent);

describe("toast-container scope", () => {
  it("announces the toasts it holds at load, and every toast inserted until it is disposed", () => {
    const { doc, el, win, polite } = announcedPage();
    win.observeMutations();
    const toast = (text: string) => {
      const described = el("DIV", { "data-slot": "toast-description" });
      described.textContent = text;
      return el("DIV", { "data-slot": "toast" }).append(el("DIV", { "data-slot": "toast-body" }).append(described));
    };
    doc.root.append(el("SECTION", { "data-scope": TOAST_CONTAINER_SCOPE }).append(toast("Signed in")));

    const release = resume(doc as never);
    win.flush();
    const atLoad = heldBy(polite);
    win.observers[0]?.deliver(toast("Saved"));
    win.flush();
    const inserted = heldBy(polite);
    release();

    expect({ atLoad, inserted, connected: win.observers[0]?.connected }).toEqual({ atLoad: ["Signed in"], inserted: ["Saved"], connected: false });
  });
});

describe("announcer scope", () => {
  it("interrupts with the first field error a full-page submission rendered", () => {
    const { doc, el, win, assertive } = announcedPage();
    const first = el("P", { "data-slot": "field-error" });
    first.textContent = "Enter an email address";
    const second = el("P", { "data-slot": "field-error" });
    second.textContent = "Choose a password";
    doc.root.append(el("FORM").append(first, second));

    const release = resume(doc as never);
    win.flush();
    release();

    expect(heldBy(assertive)).toEqual(["Enter an email address"]);
  });

  it("interrupts with the failure panel a page was rendered with", () => {
    const { doc, el, win, assertive } = announcedPage();
    doc.root.append(el("DIV", { [ANNOUNCE_FAILURE_ATTR]: "Could not read the log stream" }));

    const release = resume(doc as never);
    win.flush();
    release();

    expect(heldBy(assertive)).toEqual(["Could not read the log stream"]);
  });

  it("says nothing on a page with no field error or failure panel", () => {
    const { doc, win } = announcedPage();

    const release = resume(doc as never);
    release();

    expect(win.timers.size).toBe(0);
  });
});

describe("alert scope", () => {
  it("is registered and can be resumed", () => {
    const root = new FakeEl(ALERT_SCOPE) as unknown as HTMLElement;
    const state = resumeScope(root);
    expect(state).toBeDefined();
  });

  // Driven through a real click and the delegated runtime: calling `root.remove()` by hand passes
  // whether or not `client.ts` registered a `dismiss` action at all.
  it("removes the alert when its dismiss button is clicked, and rehomes the focus it was holding", () => {
    const { doc, el } = fakeTree();
    const region = el("SECTION", { id: "region" });
    const root = el("DIV", { "data-scope": ALERT_SCOPE, id: "alert" });
    const close = el("BUTTON", { "data-slot": "alert-dismiss", "data-on-click": "dismiss" });
    root.append(close);
    region.append(root);
    doc.root.append(region);
    close.focus();

    const release = resume(doc as never);
    close.dispatchEvent(new FakeEvent("click"));
    release();

    expect({ alert: doc.root.querySelector("#alert"), focused: doc.activeElement?.id }).toEqual({ alert: null, focused: "region" });
  });
});
