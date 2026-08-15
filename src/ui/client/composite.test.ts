import { describe, expect, it } from "bun:test";
import { isDisabled, isNativeInput } from "./composite";
import { fakeTree } from "./test-dom";

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
