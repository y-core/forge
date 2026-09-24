import { describe, expect, it } from "bun:test";

import { isDisabled, isNativeInput, leavesRing, mountRovingFocus } from "./composite";
import { FakeEvent, fakeTree } from "./dom.fixture";
import type { FakeElement } from "./dom.fixture";

const target = (props: Record<string, unknown>) => ({ nodeType: 1, ...props }) as unknown as EventTarget;

describe("isNativeInput", () => {
  it("claims a textarea outright", () => {
    expect(isNativeInput(target({ tagName: "TEXTAREA" }))).toBe(true);
  });

  it("claims a text field whatever its type, including one with no selection API at all", () => {
    for (const type of ["text", "search", "email", "number", "date", "time", "range", undefined]) {
      expect([type, isNativeInput(target({ tagName: "INPUT", type }))]).toEqual([type, true]);
    }
  });

  // `color` edits no text and wants no arrows, so the ring keeps them; `range` edits no text either
  // and does want them, which is why the list decides arrow ownership rather than text-ness.
  it("leaves the arrows to the ring for the types that have no use for them", () => {
    for (const type of ["checkbox", "radio", "button", "submit", "reset", "image", "file", "hidden", "color"]) {
      expect([type, isNativeInput(target({ tagName: "INPUT", type }))]).toEqual([type, false]);
    }
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

// A key the innermost ring could not place still belongs to it, so the typeahead consumes every
// printable key — except on a descendant that spends printable keys itself.
describe("mountRovingFocus — what the typeahead refuses to swallow", () => {
  /** A typeahead ring holding two ordinary rows, plus `extra` wherever the case wants it. */
  function ring(extra: (el: (tag: string, attrs?: Record<string, string>) => FakeElement, root: FakeElement) => FakeElement) {
    const { doc, el } = fakeTree();
    const root = el("DIV", { role: "menu" });
    for (const name of ["alpha", "beta"]) {
      const row = el("BUTTON", { role: "menuitem", id: name });
      row.textContent = name;
      root.append(row);
    }
    const focused = extra(el, root);
    doc.root.append(root);
    mountRovingFocus(root as never, { items: "[role='menuitem']", typeahead: true });
    return { root, focused };
  }

  const press = (root: FakeElement, on: FakeElement, key: string) => {
    const event = new FakeEvent("keydown", { key, target: on });
    root.dispatchEvent(event);
    return event.defaultPrevented;
  };

  const cases: Array<[string, Record<string, string>]> = [
    ["a <select>, which runs a typeahead of its own", { role: "menuitem" }],
    ["a contenteditable region", { role: "menuitem", contenteditable: "true" }],
  ];

  for (const [what, attrs] of cases) {
    const tag = attrs.contenteditable ? "DIV" : "SELECT";

    it(`leaves a printable key to ${what} rendered as an item`, () => {
      const { root, focused } = ring((el, parent) => {
        const item = el(tag, attrs);
        parent.append(item);
        return item;
      });

      expect(press(root, focused, "a")).toBe(false);
    });

    it(`leaves a printable key to ${what} nested inside an item`, () => {
      const { root, focused } = ring((el, parent) => {
        const row = el("BUTTON", { role: "menuitem", id: "host" });
        const inner = el(tag, attrs.contenteditable ? { contenteditable: "true" } : {});
        row.append(inner);
        parent.append(row);
        return inner;
      });

      expect(press(root, focused, "a")).toBe(false);
    });
  }

  it("consumes the key on an ordinary row whether or not a label matched", () => {
    const { root } = ring((_el, parent) => parent);
    const row = root.querySelector("#alpha") as FakeElement;

    expect([press(root, row, "b"), press(root, row, "z")]).toEqual([true, true]);
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
