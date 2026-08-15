import { describe, expect, it } from "bun:test";
import { mountNumberField } from "./number-field";
import { type FakeElement, FakeEvent, fakeTree } from "./test-dom";

/** A number field whose input records the steps taken on it, since a fake has no value algorithm. */
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
  input.stepUp = () => input.steps.push(1);
  input.stepDown = () => input.steps.push(-1);
  input.disabled = inputAttrs.disabled !== undefined;
  input.readOnly = inputAttrs.readonly !== undefined;
  root.append(dec, input, inc);
  doc.root.append(root);
  return { doc, root, dec, inc, input };
}

const click = (el: FakeElement) => el.dispatchEvent(new FakeEvent("click"));

describe("mountNumberField", () => {
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
