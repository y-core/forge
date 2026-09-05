/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { OtpInput } from "./otp-input";

const FRAME = "state-disabled state-invalid focus-ring otp-cells inline-flex overflow-clip rounded-field border-field border-input bg-background";

const EDITOR = "state-busy otp-editor h-full shrink-0 border-0 bg-transparent font-mono text-foreground outline-none tabular-nums";

const frame = (length: number) => `<div data-slot="otp-input-wrapper" data-size="md" class="${FRAME} h-control-md [--otp-length:${length}]">`;

describe("controls/OtpInput", () => {
  it("emits data-field on the input", async () => {
    expect(await render(<OtpInput bind='code' value='123456' />)).toBe(
      `${frame(6)}<input data-slot="otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" data-size="md" class="${EDITOR} text-base" value="123456" data-field="code"></div>`,
    );
  });

  it("passes length and data-ref through to the underlying input", async () => {
    expect(await render(<OtpInput bind='pin' length={4} data-ref='pin-input' />)).toBe(
      `${frame(4)}<input data-slot="otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="4" data-size="md" class="${EDITOR} text-base" data-ref="pin-input" data-field="pin"></div>`,
    );
  });
});
