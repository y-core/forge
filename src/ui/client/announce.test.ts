import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  ANNOUNCE_BUSY_CHANNEL,
  ANNOUNCE_FAILURE_ATTR,
  ANNOUNCE_FAILURE_CHANNEL,
  ANNOUNCE_FORM_ERROR_CHANNEL,
  ANNOUNCE_LINGER_MS,
  ANNOUNCE_SETTLE_MS,
  ANNOUNCE_TOAST_CHANNEL,
  ANNOUNCER_REGION_SLOTS,
} from "../contracts/announcer-contract";
import { announce, announceFailure, announceFieldError, announceSpinner, announceToast } from "./announce";
import { fakeTree } from "./dom.fixture";
import type { FakeDocument, FakeElement } from "./dom.fixture";

/** A document holding an `<Announcer />`'s two regions, and the window whose clock drives them. */
function page() {
  const { doc, el } = fakeTree();
  const polite = el("DIV", { "data-slot": ANNOUNCER_REGION_SLOTS.polite });
  const assertive = el("DIV", { "data-slot": ANNOUNCER_REGION_SLOTS.assertive });
  doc.root.append(el("DIV", { "data-slot": "announcer" }).append(polite, assertive));
  return { doc, el, win: doc.defaultView, polite, assertive, within: doc as unknown as Node };
}

/** The messages `region` holds now, one per node. */
function heldBy(region: FakeElement): string[] {
  return region.children.map((node) => node.textContent);
}

/** Records every message node appended to `region`, including those that have since lingered out. */
function spokenIn(region: FakeElement): string[] {
  const spoken: string[] = [];
  const append = region.append.bind(region);
  region.append = (...nodes: FakeElement[]) => {
    spoken.push(...nodes.map((node) => node.textContent));
    return append(...nodes);
  };
  return spoken;
}

let warnings: string[] = [];
const originalWarn = console.warn;

beforeEach(() => {
  warnings = [];
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
});

afterEach(() => {
  console.warn = originalWarn;
});

describe("announce — settling", () => {
  it("waits the settle before speaking, so nothing is written while a burst may still be arriving", () => {
    const { win, polite, within } = page();

    announce("Saved", { within });

    expect({ held: heldBy(polite), delays: [...win.delays.values()] }).toEqual({ held: [], delays: [ANNOUNCE_SETTLE_MS] });
    win.flush();
    expect(heldBy(polite)).toEqual(["Saved"]);
  });

  it("speaks only the latest of a burst on one channel", () => {
    const { win, polite, within } = page();

    announce("Saving", { within });
    announce("Still saving", { within });
    announce("Saved", { within });
    win.flush();

    expect(heldBy(polite)).toEqual(["Saved"]);
  });

  it("keeps both messages of two channels settling together, each as its own node", () => {
    const { win, polite, within } = page();

    announce("Row 3 selected", { channel: "grid", within });
    announce("Draft saved", { channel: "status", within });
    win.flush();

    expect(heldBy(polite)).toEqual(["Row 3 selected", "Draft saved"]);
  });

  it("removes each message once it has lingered, so the hidden region never holds stale text", () => {
    const { win, polite, within } = page();

    announce("Saved", { within });
    win.flush();

    expect([...win.delays.values()]).toEqual([ANNOUNCE_LINGER_MS]);
    win.flush();
    expect(heldBy(polite)).toEqual([]);
  });

  it("speaks text trimmed of the whitespace around it", () => {
    const { win, polite, within } = page();

    announce("  Saved \n", { within });
    win.flush();

    expect(heldBy(polite)).toEqual(["Saved"]);
  });

  it("writes nothing, and throws nothing, when the Announcer leaves before the settle", () => {
    const { doc, win, polite, within } = page();
    const spoken = spokenIn(polite);

    announce("Saved", { within });
    doc.root.children[0]?.remove();

    expect(() => win.flush()).not.toThrow();
    expect(spoken).toEqual([]);
  });
});

