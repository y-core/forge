import { OTP_LENGTH_ATTR } from "../contracts/otp-input-contract";
import { ownerDocument } from "./dom";

const NON_DIGITS = /\D/g;

const mountedOtpInputs = new WeakMap<HTMLElement, () => void>();

/** An OTP entry reduced to at most `length` digits, with the caret moved to where the same digits now end. @internal */
export function normaliseOtpEntry(value: string, caret: number, length: number): { value: string; caret: number } {
  const digits = value.replace(NON_DIGITS, "").slice(0, length);
  const digitsBeforeCaret = value.slice(0, caret).replace(NON_DIGITS, "").length;
  return { value: digits, caret: Math.min(digitsBeforeCaret, digits.length) };
}

/** Mounts the digit filter for `<OtpInput>` and returns a disposer. */
export function mountOtpInput(root: HTMLElement): () => void {
  const existing = mountedOtpInputs.get(root);
  if (existing) return existing;

  const length = Number(root.getAttribute(OTP_LENGTH_ATTR));
  const input = root.querySelector<HTMLInputElement>("[data-slot~='otp-input']");
  if (!input) {
    console.warn("[otp-input] no [data-slot~='otp-input'] element inside the frame");
    return () => {};
  }
  if (!Number.isInteger(length) || length <= 0) {
    console.warn(`[otp-input] ${OTP_LENGTH_ATTR} is not a positive integer`);
    return () => {};
  }

  const controller = new AbortController();
  const { signal } = controller;

  const normalise = () => {
    const next = normaliseOtpEntry(input.value, input.selectionStart ?? input.value.length, length);
    if (next.value === input.value) return;
    input.value = next.value;
    if (ownerDocument(root).activeElement === input) input.setSelectionRange(next.caret, next.caret);
  };

  input.addEventListener(
    "input",
    (event) => {
      if ((event as InputEvent).isComposing) return;
      normalise();
    },
    { signal },
  );
  input.addEventListener("compositionend", normalise, { signal });

  const dispose = () => {
    controller.abort();
    mountedOtpInputs.delete(root);
  };
  mountedOtpInputs.set(root, dispose);
  return dispose;
}
