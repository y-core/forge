import { describe, expect, it } from "bun:test";

import { bindControls, isChosen, paintControl, readControl } from "./bind";
import { FakeEvent, fakeTree, installCssEscape } from "./dom.fixture";
import type { FakeElement } from "./dom.fixture";
import { createSignal } from "./signal";

installCssEscape();

type Control = Parameters<typeof readControl>[0];

/** A button surrogate: it carries `data-value` and ARIA state, and has no `checked` of its own. */
function surrogate(value?: string) {
  const attrs = new Map<string, string>();
  return {
    dataset: value === undefined ? {} : { value },
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, next: string) => attrs.set(name, next),
    hasAttribute: (name: string) => attrs.has(name),
    toggleAttribute: (name: string, force: boolean) => (force ? attrs.set(name, "") : attrs.delete(name)),
    attrs,
  };
}

/** A `<select multiple>` carrying `values`, with `selected` chosen. */
function multiSelect(values: string[], selected: string[]): Control {
  const options = values.map((value) => ({ value, selected: selected.includes(value) }));
  return {
    tagName: "SELECT",
    dataset: {},
    multiple: true,
    options,
    get selectedOptions() {
      return options.filter((option) => option.selected);
    },
    value: selected[0] ?? "",
  } as unknown as Control;
}

const checkbox = (value: string, checked: boolean) => {
  const { el } = fakeTree();
  const input = el("INPUT", { "data-value": value });
  input.checked = checked;
  return input as unknown as Control;
};

describe("readControl", () => {
  it("leaves a multi-select untouched when the control carries no data-value", () => {
    const current = ["a"];
    const { el } = fakeTree();
    expect(readControl(el("INPUT") as unknown as Control, current)).toBe(current);
  });

  it("adds and removes membership from a real checkbox's own checkedness", () => {
    expect(readControl(checkbox("b", true), ["a"])).toEqual(["a", "b"]);
    expect(readControl(checkbox("b", false), ["a", "b"])).toEqual(["a"]);
  });

  it("returns the same array when a checked box is already a member, so no repaint is provoked", () => {
    const current = ["a", "b"];
    expect(readControl(checkbox("b", true), current)).toBe(current);
  });

  it("is idempotent across the input, change and click a single interaction fires", () => {
    // One interaction on an input fires all three events; a membership *flip* would run three times
    // and land back where it started, so the reading has to be stable under repetition.
    for (const [checked, start] of [
      [true, ["a"]],
      [false, ["a", "b"]],
    ] as const) {
      const once = readControl(checkbox("b", checked), start);
      const twice = readControl(checkbox("b", checked), once);
      const thrice = readControl(checkbox("b", checked), twice);
      expect(thrice).toEqual(once as string[]);
    }
  });

  it("flips membership for a surrogate that has no checkedness to read", () => {
    expect(readControl(surrogate("b") as unknown as Control, ["a"])).toEqual(["a", "b"]);
    expect(readControl(surrogate("b") as unknown as Control, ["a", "b"])).toEqual(["a"]);
  });

  it("reads a plain boolean from the control, and a tagged one as always chosen", () => {
    expect(readControl(checkbox("", true), false)).toBe(true);
    const { el } = fakeTree();
    const plain = el("INPUT");
    plain.checked = true;
    expect(readControl(plain as unknown as Control, false)).toBe(true);
    plain.checked = false;
    expect(readControl(plain as unknown as Control, true)).toBe(false);
  });

  it("coerces to the type the signal already holds", () => {
    const { el } = fakeTree();
    const numeric = el("INPUT", { "data-value": "42" });
    expect(readControl(numeric as unknown as Control, 0)).toBe(42);
    const text = el("INPUT");
    text.value = "hello";
    expect(readControl(text as unknown as Control, "")).toBe("hello");
  });

  it("reports NaN rather than 0 for a numeric field the reader has emptied", () => {
    const { el } = fakeTree();
    const numeric = el("INPUT");
    numeric.value = "";
    expect(readControl(numeric as unknown as Control, 7)).toBeNaN();
    numeric.value = "   ";
    expect(readControl(numeric as unknown as Control, 7)).toBeNaN();
  });

  it("reports NaN for an unparseable number, leaving the signal a number", () => {
    const { el } = fakeTree();
    const numeric = el("INPUT");
    for (const partial of ["-", "e", "1.2.3"]) {
      numeric.value = partial;
      expect(readControl(numeric as unknown as Control, 7)).toBeNaN();
    }
  });

  it("reads a multi-select from its selected options, which carry no data-value", () => {
    expect(readControl(multiSelect(["a", "b", "c"], ["b", "c"]), ["a"])).toEqual(["b", "c"]);
    expect(readControl(multiSelect(["a", "b"], []), ["a"])).toEqual([]);
  });
});