describe("announce — cancelling", () => {
  it("drops the channel's pending message on empty text, so a wait shorter than the settle is never spoken", () => {
    const { win, polite, within } = page();

    announce("Loading", { channel: ANNOUNCE_BUSY_CHANNEL, within });
    announce("", { channel: ANNOUNCE_BUSY_CHANNEL, within });

    expect(win.timers.size).toBe(0);
    win.flush();
    expect(heldBy(polite)).toEqual([]);
  });

  it("treats whitespace alone as empty", () => {
    const { win, within } = page();

    announce("Loading", { within });
    announce("  \n ", { within });

    expect(win.timers.size).toBe(0);
  });

  it("cancels only its own channel", () => {
    const { win, polite, within } = page();

    announce("Draft saved", { channel: "status", within });
    announce("Loading", { channel: ANNOUNCE_BUSY_CHANNEL, within });
    announce("", { channel: ANNOUNCE_BUSY_CHANNEL, within });
    win.flush();

    expect(heldBy(polite)).toEqual(["Draft saved"]);
  });

  it("forgets the channel's last message, so the same prompt after a cancel is spoken again", () => {
    const { win, polite, within } = page();
    const spoken = spokenIn(polite);

    announce("Press Enter to run", { channel: "prompt", within });
    win.flush();
    announce("", { channel: "prompt", within });
    announce("Press Enter to run", { channel: "prompt", within });
    win.flush();

    expect(spoken).toEqual(["Press Enter to run", "Press Enter to run"]);
  });
});

describe("announce — repeats", () => {
  it("skips a message identical to the one the channel last spoke", () => {
    const { win, polite, within } = page();
    const spoken = spokenIn(polite);

    announce("Saved", { within });
    win.flush();
    announce("Saved", { within });
    win.flush();

    expect(spoken).toEqual(["Saved"]);
  });

  it("appends a new node for the identical message when asked to repeat", () => {
    const { win, polite, within } = page();
    const spoken = spokenIn(polite);

    announce("Saved", { within });
    win.flush();
    announce("Saved", { within, repeat: true });
    win.flush();

    expect(spoken).toEqual(["Saved", "Saved"]);
  });

  it("skips only a consecutive repeat, so a message spoken again after another is still spoken", () => {
    const { win, polite, within } = page();
    const spoken = spokenIn(polite);

    for (const text of ["Saved", "Save failed", "Saved"]) {
      announce(text, { within });
      win.flush();
    }

    expect(spoken).toEqual(["Saved", "Save failed", "Saved"]);
  });

  it("treats padded text as the same message, so padding alone never defeats the repeat check", () => {
    const { win, polite, within } = page();
    const spoken = spokenIn(polite);

    announce("Saved", { within });
    win.flush();
    announce(" Saved ", { within });
    win.flush();

    expect(spoken).toEqual(["Saved"]);
  });

  it("does not count a message the departed Announcer never spoke as said, so it is spoken once one returns", () => {
    const { doc, win, polite, within } = page();
    const announcer = doc.root.children[0];

    announce("Saved", { within });
    announcer?.remove();
    win.flush();
    if (announcer) doc.root.append(announcer);
    announce("Saved", { within });
    win.flush();

    expect(heldBy(polite)).toEqual(["Saved"]);
  });

  it("judges a repeat per channel, so the same words on another channel are still spoken", () => {
    const { win, polite, within } = page();
    const spoken = spokenIn(polite);

    announce("Saved", { channel: "a", within });
    win.flush();
    announce("Saved", { channel: "b", within });
    win.flush();

    expect(spoken).toEqual(["Saved", "Saved"]);
  });
});

describe("announce — politeness", () => {
  it("speaks through the polite region by default", () => {
    const { win, polite, assertive, within } = page();

    announce("Saved", { within });
    win.flush();

    expect({ polite: heldBy(polite), assertive: heldBy(assertive) }).toEqual({ polite: ["Saved"], assertive: [] });
  });

  it("routes an assertive message to the assertive region alone", () => {
    const { win, polite, assertive, within } = page();

    announce("Payment declined", { politeness: "assertive", within });
    win.flush();

    expect({ polite: heldBy(polite), assertive: heldBy(assertive) }).toEqual({ polite: [], assertive: ["Payment declined"] });
  });
});

