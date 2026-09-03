import { describe, expect, it } from "bun:test";

import { mountInputFormat } from "./input-format";
import { type FakeElement, FakeEvent, fakeTree } from "./test-dom";

const CARD = "#### #### #### ####";

/** A formatted input attached to a document, plus the tree around it. */
function field(attrs: Record<string, string> = { "data-format": CARD }, value = "") {
  const { doc, el } = fakeTree();
  const input = el("INPUT", attrs);
  input.value = value;
  doc.root.append(input);
  return { doc, input };
}

const blur = (el: FakeElement) => el.dispatchEvent(new FakeEvent("focusout"));

/** Runs `fn` with `console.warn` captured, and answers what it warned. */
function warnings(fn: () => void): unknown[] {
  const captured: unknown[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => captured.push(args[0]);
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return captured;
}

describe("mountInputFormat", () => {
  it("regroups the value when focus leaves the field", () => {
    const { input } = field({ "data-format": CARD }, "4111111111111111");
    mountInputFormat(input as never);

    blur(input);

    expect(input.value).toBe("4111 1111 1111 1111");
  });

  it("formats a partially typed value with no trailing separator", () => {
    const { input } = field({ "data-format": CARD }, "41111");
    mountInputFormat(input as never);

    blur(input);

    expect(input.value).toBe("4111 1");
  });

  it("leaves an already formatted value untouched, so the first blur after SSR is a no-op", () => {
    const { input } = field({ "data-format": CARD }, "4111 1111 1111 1111");
    mountInputFormat(input as never);

    blur(input);

    expect(input.value).toBe("4111 1111 1111 1111");
  });

  it("dispatches neither input nor change, because the significant characters did not change", () => {
    const { input } = field({ "data-format": CARD }, "4111111111111111");
    const heard: string[] = [];
    input.addEventListener("input", () => heard.push("input"));
    input.addEventListener("change", () => heard.push("change"));
    mountInputFormat(input as never);

    blur(input);

    expect(heard).toEqual([]);
    expect(input.value).toBe("4111 1111 1111 1111");
  });

  it("refuses a bound control and warns exactly once, leaving the value untouched", () => {
    const { input } = field({ "data-format": CARD, "data-field": "card" }, "4111111111111111");

    const warned = warnings(() => {
      const dispose = mountInputFormat(input as never);
      blur(input);
      dispose();
    });

    expect(warned).toEqual(["[input-format] a control with data-field is bound to a signal and will not be formatted"]);
    expect(input.value).toBe("4111111111111111");
  });

  it("refuses a missing template and warns once", () => {
    const { input } = field({}, "4111111111111111");

    const warned = warnings(() => {
      mountInputFormat(input as never);
      blur(input);
    });

    expect(warned).toEqual(['[input-format] data-format="" declares no "#" slot; nothing will be formatted']);
    expect(input.value).toBe("4111111111111111");
  });

  it("refuses a slotless template and warns once", () => {
    const { input } = field({ "data-format": "--" }, "4111111111111111");

    const warned = warnings(() => {
      mountInputFormat(input as never);
      blur(input);
    });

    expect(warned).toEqual(['[input-format] data-format="--" declares no "#" slot; nothing will be formatted']);
    expect(input.value).toBe("4111111111111111");
  });

  it("installs exactly one listener and returns the same disposer when mounted twice", () => {
    const { input } = field({ "data-format": CARD }, "4111111111111111");

    const first = mountInputFormat(input as never);
    const second = mountInputFormat(input as never);

    expect(second).toBe(first);
    expect(input.listeners.get("focusout")?.length).toBe(1);
  });

  it("stops formatting once disposed, and removes its listener", () => {
    const { input } = field({ "data-format": CARD }, "4111111111111111");

    mountInputFormat(input as never)();
    blur(input);

    expect(input.value).toBe("4111111111111111");
    expect(input.listeners.get("focusout")?.length).toBe(0);
  });

  it("re-mounts after a disposal rather than reporting itself already mounted", () => {
    const { input } = field({ "data-format": CARD }, "4111111111111111");

    mountInputFormat(input as never)();
    mountInputFormat(input as never);
    blur(input);

    expect(input.value).toBe("4111 1111 1111 1111");
  });

  it("ignores a focusout from an unrelated element in the tree", () => {
    const { doc, input } = field({ "data-format": CARD }, "4111111111111111");
    const sibling = doc.createElement("INPUT");
    sibling.value = "9999";
    doc.root.append(sibling);
    mountInputFormat(input as never);

    // Retargeted at the sibling but delivered to the mounted root, which is what a bubbled
    // `focusout` from a wrapper's other child looks like.
    const event = new FakeEvent("focusout");
    event.target = sibling;
    input.dispatchEvent(event);

    expect(input.value).toBe("4111111111111111");
  });

  it("retires itself with one warning when the control's type refuses the formatted value", () => {
    const { input } = field({ "data-format": CARD }, "4111111111111111");
    // What `type="number"` does to a value carrying separators: it sanitises the assignment to "".
    Object.defineProperty(input, "value", {
      get(this: { stored: string }) {
        return this.stored ?? "4111111111111111";
      },
      set(this: { stored: string }, next: string) {
        this.stored = /\s/.test(next) ? "" : next;
      },
    });
    mountInputFormat(input as never);

    const warned = warnings(() => {
      blur(input);
      blur(input);
    });

    expect(warned).toEqual(["[input-format] this control's type refuses a formatted value; formatting is disabled for it"]);
    expect(input.listeners.get("focusout")?.length).toBe(0);
  });
});
