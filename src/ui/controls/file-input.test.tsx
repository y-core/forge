/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { FileInput } from "./file-input";

const BASE =
  "state-busy state-disabled state-invalid field-chrome focus-ring file:me-3 file:h-full file:border-0 file:bg-transparent file:font-medium file:text-foreground h-control-md text-sm";

describe("controls/FileInput", () => {
  it("emits data-field on the input", async () => {
    expect(await render(<FileInput bind='avatar' />)).toBe(
      `<input type="file" data-slot="file-input" data-size="md" class="${BASE}" data-field="avatar">`,
    );
  });

  it("passes accept and data-ref through to the underlying input", async () => {
    expect(await render(<FileInput bind='avatar' accept='image/png' data-ref='avatar-input' />)).toBe(
      `<input type="file" data-slot="file-input" data-size="md" class="${BASE}" accept="image/png" data-ref="avatar-input" data-field="avatar">`,
    );
  });
});
