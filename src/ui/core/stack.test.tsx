/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Stack } from "./stack";

const BASE =
  "grid place-items-center [&amp;&gt;*]:w-full [&amp;&gt;*]:[grid-area:1/1] " +
  "[&amp;&gt;*:nth-child(1)]:z-20 [&amp;&gt;*:nth-child(2)]:z-10 [&amp;&gt;*:nth-child(2)]:scale-95 [&amp;&gt;*:nth-child(2)]:opacity-90 " +
  "[&amp;&gt;*:nth-child(3)]:z-0 [&amp;&gt;*:nth-child(3)]:scale-90 [&amp;&gt;*:nth-child(3)]:opacity-80";

describe("Stack", () => {
  it("layers its children in one cell and fans the rest downwards by default", async () => {
    expect(
      await render(
        <Stack>
          <span>a</span>
          <span>b</span>
        </Stack>,
      ),
    ).toBe(
      `<div data-slot="stack" data-placement="bottom" class="${BASE} [&amp;&gt;*:nth-child(2)]:translate-y-2 [&amp;&gt;*:nth-child(3)]:translate-y-4"><span>a</span><span>b</span></div>`,
    );
  });

  it("fans upwards for placement top", async () => {
    expect(await render(<Stack placement='top' />)).toBe(
      `<div data-slot="stack" data-placement="top" class="${BASE} [&amp;&gt;*:nth-child(2)]:-translate-y-2 [&amp;&gt;*:nth-child(3)]:-translate-y-4"></div>`,
    );
  });

  it("fans towards the inline start, mirrored under rtl", async () => {
    expect(await render(<Stack placement='start' />)).toBe(
      `<div data-slot="stack" data-placement="start" class="${BASE} [&amp;&gt;*:nth-child(2)]:-translate-x-2 [&amp;&gt;*:nth-child(3)]:-translate-x-4 rtl:[&amp;&gt;*:nth-child(2)]:translate-x-2 rtl:[&amp;&gt;*:nth-child(3)]:translate-x-4"></div>`,
    );
  });

  it("fans towards the inline end, mirrored under rtl", async () => {
    expect(await render(<Stack placement='end' />)).toBe(
      `<div data-slot="stack" data-placement="end" class="${BASE} [&amp;&gt;*:nth-child(2)]:translate-x-2 [&amp;&gt;*:nth-child(3)]:translate-x-4 rtl:[&amp;&gt;*:nth-child(2)]:-translate-x-2 rtl:[&amp;&gt;*:nth-child(3)]:-translate-x-4"></div>`,
    );
  });

  it("merges a caller class last, composes an inherited data-slot, and forwards attributes with escaped values", async () => {
    expect(
      await render(
        <Stack class='w-40' data-slot='pile' data-note='a&b'>
          {`R&D's`}
        </Stack>,
      ),
    ).toBe(
      `<div data-slot="stack pile" data-placement="bottom" class="${BASE} [&amp;&gt;*:nth-child(2)]:translate-y-2 [&amp;&gt;*:nth-child(3)]:translate-y-4 w-40" data-note="a&amp;b">R&amp;D&#39;s</div>`,
    );
  });

  it("lets a caller override data-placement without changing the fan recipe", async () => {
    expect(await render(<Stack data-placement='custom' />)).toBe(
      `<div data-slot="stack" data-placement="custom" class="${BASE} [&amp;&gt;*:nth-child(2)]:translate-y-2 [&amp;&gt;*:nth-child(3)]:translate-y-4"></div>`,
    );
  });
});
