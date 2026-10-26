import { describe, expect, it } from "bun:test";

import { FakeEvent, fakeTree } from "./dom.fixture";
import type { FakeElement } from "./dom.fixture";
import { mountNumberField } from "./number-field";

/** A number field whose input records each native step and refuses `step="any"` as the platform does. */
function field(inputAttrs: Record<string, string> = {}) {
  const { doc, el } = fakeTree();
  const root = el("DIV", { "data-slot": "number-field" });
  const dec = el("BUTTON", { "data-slot": "number-field-decrement", id: "dec" });
  const input = el("INPUT", { "data-slot": "number-field-input", id: "n", ...inputAttrs }) as FakeElement & {
    steps: number[];
    stepUp: () => void;
    stepDown: () => void;
  };
  const inc = el("BUTTON", { "data-slot": "number-field-increment", id: "inc" });
  input.steps = [];
  input.value = inputAttrs.value ?? "";
  const refuseAny = () => {
    if (input.getAttribute("step")?.toLowerCase() === "any") throw new DOMException("step is any", "InvalidStateError");
  };
  input.stepUp = () => {
    refuseAny();
    input.steps.push(1);
  };
  input.stepDown = () => {
    refuseAny();
    input.steps.push(-1);
  };
  input.disabled = inputAttrs.disabled !== undefined;
  input.readOnly = inputAttrs.readonly !== undefined;
  root.append(dec, input, inc);
  doc.root.append(root);
  return { doc, root, dec, inc, input };
}

const click = (el: FakeElement) => el.dispatchEvent(new FakeEvent("click"));

describe("mountNumberField", () => {
  // APG's Spinbutton keeps focus on the field throughout, which is also the only announcement there
  // is: a reader left on the button hears nothing of the value that changed.
  it("hands focus back to the field after a step, wherever the press came from", () => {
    const { doc, root, inc } = field();
    const dispose = mountNumberField(root as never);

    click(inc);
    dispose();

    expect(doc.activeElement?.id).toBe("n");
  });

  it("steps the input up and down from the two buttons", () => {
    const { root, dec, inc, input } = field();
    mountNumberField(root as never);

    click(inc);
    click(dec);

    expect(input.steps).toEqual([1, -1]);
  });

  it("leaves both buttons enabled while the input is live", () => {
    const { root, dec, inc } = field();
    mountNumberField(root as never);

    expect([dec.disabled, inc.disabled]).toEqual([false, false]);
  });

  it("disables both buttons when the input is disabled, rather than leaving them looking live", () => {
    const { root, dec, inc } = field({ disabled: "" });
    mountNumberField(root as never);

    expect([dec.disabled, inc.disabled]).toEqual([true, true]);
  });

  it("disables them for a read-only input too, which has no attribute of its own on a button", () => {
    const { root, inc } = field({ readonly: "" });
    mountNumberField(root as never);

    expect(inc.disabled).toBe(true);
  });

  it("does not step a disabled input even if a click reaches the button anyway", () => {
    const { root, inc, input } = field({ disabled: "" });
    mountNumberField(root as never);

    click(inc);

    expect(input.steps).toEqual([]);
  });

  it("steps up for an increment button carrying a second slot token", () => {
    const { root, inc, input } = field();
    inc.setAttribute("data-slot", "number-field-increment rail-tool");
    mountNumberField(root as never);

    click(inc);

    expect(input.steps).toEqual([1]);
  });

  it("ignores a click that resolves to no stepper", () => {
    const { root, input } = field();
    mountNumberField(root as never);

    click(root);

    expect(input.steps).toEqual([]);
  });

  it("stops listening once disposed", () => {
    const { root, inc, input } = field();
    mountNumberField(root as never)();

    click(inc);

    expect(input.steps).toEqual([]);
  });

  it("survives a field with no input at all", () => {
    const { doc, el } = fakeTree();
    const root = el("DIV", { "data-slot": "number-field" });
    root.append(el("BUTTON", { "data-slot": "number-field-increment", id: "inc" }));
    doc.root.append(root);

    expect(() => mountNumberField(root as never)()).not.toThrow();
  });
});

describe('step="any"', () => {
  function anyField(inputAttrs: Record<string, string>) {
    const parts = field({ step: "any", ...inputAttrs });
    const events: string[] = [];
    for (const type of ["input", "change"]) parts.input.addEventListener(type, (event) => events.push(event.type));
    mountNumberField(parts.root as never);
    return { ...parts, events };
  }

  it("increments 1.5 to 2.5 without throwing, firing input then change and taking no native step", () => {
    const { inc, input, events } = anyField({ value: "1.5" });

    expect(() => click(inc)).not.toThrow();

    expect({ value: input.value, events, steps: input.steps }).toEqual({ value: "2.5", events: ["input", "change"], steps: [] });
  });

  const cases = [
    { name: "decrements 1.5 to 0.5", attrs: { value: "1.5" }, button: "dec", expected: "0.5" },
    { name: "clamps an increment past max to max", attrs: { value: "2.5", max: "3" }, button: "inc", expected: "3" },
    { name: "clamps a decrement past min to min", attrs: { value: "0.5", min: "0" }, button: "dec", expected: "0" },
    { name: "never moves a value already above max downward on an increment", attrs: { value: "5", max: "2" }, button: "inc", expected: "5" },
    { name: "starts an empty field from 0 and clamps it to min", attrs: { min: "3" }, button: "inc", expected: "3" },
    { name: "cleans the float residue off -0.9 + 1", attrs: { value: "-0.9" }, button: "inc", expected: "0.1" },
    { name: "matches the keyword ASCII case-insensitively", attrs: { value: "1", step: "ANY" }, button: "inc", expected: "2" },
  ];

  for (const { name, attrs, button, expected } of cases) {
    it(name, () => {
      const parts = anyField(attrs);

      click(button === "inc" ? parts.inc : parts.dec);

      expect(parts.input.value).toBe(expected);
    });
  }

  it("hands focus back to the field after an any step", () => {
    const { doc, inc } = anyField({ value: "1.5" });

    click(inc);

    expect(doc.activeElement?.id).toBe("n");
  });
});
