import { describe, expect, it } from "bun:test";

import { isDisabled, isNativeInput, leavesRing, mountRovingFocus } from "./composite";
import { FakeEvent, fakeTree } from "./dom.fixture";
import type { FakeElement } from "./dom.fixture";

const target = (props: Record<string, unknown>) => ({ nodeType: 1, ...props }) as unknown as EventTarget;

describe("isNativeInput", () => {
  it("claims a textarea outright", () => {
    expect(isNativeInput(target({ tagName: "TEXTAREA" }))).toBe(true);
  });

  it("claims a text field whose caret sits at the very start", () => {
    // `0` is falsy, so a truthiness test here hands a caret-at-start field's arrow keys to the
    // composite and the user cannot move within their own input.
    expect(isNativeInput(target({ tagName: "INPUT", selectionStart: 0 }))).toBe(true);
  });

  it("claims a text field with the caret anywhere else", () => {
    expect(isNativeInput(target({ tagName: "INPUT", selectionStart: 5 }))).toBe(true);
  });

  it("leaves an input with no caret to the composite", () => {
    expect(isNativeInput(target({ tagName: "INPUT", selectionStart: null }))).toBe(false);
  });

  it("rejects a non-input element, a text node and null", () => {
    expect(isNativeInput(target({ tagName: "DIV" }))).toBe(false);
    expect(isNativeInput({ nodeType: 3, tagName: "INPUT" } as unknown as EventTarget)).toBe(false);
    expect(isNativeInput(null)).toBe(false);
  });
});

describe("isDisabled", () => {
  it("is false for a plain enabled element", () => {
    const { el } = fakeTree();
    expect(isDisabled(el("BUTTON") as unknown as HTMLElement)).toBe(false);
  });

  it("reads the disabled property", () => {
    const { el } = fakeTree();
    const button = el("BUTTON");
    button.disabled = true;
    expect(isDisabled(button as unknown as HTMLElement)).toBe(true);
  });

  it("reads aria-disabled, so a focusable-but-inert item still counts", () => {
    const { el } = fakeTree();
    expect(isDisabled(el("BUTTON", { "aria-disabled": "true" }) as unknown as HTMLElement)).toBe(true);
  });

  // Where the predicates part company: `isDisabled` answers "may this be activated" and `leavesRing`
  // answers "may arrow keys reach it", and `aria-disabled` is exactly the case that separates them.
  it("keeps an aria-disabled item in the ring while still calling it inert", () => {
    const { el } = fakeTree();
    const item = el("BUTTON", { "aria-disabled": "true" }) as unknown as HTMLElement;

    expect(isDisabled(item)).toBe(true);
    expect(leavesRing(item)).toBe(false);
  });

  it("takes a natively disabled item out of the ring", () => {
    const { el } = fakeTree();
    const item = el("BUTTON");
    (item as unknown as { disabled: boolean }).disabled = true;

    expect(leavesRing(item as unknown as HTMLElement)).toBe(true);
  });

  it("treats aria-disabled='false' as enabled", () => {
    const { el } = fakeTree();
    expect(isDisabled(el("BUTTON", { "aria-disabled": "false" }) as unknown as HTMLElement)).toBe(false);
  });

  it("ignores a disabled property that is not exactly true", () => {
    const { el } = fakeTree();
    const item = el("DIV");
    (item as unknown as { disabled: unknown }).disabled = "";
    expect(isDisabled(item as unknown as HTMLElement)).toBe(false);
  });
});

// The typeahead buffer timer is the one handle `mountRovingFocus` arms outside an observer, and a
// disposer that stopped clearing it would leave one pending timer per composite an HTMX swap retires.
describe("mountRovingFocus — the typeahead buffer timer", () => {
  function ring() {
    const { doc, el } = fakeTree();
    const root = el("DIV", { role: "menu" });
    const rows = ["alpha", "beta"].map((name) => {
      const row = el("BUTTON", { role: "menuitem", id: name });
      row.textContent = name;
      root.append(row);
      return row;
    });
    doc.root.append(root);
    return { win: doc.defaultView, root, rows };
  }

  const mount = (root: FakeElement) => mountRovingFocus(root as never, { items: "[role='menuitem']", typeahead: true });

  it("arms one timer when a printable key reaches the typeahead", () => {
    const { win, root } = ring();
    mount(root);

    root.dispatchEvent(new FakeEvent("keydown", { key: "b" }));

    expect(win.timers.size).toBe(1);
  });

  it("clears that timer on dispose rather than leaving it pending", () => {
    const { win, root } = ring();
    const dispose = mount(root);

    root.dispatchEvent(new FakeEvent("keydown", { key: "b" }));
    dispose();

    expect(win.timers.size).toBe(0);
  });
});
