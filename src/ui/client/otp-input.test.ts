import { describe, expect, it } from "bun:test";

import { formDigits } from "../../validation/form-digits";
import { v } from "../../validation/validation";
import { FakeEvent, fakeTree } from "./dom.fixture";
import { mountOtpInput, normaliseOtpEntry } from "./otp-input";

function otpField(frameAttrs: Record<string, string> = { "data-otp-length": "6" }, value = "") {
  const { doc, el } = fakeTree();
  const root = el("DIV", { "data-scope": "otp-input", ...frameAttrs });
  const input = el("INPUT", { "data-slot": "otp-input" });
  let current = value;
  const writes: string[] = [];
  const carets: number[] = [];
  Object.defineProperty(input, "value", {
    get: () => current,
    set: (next: string) => {
      current = next;
      writes.push(next);
    },
  });
  Object.assign(input, { setSelectionRange: (start: number) => carets.push(start) });
  root.append(input);
  doc.root.append(root);

  const type = (entry: string, init: Record<string, unknown> = {}): void => {
    current = entry;
    Object.assign(input, { selectionStart: entry.length });
    input.dispatchEvent(new FakeEvent("input", init));
  };
  return { root, input, writes, carets, type };
}

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

describe("normaliseOtpEntry", () => {
  const cases = [
    { entry: ["12a", 3, 6], expected: { value: "12", caret: 2 } },
    { entry: ["12-9 34", 5, 6], expected: { value: "12934", caret: 3 } },
    { entry: ["1234567", 7, 6], expected: { value: "123456", caret: 6 } },
    { entry: ["1239456", 4, 6], expected: { value: "123945", caret: 4 } },
    { entry: ["- ", 2, 6], expected: { value: "", caret: 0 } },
    { entry: ["", 0, 6], expected: { value: "", caret: 0 } },
    { entry: ["123 456", 0, 6], expected: { value: "123456", caret: 0 } },
  ] as const;

  for (const {
    entry: [value, caret, length],
    expected,
  } of cases) {
    it(`reduces ${JSON.stringify(value)} with the caret at ${caret} to ${JSON.stringify(expected)}`, () => {
      expect(normaliseOtpEntry(value, caret, length)).toEqual(expected);
    });
  }

  it("keeps exactly the digits the server's formDigits() keeps, so the client never submits a code the server would read differently", () => {
    const entries = ["123 456", "123-456", "٥55", "555-CALL", "\t1\r\n2"];

    expect(entries.map((entry) => normaliseOtpEntry(entry, 0, 99).value)).toEqual(entries.map((entry) => v.parse(formDigits(), entry)));
  });
});

describe("mountOtpInput", () => {
  it("reduces a code pasted with a space to its digits and puts the caret after them while the field has focus", () => {
    const { root, input, carets, type } = otpField();
    mountOtpInput(root as never);
    input.focus();

    type("123 456");

    expect({ value: input.value, carets }).toEqual({ value: "123456", carets: [6] });
  });

  it("rewrites the value of an unfocused field without moving a caret it does not own", () => {
    const { root, input, carets, type } = otpField();
    mountOtpInput(root as never);

    type("123-456");

    expect({ value: input.value, carets }).toEqual({ value: "123456", carets: [] });
  });

  it("cuts a value past the frame's length to that many digits", () => {
    const { root, input, type } = otpField({ "data-otp-length": "4" });
    mountOtpInput(root as never);

    type("123456");

    expect(input.value).toBe("1234");
  });

  it("leaves a value that is already all digits unassigned, so the browser's caret and undo history survive", () => {
    const { root, input, writes, carets, type } = otpField();
    mountOtpInput(root as never);
    input.focus();

    type("1234");

    expect({ writes, carets }).toEqual({ writes: [], carets: [] });
  });

  it("holds off while an IME composition is open, and reduces the value once it ends", () => {
    const { root, input, type } = otpField();
    mountOtpInput(root as never);

    type("12 3", { isComposing: true });
    const composing = input.value;
    input.dispatchEvent(new FakeEvent("compositionend"));

    expect({ composing, ended: input.value }).toEqual({ composing: "12 3", ended: "123" });
  });

  const misconfigured = [
    { label: "no editor inside the frame", attrs: { "data-otp-length": "6" }, editor: false },
    { label: "no length attribute", attrs: {}, editor: true },
    { label: "a zero length", attrs: { "data-otp-length": "0" }, editor: true },
    { label: "a length that is not a number", attrs: { "data-otp-length": "x" }, editor: true },
    { label: "a fractional length", attrs: { "data-otp-length": "2.5" }, editor: true },
  ];

  for (const { label, attrs, editor } of misconfigured) {
    it(`warns once and filters nothing on a frame with ${label}`, () => {
      const { root, input, type } = otpField(attrs);
      if (!editor) input.setAttribute("data-slot", "other");

      const warned = warnings(() => mountOtpInput(root as never));
      type("123 456");

      expect({ warned: warned.length, value: input.value }).toEqual({ warned: 1, value: "123 456" });
    });
  }

  it("returns the same disposer to a second mount and listens only once", () => {
    const { root, input } = otpField();

    const first = mountOtpInput(root as never);
    const second = mountOtpInput(root as never);

    expect({ same: first === second, input: input.listeners.get("input")?.length, ended: input.listeners.get("compositionend")?.length }).toEqual({
      same: true,
      input: 1,
      ended: 1,
    });
  });

  it("stops filtering once disposed, and a later mount arms a fresh filter", () => {
    const { root, input, type } = otpField();
    const dispose = mountOtpInput(root as never);

    dispose();
    type("123 456");
    const disposed = { value: input.value, input: input.listeners.get("input")?.length, ended: input.listeners.get("compositionend")?.length };
    const remounted = mountOtpInput(root as never);
    type("123 456");

    expect({ disposed, fresh: remounted !== dispose, value: input.value }).toEqual({
      disposed: { value: "123 456", input: 0, ended: 0 },
      fresh: true,
      value: "123456",
    });
  });
});
