/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { OtpInput } from "./otp-input";
import { attrOf, attrsOf, classesOf, variantClasses } from "./test-support";

const FRAME = 'data-slot="otp-input-wrapper"';
const EDITOR = 'data-slot="otp-input"';

const code = (props: Parameters<typeof OtpInput>[0] = {}) => render(<OtpInput name='code' {...props} />);

describe("OtpInput", () => {
  it("renders the whole frame and its editor exactly, caller class merged last and forwarded values escaped", async () => {
    expect(await render(<OtpInput name='code' value='123456' class='w-full' data-slot='pin' data-note='a&b' />)).toBe(
      '<div data-slot="otp-input-wrapper" data-size="md" class="state-disabled state-invalid focus-ring otp-cells inline-flex overflow-clip' +
        ' rounded-field border-field border-input bg-background h-control-md [--otp-length:6] w-full">' +
        '<input data-slot="otp-input pin" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6"' +
        ' data-size="md" class="state-busy otp-editor h-full shrink-0 border-0 bg-transparent font-mono text-foreground outline-none' +
        ' tabular-nums text-base" name="code" value="123456" data-note="a&amp;b"></div>',
    );
  });

  it("is one native one-time-code field, six cells wide by default, so paste and autofill still work", async () => {
    expect(attrsOf(await code(), EDITOR)).toEqual({
      "data-slot": "otp-input",
      type: "text",
      inputmode: "numeric",
      autocomplete: "one-time-code",
      pattern: "[0-9]*",
      maxlength: "6",
      "data-size": "md",
      name: "code",
    });
  });

  it("sets both the native maxlength and the cell count the frame paints from the one length prop", async () => {
    const four = await code({ length: 4 });

    expect(attrOf(four, "maxlength", EDITOR)).toBe("4");
    expect(variantClasses(four, await code(), FRAME)).toEqual({ added: ["[--otp-length:4]"], dropped: ["[--otp-length:6]"] });
  });

  it("stamps the size on both boxes, which the cell utilities read, and scales the frame height with the type", async () => {
    const scales = [
      { size: "sm", height: "h-control-sm", type: "text-sm" },
      { size: "lg", height: "h-control-lg", type: "text-lg" },
    ] as const;
    const baseline = await code();

    for (const { size, height, type } of scales) {
      const html = await code({ size });

      expect(attrOf(html, "data-size", FRAME)).toBe(size);
      expect(attrOf(html, "data-size", EDITOR)).toBe(size);
      expect(variantClasses(html, baseline, FRAME)).toEqual({ added: [height], dropped: ["h-control-md"] });
      expect(variantClasses(html, baseline, EDITOR)).toEqual({ added: [type], dropped: ["text-base"] });
    }
  });

  it("wires id, name and the aria-* description chain from a field descriptor, as Input does", async () => {
    expect(attrsOf(await render(<OtpInput field={{ name: "code", invalid: true, description: true }} />), EDITOR)).toEqual({
      "data-slot": "otp-input",
      type: "text",
      inputmode: "numeric",
      autocomplete: "one-time-code",
      pattern: "[0-9]*",
      maxlength: "6",
      "data-size": "md",
      id: "field-code",
      name: "code",
      "aria-describedby": "field-code-description field-code-error",
      "aria-invalid": "true",
    });
  });

  it("stamps the invalid and busy state hooks with their ARIA twins, so the frame paints and a reader hears the same state", async () => {
    const html = await code({ invalid: true, busy: true });

    expect(attrsOf(html, EDITOR)).toEqual({
      "data-slot": "otp-input",
      type: "text",
      inputmode: "numeric",
      autocomplete: "one-time-code",
      pattern: "[0-9]*",
      maxlength: "6",
      "data-size": "md",
      name: "code",
      "data-invalid": "",
      "data-busy": "",
      "aria-invalid": "true",
      "aria-busy": "true",
    });
    expect(classesOf(html, FRAME).filter((token) => token.startsWith("state-"))).toEqual(["state-disabled", "state-invalid"]);
    expect(classesOf(html, EDITOR).filter((token) => token.startsWith("state-"))).toEqual(["state-busy"]);
  });
});