describe("announceToast", () => {
  it("speaks every toast of a burst, none dropped for a later one", () => {
    const { win, polite, within } = page();

    announceToast("Saved", within);
    announceToast("Invite sent", within);
    win.flush();

    expect(heldBy(polite)).toEqual(["Saved", "Invite sent"]);
  });

  it("is not cancelled by an app message on the default channel", () => {
    const { win, polite, within } = page();

    announceToast("Saved", within);
    announce("", { within });
    announce("Row 3 selected", { within });
    win.flush();

    expect(heldBy(polite)).toEqual(["Saved", "Row 3 selected"]);
  });

  it("speaks an identical toast again, because each one is a separate event", () => {
    const { win, polite, within } = page();
    const spoken = spokenIn(polite);

    announceToast("Saved", within);
    win.flush();
    announceToast("Saved", within);
    win.flush();

    expect(spoken).toEqual(["Saved", "Saved"]);
  });

  it("starts a fresh burst once the last one is spoken", () => {
    const { win, polite, within } = page();
    const spoken = spokenIn(polite);

    announceToast("Saved", within);
    win.flush();
    announceToast("Invite sent", within);
    win.flush();

    expect(spoken).toEqual(["Saved", "Invite sent"]);
  });

  it("is cancelled only by empty text on its own channel", () => {
    const { win, polite, within } = page();

    announceToast("Saved", within);
    announce("", { channel: ANNOUNCE_TOAST_CHANNEL, within });
    win.flush();

    expect(heldBy(polite)).toEqual([]);
  });
});

describe("announce — no Announcer", () => {
  it("does nothing and warns once per document, however often it is called", () => {
    const { doc } = fakeTree();
    const win = doc.defaultView;
    const within = doc as unknown as Node;

    announce("Saved", { within });
    announce("Saved again", { within, channel: "other" });

    expect({ timers: win.timers.size, warnings: warnings.length }).toEqual({ timers: 0, warnings: 1 });
    expect(warnings[0]).toContain("<Announcer />");
  });

  it("warns again for a second document, whose layout is a separate mistake", () => {
    announce("Saved", { within: fakeTree().doc as unknown as Node });
    announce("Saved", { within: fakeTree().doc as unknown as Node });

    expect(warnings.length).toBe(2);
  });

  it("stays silent for empty text, which asks for nothing to be spoken", () => {
    announce("", { within: fakeTree().doc as unknown as Node });

    expect(warnings).toEqual([]);
  });
});

/** A form whose first and second fields both failed. */
function failedForm(doc: FakeDocument, el: ReturnType<typeof fakeTree>["el"]): FakeElement {
  const form = el("FORM");
  const first = el("P", { "data-slot": "field-error" });
  first.textContent = "Enter an email address";
  const second = el("P", { "data-slot": "field-error" });
  second.textContent = "Choose a password";
  form.append(first, second);
  doc.root.append(form);
  return form;
}

describe("announceFieldError", () => {
  it("interrupts with the first error under the root, on the form-error channel", () => {
    const { doc, el, win, assertive, polite } = page();
    const form = failedForm(doc, el);

    announceFieldError(form as unknown as Element);
    announce("", { channel: ANNOUNCE_FORM_ERROR_CHANNEL, within: doc as unknown as Node });
    expect(win.timers.size).toBe(0);

    announceFieldError(form as unknown as Element);
    win.flush();
    expect({ assertive: heldBy(assertive), polite: heldBy(polite) }).toEqual({ assertive: ["Enter an email address"], polite: [] });
  });

  it("repeats an identical error, because a resubmission that fails the same way is news", () => {
    const { doc, el, win, assertive } = page();
    const form = failedForm(doc, el);
    const spoken = spokenIn(assertive);

    announceFieldError(form as unknown as Element);
    win.flush();
    announceFieldError(form as unknown as Element);
    win.flush();

    expect(spoken).toEqual(["Enter an email address", "Enter an email address"]);
  });

  it("finds an error that is itself the root, as a swapped-in error paragraph is", () => {
    const { el, win, assertive, doc } = page();
    const error = el("P", { "data-slot": "field-error" });
    error.textContent = "Too short";
    doc.root.append(error);

    announceFieldError(error as unknown as Element);
    win.flush();

    expect(heldBy(assertive)).toEqual(["Too short"]);
  });

  it("leaves a pending error alone when the new content holds none", () => {
    const { doc, el, win, assertive } = page();
    const form = failedForm(doc, el);

    announceFieldError(form as unknown as Element);
    announceFieldError(el("DIV") as unknown as Element);
    win.flush();

    expect(heldBy(assertive)).toEqual(["Enter an email address"]);
  });
});

