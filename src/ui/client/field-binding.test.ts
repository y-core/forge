import { describe, expect, it } from "bun:test";
import { applyControlValue, bindField, parseControlValue } from "./field-binding";
import type { ResumeContext } from "./resume";
import { signalRecord } from "./signal-record";

describe("parseControlValue", () => {
  it("reads `checked` when the target value is a boolean", () => {
    expect(parseControlValue({ checked: true, value: "" }, false)).toBe(true);
    expect(parseControlValue({ checked: false, value: "" }, true)).toBe(false);
  });

  it("reads Number(value) when the target value is a number", () => {
    expect(parseControlValue({ checked: false, value: "90" }, 0)).toBe(90);
    expect(parseControlValue({ checked: false, value: "-2.5" }, 1)).toBe(-2.5);
  });

  it("reads the raw string otherwise", () => {
    expect(parseControlValue({ checked: false, value: "mouse" }, "trackpad")).toBe("mouse");
  });
});

describe("applyControlValue", () => {
  it("sets `checked` for a boolean value", () => {
    const el = { checked: false, value: "" };
    applyControlValue(el, true);
    expect(el.checked).toBe(true);
  });

  it("sets a stringified `value` otherwise", () => {
    const el = { checked: false, value: "" };
    applyControlValue(el, 90);
    expect(el.value).toBe("90");
  });
});

/** Build a fake ResumeContext whose `el` carries a dataset + control surface. */
function fakeCtx(dataset: Record<string, string>, control: { checked?: boolean; value?: string }): ResumeContext {
  return { el: { dataset, checked: control.checked ?? false, value: control.value ?? "" } } as unknown as ResumeContext;
}

describe("bindField", () => {
  it("writes a control's parsed value into the matching signal", () => {
    const sig = signalRecord({ gridVisible: false, fov: 50 });
    const action = bindField(sig);

    action(fakeCtx({ field: "fov" }, { value: "90" }));
    expect(sig.fov.value).toBe(90);

    action(fakeCtx({ field: "gridVisible" }, { checked: true }));
    expect(sig.gridVisible.value).toBe(true);
  });

  it("ignores a missing or unknown field", () => {
    const sig = signalRecord({ gridVisible: false });
    const action = bindField(sig);

    action(fakeCtx({}, { checked: true }));
    action(fakeCtx({ field: "nope" }, { checked: true }));
    expect(sig.gridVisible.value).toBe(false);
  });
});
