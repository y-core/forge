/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Indicator } from "./indicator";

const ITEM = "absolute z-10";

describe("Indicator", () => {
  it("wraps its children and positions an item at the top end by default", async () => {
    expect(
      await render(
        <Indicator>
          <span>x</span>
          <Indicator.Item>9</Indicator.Item>
        </Indicator>,
      ),
    ).toBe(
      `<div data-slot="indicator" class="relative inline-flex"><span>x</span>` +
        `<span data-slot="indicator-item" data-placement="top-end" class="${ITEM} end-0 top-0 translate-x-1/2 -translate-y-1/2">9</span></div>`,
    );
  });

  it("positions an item at the top start", async () => {
    expect(await render(<Indicator.Item placement='top-start'>9</Indicator.Item>)).toBe(
      `<span data-slot="indicator-item" data-placement="top-start" class="${ITEM} start-0 top-0 -translate-x-1/2 -translate-y-1/2">9</span>`,
    );
  });

  it("positions an item at the bottom start", async () => {
    expect(await render(<Indicator.Item placement='bottom-start'>9</Indicator.Item>)).toBe(
      `<span data-slot="indicator-item" data-placement="bottom-start" class="${ITEM} start-0 bottom-0 -translate-x-1/2 translate-y-1/2">9</span>`,
    );
  });

  it("positions an item at the bottom end", async () => {
    expect(await render(<Indicator.Item placement='bottom-end'>9</Indicator.Item>)).toBe(
      `<span data-slot="indicator-item" data-placement="bottom-end" class="${ITEM} end-0 bottom-0 translate-x-1/2 translate-y-1/2">9</span>`,
    );
  });

  it("merges a caller class last on the root and forwards attributes with escaped values", async () => {
    expect(
      await render(
        <Indicator class='block' id='i1' data-note='a&b'>
          {`R&D's`}
        </Indicator>,
      ),
    ).toBe(`<div data-slot="indicator" class="relative block" id="i1" data-note="a&amp;b">R&amp;D&#39;s</div>`);
  });

  it("merges a caller class last on an item and composes an inherited data-slot token", async () => {
    expect(
      await render(
        <Indicator.Item class='z-20' data-slot='inherited' data-note='a&b'>
          9
        </Indicator.Item>,
      ),
    ).toBe(
      `<span data-slot="indicator-item inherited" data-placement="top-end" class="absolute end-0 top-0 translate-x-1/2 -translate-y-1/2 z-20" data-note="a&amp;b">9</span>`,
    );
  });
});