describe("announceFailure", () => {
  /** A swapped-in fragment holding two failure panels, the first the one that speaks. */
  function failurePanels() {
    const setup = page();
    const fragment = setup
      .el("DIV")
      .append(
        setup.el("DIV", { [ANNOUNCE_FAILURE_ATTR]: "Could not read the log stream" }),
        setup.el("DIV", { [ANNOUNCE_FAILURE_ATTR]: "Could not load the next page" }),
      );
    setup.doc.root.append(fragment);
    return { ...setup, fragment };
  }

  it("interrupts with the first panel's message on the failure channel, never the polite region", () => {
    const { fragment, win, within, assertive, polite } = failurePanels();

    announceFailure(fragment as unknown as Element);
    announce("", { channel: ANNOUNCE_FAILURE_CHANNEL, within });
    expect(win.timers.size).toBe(0);

    announceFailure(fragment as unknown as Element);
    win.flush();
    expect({ assertive: heldBy(assertive), polite: heldBy(polite) }).toEqual({ assertive: ["Could not read the log stream"], polite: [] });
  });

  it("repeats an identical failure, because a retry that fails again is news", () => {
    const { fragment, win, assertive } = failurePanels();
    const spoken = spokenIn(assertive);

    announceFailure(fragment as unknown as Element);
    win.flush();
    announceFailure(fragment as unknown as Element);
    win.flush();

    expect(spoken).toEqual(["Could not read the log stream", "Could not read the log stream"]);
  });

  it("finds a panel that is itself the root, as a swapped-in row is", () => {
    const { el, win, assertive, doc } = page();
    const panel = el("TR", { [ANNOUNCE_FAILURE_ATTR]: "Could not load the next page" });
    doc.root.append(panel);

    announceFailure(panel as unknown as Element);
    win.flush();

    expect(heldBy(assertive)).toEqual(["Could not load the next page"]);
  });

  it("says nothing when the content holds no panel", () => {
    const { el, win } = page();

    announceFailure(el("DIV") as unknown as Element);

    expect(win.timers.size).toBe(0);
  });
});

describe("announceSpinner", () => {
  function spinners() {
    const setup = page();
    const hidden = setup.el("SPAN", { "data-slot": "spinner", class: "htmx-indicator" });
    hidden.textContent = "Loading results";
    const shown = setup.el("SPAN", { "data-slot": "spinner" });
    shown.textContent = "Saving draft";
    const region = setup.el("DIV").append(hidden, shown);
    setup.doc.root.append(region);
    return { ...setup, region };
  }

  const notAnIndicator = (spinner: Element) => spinner.closest(".htmx-indicator") === null;

  it("speaks the label of the first spinner the predicate accepts, politely on the busy channel", () => {
    const { region, win, polite } = spinners();

    announceSpinner(region as unknown as Element, notAnIndicator);
    win.flush();

    expect(heldBy(polite)).toEqual(["Saving draft"]);
  });

  it("is cancelled by the busy channel's empty message", () => {
    const { region, win, polite, within } = spinners();

    announceSpinner(region as unknown as Element, notAnIndicator);
    announce("", { channel: ANNOUNCE_BUSY_CHANNEL, within });
    win.flush();

    expect(heldBy(polite)).toEqual([]);
  });

  it("says nothing when no spinner is accepted", () => {
    const { region, win } = spinners();

    announceSpinner(region as unknown as Element, () => false);

    expect(win.timers.size).toBe(0);
  });
});
