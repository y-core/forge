import { describe, expect, it } from "bun:test";

import { isChosen, paintControl, readControl } from "./bind";
import { fakeTree } from "./test-dom";

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
