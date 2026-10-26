import { describe, expect, it } from "bun:test";

import { FakeEvent, fakeTree } from "./dom.fixture";
import type { FakeElement } from "./dom.fixture";
import { mountFilter } from "./filter";

function filter(chips: Array<{ id: string; checked?: boolean; disabled?: boolean }>) {
  const { doc, el } = fakeTree();
  const root = el("FORM", { "data-slot": "filter", "data-scope": "filter" });
  const glyph = el("SPAN", { "aria-hidden": "true" });
  const reset = el("BUTTON", { "data-slot": "filter-reset", id: "reset" }).append(glyph);
  const group = el("DIV", { role: "radiogroup", "data-slot": "filter-group" });
  const events: string[] = [];
  const inputs: Record<string, FakeElement> = {};
  for (const chip of chips) {
    const input = el("INPUT", { "data-slot": "filter-input", type: "radio", name: "f", id: chip.id });
    input.checked = chip.checked ?? false;
    input.disabled = chip.disabled ?? false;
    for (const type of ["input", "change"]) {
      input.addEventListener(type, (event) => events.push(`${chip.id}:${event.type}:${String((event as unknown as Event).bubbles)}`));
    }
    inputs[chip.id] = input;
    group.append(el("LABEL", { "data-slot": "filter-item" }).append(input));
  }
  root.append(reset, group);
  doc.root.append(root);
  const dispose = mountFilter(root as never);
  const click = (target: FakeElement, on: FakeElement = target) => {
    const event = new FakeEvent("click", { target });
    on.dispatchEvent(event);
    return event;
  };
  const checked = () => Object.values(inputs).map((input) => input.checked);
  return { doc, el, root, reset, glyph, inputs, events, dispose, click, checked };
}

describe("mountFilter", () => {
  it("a click on the reset is not a form reset: it clears the server-checked chip, fires input then change on it, and focuses the first chip", () => {
    const { doc, reset, events, click, checked } = filter([{ id: "a" }, { id: "b", checked: true }, { id: "c" }]);

    const event = click(reset);

    expect({ prevented: event.defaultPrevented, checked: checked(), events, focused: doc.activeElement?.id }).toEqual({
      prevented: true,
      checked: [false, false, false],
      events: ["b:input:true", "b:change:true"],
      focused: "a",
    });
  });

  it("a click on the glyph inside the reset clears as the reset itself does", () => {
    const { glyph, click, checked } = filter([{ id: "a", checked: true }, { id: "b" }]);

    const event = click(glyph);

    expect({ prevented: event.defaultPrevented, checked: checked() }).toEqual({ prevented: true, checked: [false, false] });
  });

  it("focus skips a disabled first chip and lands on the first one a user can operate", () => {
    const { doc, reset, click } = filter([{ id: "a", disabled: true }, { id: "b", checked: true }, { id: "c" }]);

    click(reset);

    expect(doc.activeElement?.id).toBe("b");
  });

  it("leaves focus where it was when every chip is disabled", () => {
    const { doc, reset, click } = filter([
      { id: "a", disabled: true },
      { id: "b", disabled: true },
    ]);
    reset.focus();

    click(reset);

    expect(doc.activeElement?.id).toBe("reset");
  });

  it("with nothing checked dispatches no event yet still moves focus to the first chip", () => {
    const { doc, reset, events, click } = filter([{ id: "a" }, { id: "b" }]);

    const event = click(reset);

    expect({ prevented: event.defaultPrevented, events, focused: doc.activeElement?.id }).toEqual({ prevented: true, events: [], focused: "a" });
  });

  it("a click on a chip or elsewhere in the filter is left to the platform", () => {
    const { doc, root, inputs, events, click, checked } = filter([{ id: "a" }, { id: "b", checked: true }]);

    const onChip = click(inputs.a as FakeElement);
    const onRoot = click(root);

    expect({ prevented: [onChip.defaultPrevented, onRoot.defaultPrevented], checked: checked(), events, focused: doc.activeElement }).toEqual({
      prevented: [false, false],
      checked: [false, true],
      events: [],
      focused: null,
    });
  });

  it("ignores a reset button outside its own root, even when the click reaches the root", () => {
    const { doc, el, root, events, click, checked } = filter([{ id: "a" }, { id: "b", checked: true }]);
    const foreign = el("BUTTON", { "data-slot": "filter-reset" });
    doc.root.append(foreign);

    const event = click(foreign, root);

    expect({ prevented: event.defaultPrevented, checked: checked(), events }).toEqual({ prevented: false, checked: [false, true], events: [] });
  });

  it("clears only its own chips when two filters share a page", () => {
    const first = filter([{ id: "a", checked: true }]);
    const second = filter([{ id: "a", checked: true }]);

    first.click(first.reset);

    expect([first.checked(), second.checked()]).toEqual([[false], [true]]);
  });

  it("after the disposer runs a reset click is no longer intercepted and the chip stays checked", () => {
    const { reset, events, dispose, click, checked } = filter([{ id: "a" }, { id: "b", checked: true }]);

    dispose();
    const event = click(reset);

    expect({ prevented: event.defaultPrevented, checked: checked(), events }).toEqual({ prevented: false, checked: [false, true], events: [] });
  });
});