describe("isChosen", () => {
  it("tests membership for a multi-select and equality for a single one", () => {
    expect(isChosen(surrogate("b") as unknown as Control, ["a", "b"])).toBe(true);
    expect(isChosen(surrogate("c") as unknown as Control, ["a", "b"])).toBe(false);
    expect(isChosen(surrogate("b") as unknown as Control, "b")).toBe(true);
    expect(isChosen(surrogate("b") as unknown as Control, "a")).toBe(false);
  });

  it("compares a number against the attribute's string form", () => {
    expect(isChosen(surrogate("5") as unknown as Control, 5)).toBe(true);
  });

  it("treats a control with no data-value as tagged with the empty string", () => {
    expect(isChosen(surrogate() as unknown as Control, "")).toBe(true);
  });
});

describe("paintControl", () => {
  it("paints ARIA and state attributes onto a surrogate, which owns no checkedness", () => {
    const item = surrogate("b");
    paintControl(item as unknown as Control, ["b"]);
    expect(item.getAttribute("aria-pressed")).toBe("true");
    expect(item.hasAttribute("data-pressed")).toBe(true);
    paintControl(item as unknown as Control, ["a"]);
    expect(item.getAttribute("aria-pressed")).toBe("false");
    expect(item.hasAttribute("data-pressed")).toBe(false);
  });

  it("paints a real input's checkedness and leaves its ARIA alone", () => {
    const input = checkbox("b", false);
    paintControl(input, ["b"]);
    expect((input as unknown as { checked: boolean }).checked).toBe(true);
    expect((input as unknown as { getAttribute: (n: string) => string | null }).getAttribute("aria-pressed")).toBe(null);
  });

  it("skips a write that would not change the value, which would reset a drag mid-interaction", () => {
    let writes = 0;
    const range = { dataset: {}, value: "50" } as unknown as Control;
    Object.defineProperty(range, "value", {
      get: () => "50",
      set: () => {
        writes += 1;
      },
    });
    paintControl(range, 50);
    expect(writes).toBe(0);
    paintControl(range, 60);
    expect(writes).toBe(1);
  });

  it("paints a boolean signal onto an untagged control", () => {
    const { el } = fakeTree();
    const input = el("INPUT");
    paintControl(input as unknown as Control, true);
    expect(input.checked).toBe(true);
    paintControl(input as unknown as Control, false);
    expect(input.checked).toBe(false);
  });

  it("writes nothing to a file input, whose value setter throws for anything but the empty string", () => {
    let writes = 0;
    const file = { tagName: "INPUT", type: "file", dataset: {} } as unknown as Control;
    Object.defineProperty(file, "value", {
      get: () => "",
      set: () => {
        writes += 1;
        throw new Error("InvalidStateError");
      },
    });
    expect(() => paintControl(file, "C:\\fakepath\\a.txt")).not.toThrow();
    expect(writes).toBe(0);
  });

  it("leaves a numeric field alone while its value is NaN, so a cleared field is not refilled", () => {
    let writes = 0;
    const numeric = { dataset: {} } as unknown as Control;
    Object.defineProperty(numeric, "value", {
      get: () => "",
      set: () => {
        writes += 1;
      },
    });
    paintControl(numeric, Number.NaN);
    paintControl(numeric, Number.POSITIVE_INFINITY);
    expect(writes).toBe(0);
    paintControl(numeric, 3);
    expect(writes).toBe(1);
  });

  it("leaves a half-typed number in place, comparing numerically rather than as a string", () => {
    let writes = 0;
    const numeric = { dataset: {} } as unknown as Control;
    Object.defineProperty(numeric, "value", {
      get: () => "1.",
      set: () => {
        writes += 1;
      },
    });
    paintControl(numeric, 1);
    expect(writes).toBe(0);
    paintControl(numeric, 2);
    expect(writes).toBe(1);
  });

  it("paints an array onto a multi-select per option, never as one comma-joined value", () => {
    const select = multiSelect(["a", "b", "c"], ["a"]);
    let writes = 0;
    Object.defineProperty(select, "value", {
      get: () => "a",
      set: () => {
        writes += 1;
      },
    });
    paintControl(select, ["b", "c"]);
    expect((select as unknown as { options: Array<{ value: string; selected: boolean }> }).options).toEqual([
      { value: "a", selected: false },
      { value: "b", selected: true },
      { value: "c", selected: true },
    ]);
    expect(writes).toBe(0);
  });
});

