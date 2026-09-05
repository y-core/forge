/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { FileInput } from "./file-input";

const BASE =
  "state-busy state-disabled state-invalid field-chrome focus-ring file:me-3 file:h-full file:border-0 file:bg-transparent file:font-medium file:text-foreground";

describe("FileInput", () => {
  it("renders a file input at the md size", async () => {
    expect(await render(<FileInput />)).toBe(`<input type="file" data-slot="file-input" data-size="md" class="${BASE} h-control-md text-sm">`);
  });

  it("stamps data-size and swaps the height recipe", async () => {
    expect(await render(<FileInput size='lg' />)).toBe(
      `<input type="file" data-slot="file-input" data-size="lg" class="${BASE} h-control-lg text-base">`,
    );
  });

  it("emits both the styling hook and the ARIA state for invalid and busy, with the caller class last", async () => {
    expect(await render(<FileInput invalid busy class='p-99' />)).toBe(
      `<input type="file" data-slot="file-input" data-size="md" class="${BASE} h-control-md text-sm p-99" data-invalid="" data-busy="" aria-invalid="true" aria-busy="true">`,
    );
  });

  it("derives id, name, and aria-describedby from a field descriptor", async () => {
    expect(await render(<FileInput field={{ name: "avatar", description: true, invalid: true }} />)).toBe(
      `<input type="file" data-slot="file-input" data-size="md" class="${BASE} h-control-md text-sm" id="field-avatar" name="avatar" aria-describedby="field-avatar-description field-avatar-error" aria-invalid="true">`,
    );
  });

  it("passes through accept, multiple, and required", async () => {
    expect(await render(<FileInput accept='image/png' multiple required />)).toBe(
      `<input type="file" data-slot="file-input" data-size="md" class="${BASE} h-control-md text-sm" accept="image/png" multiple required>`,
    );
  });

  // `state-invalid` sets `border-color` *and* `--tw-ring-color`, so before it had a group key of
  // its own it shared `ring-*`'s slot and a caller's ring silently deleted it — leaving a control
  // that announced `aria-invalid` while looking valid.
  it("keeps state-invalid when the caller supplies a ring of their own", async () => {
    expect(await render(<FileInput class='ring-primary' />)).toBe(
      '<input type="file" data-slot="file-input" data-size="md" class="state-busy state-disabled state-invalid field-chrome focus-ring file:me-3 file:h-full file:border-0 file:bg-transparent file:font-medium file:text-foreground h-control-md text-sm ring-primary">',
    );
  });
});
