/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { OtpInput } from "./otp-input";

const FRAME = "state-disabled state-invalid focus-ring otp-cells inline-flex overflow-clip rounded-field border-field border-input bg-background";

const EDITOR = "state-busy otp-editor h-full shrink-0 border-0 bg-transparent font-mono text-foreground outline-none tabular-nums";

const frame = (size: string, length: number, extra = "") =>
  `<div data-slot="otp-input-wrapper" data-size="${size}" class="${FRAME} h-control-${size} [--otp-length:${length}]${extra}">`;

const HEAD = '<input data-slot="otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*"';

describe("OtpInput", () => {
  it("is one native text field in a cell-painting frame, six cells wide by default", async () => {
    expect(await render(<OtpInput name='code' />)).toBe(
      `${frame("md", 6)}${HEAD} maxlength="6" data-size="md" class="${EDITOR} text-base" name="code"></div>`,
    );
  });

  it("length sets both the native maxlength and the cell count the frame paints", async () => {
    expect(await render(<OtpInput name='code' length={4} />)).toBe(
      `${frame("md", 4)}${HEAD} maxlength="4" data-size="md" class="${EDITOR} text-base" name="code"></div>`,
    );
  });

  it("size stamps data-size on both boxes, which the utilities read for the cell width, and scales the type", async () => {
    expect(await render(<OtpInput name='code' size='sm' />)).toBe(
      `${frame("sm", 6)}${HEAD} maxlength="6" data-size="sm" class="${EDITOR} text-sm" name="code"></div>`,
    );
    expect(await render(<OtpInput name='code' size='lg' />)).toBe(
      `${frame("lg", 6)}${HEAD} maxlength="6" data-size="lg" class="${EDITOR} text-lg" name="code"></div>`,
    );
  });

  it("a field descriptor wires id, name and aria-* as Input does", async () => {
    expect(await render(<OtpInput field={{ name: "code", invalid: true, description: true }} />)).toBe(
      `${frame("md", 6)}${HEAD} maxlength="6" data-size="md" class="${EDITOR} text-base" id="field-code" name="code" aria-describedby="field-code-description field-code-error" aria-invalid="true"></div>`,
    );
  });

  it("invalid and busy stamp the state hooks and their ARIA twins on the field the frame reads", async () => {
    expect(await render(<OtpInput name='code' invalid busy />)).toBe(
      `${frame("md", 6)}${HEAD} maxlength="6" data-size="md" class="${EDITOR} text-base" name="code" data-invalid="" data-busy="" aria-invalid="true" aria-busy="true"></div>`,
    );
  });

  it("merges a caller class onto the frame, composes an inherited data-slot, and forwards attributes with escaped values", async () => {
    expect(await render(<OtpInput name='code' value='123456' class='w-full' data-slot='pin' data-note='a&b' />)).toBe(
      `${frame("md", 6, " w-full")}<input data-slot="otp-input pin" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" data-size="md" class="${EDITOR} text-base" name="code" value="123456" data-note="a&amp;b"></div>`,
    );
  });
});