// A native form reset reverts controls without firing `input`, so a document-level `reset` listener
// is the only thing that notices — and the only listener this controller puts outside `root`.
describe("bindControls — mounting and disposing", () => {
  function scope() {
    const { doc, el } = fakeTree();
    const form = el("FORM");
    const root = el("DIV");
    const input = el("INPUT", { "data-field": "name" });
    form.children.push(root);
    root.parent = form;
    root.children.push(input);
    input.parent = root;
    doc.body.children.push(form);
    form.parent = doc.body;
    return { doc, form, root, input };
  }

  const count = (target: { listeners: Map<string, unknown[]> }, type: string): number => target.listeners.get(type)?.length ?? 0;

  it("listens on the root for every interaction, and on the document for a form reset", () => {
    const { doc, root } = scope();

    bindControls(root as unknown as HTMLElement, { name: createSignal("ada") });

    expect({ input: count(root, "input"), change: count(root, "change"), click: count(root, "click"), reset: count(doc, "reset") }).toEqual({
      input: 1,
      change: 1,
      click: 1,
      reset: 1,
    });
  });

  it("repaints from the signals a microtask after a form reset has reverted the controls", async () => {
    const { doc, form, root, input } = scope();
    bindControls(root as unknown as HTMLElement, { name: createSignal("ada") });
    input.value = "";

    doc.dispatchEvent(new FakeEvent("reset", { target: form }));
    await Promise.resolve();

    expect(input.value).toBe("ada");
  });

  it("removes every listener on dispose, the document-level one included", () => {
    const { doc, root } = scope();

    bindControls(root as unknown as HTMLElement, { name: createSignal("ada") })();

    expect({ input: count(root, "input"), change: count(root, "change"), click: count(root, "click"), reset: count(doc, "reset") }).toEqual({
      input: 0,
      change: 0,
      click: 0,
      reset: 0,
    });
  });

  it("stops repainting on a reset once disposed, so the disposed listener is gone rather than inert", async () => {
    const { doc, form, root, input } = scope();
    bindControls(root as unknown as HTMLElement, { name: createSignal("ada") })();
    input.value = "";

    doc.dispatchEvent(new FakeEvent("reset", { target: form }));
    await Promise.resolve();

    expect(input.value).toBe("");
  });
});

// Discovery costs a `querySelectorAll("*")` per tree and `paintField` runs per changed field per
// effect, i.e. per pointermove frame. Counting the walk is the only way to see it stop happening.
describe("bindControls — the shadow-root walk on the paint path", () => {
  function counted() {
    const { doc, el } = fakeTree();
    const root = el("DIV");
    const input = el("INPUT", { "data-field": "name" });
    root.children.push(input);
    input.parent = root;
    doc.body.children.push(root);
    root.parent = doc.body;

    const walks = { count: 0 };
    for (const node of [root, input]) {
      const query = node.querySelectorAll.bind(node);
      node.querySelectorAll = (selector: string) => {
        if (selector === "*") walks.count += 1;
        return query(selector);
      };
    }
    return { root, input, walks };
  }

  it("walks for shadow roots once at mount rather than once per paint", () => {
    const { root, walks } = counted();
    const name = createSignal("ada");
    bindControls(root as unknown as HTMLElement, { name });
    const atMount = walks.count;

    for (const value of ["a", "b", "c", "d", "e"]) name.value = value;

    expect({ atMount, afterFivePaints: walks.count }).toEqual({ atMount: 1, afterFivePaints: 1 });
  });

  // The one case the cache loses — a shadow root attached after mount — and what recovers it.
  it("walks again when a field matches nothing, so a tree attached after mount is still found", () => {
    const { root, input, walks } = counted();
    const name = createSignal("ada");
    bindControls(root as unknown as HTMLElement, { name });
    input.remove();
    const before = walks.count;

    name.value = "grace";

    expect(walks.count).toBe(before + 1);
  });
});

// A detached shadow root still answers `querySelectorAll`, so the stale hit looks exactly like a
// live one and the no-match fallback never fires — the swapped-in control keeps its old value.
describe("bindControls — a shadow host replaced after mount", () => {
  function hosted(doc: ReturnType<typeof fakeTree>["doc"], el: ReturnType<typeof fakeTree>["el"], root: FakeElement) {
    const host = el("QTY-FIELD");
    const shadow = el();
    const input = el("INPUT", { "data-field": "qty" });
    shadow.append(input);
    host.shadowRoot = shadow;
    root.append(host);
    void doc;
    return { host, input };
  }

  it("paints the new host's control and leaves the detached one behind", () => {
    const { doc, el } = fakeTree();
    const root = el("DIV");
    doc.body.append(root);
    // A light-DOM match as well, so `found.length` stays non-zero and only staleness can trigger
    // the re-walk. This is the case the task's first fix accepted as lost.
    root.append(el("INPUT", { "data-field": "qty" }));
    const first = hosted(doc, el, root);

    const qty = createSignal("1");
    bindControls(root as unknown as HTMLElement, { qty });
    expect(first.input.value).toBe("1");

    first.host.remove();
    const second = hosted(doc, el, root);
    qty.value = "7";

    expect({ live: second.input.value, detached: first.input.value }).toEqual({ live: "7", detached: "1" });
  });

  it("leaves a host that is still attached in the cache, so the walk is not re-run for nothing", () => {
    const { doc, el } = fakeTree();
    const root = el("DIV");
    doc.body.append(root);
    const only = hosted(doc, el, root);

    const qty = createSignal("1");
    bindControls(root as unknown as HTMLElement, { qty });
    const walks: string[] = [];
    const query = root.querySelectorAll.bind(root);
    root.querySelectorAll = (selector: string) => {
      walks.push(selector);
      return query(selector);
    };

    qty.value = "7";

    expect({ painted: only.input.value, stars: walks.filter((selector) => selector === "*").length }).toEqual({ painted: "7", stars: 0 });
  });
});
