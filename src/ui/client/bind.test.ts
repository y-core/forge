import { describe, expect, it } from "bun:test";
import { applyControlValue, bindField, bindGroup, parseControlValue } from "./bind";
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

/** Build a fake ResumeContext for group binding: `el` has `closest` resolving to an element
 *  with `data-field` + `data-value` dataset, simulating a click on a group item button. */
function fakeGroupCtx(elDataset: Record<string, string>, closestResult: { dataset: Record<string, string> } | null): ResumeContext {
  return { el: { dataset: elDataset, closest: (_selector: string) => closestResult } } as unknown as ResumeContext;
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

describe("bindGroup", () => {
  it("writes the raw data-value string into the matching signal", () => {
    const sig = signalRecord({ projection: "perspective" });
    const action = bindGroup(sig);

    action(fakeGroupCtx({}, { dataset: { field: "projection", value: "parallel" } }));
    expect(sig.projection.value).toBe("parallel");
  });

  it("resolves data-field and data-value from the closest ancestor", () => {
    const sig = signalRecord({ projection: "perspective" });
    const action = bindGroup(sig);

    // el is an inner child (e.g. <svg>); closest resolves to the parent button
    action(fakeGroupCtx({ unrelated: "x" }, { dataset: { field: "projection", value: "parallel" } }));
    expect(sig.projection.value).toBe("parallel");
  });

  it("is a no-op when closest returns null (no ancestor with both attrs)", () => {
    const sig = signalRecord({ projection: "perspective" });
    const action = bindGroup(sig);

    action(fakeGroupCtx({}, null));
    expect(sig.projection.value).toBe("perspective");
  });

  it("is a no-op when the field is not in signals", () => {
    const sig = signalRecord({ projection: "perspective" });
    const action = bindGroup(sig);

    action(fakeGroupCtx({}, { dataset: { field: "unknown", value: "parallel" } }));
    expect(sig.projection.value).toBe("perspective");
  });

  it("is a no-op when data-value is missing from the target", () => {
    const sig = signalRecord({ projection: "perspective" });
    const action = bindGroup(sig);

    action(fakeGroupCtx({}, { dataset: { field: "projection" } }));
    expect(sig.projection.value).toBe("perspective");
  });
});
