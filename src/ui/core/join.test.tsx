/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Join } from "./join";

describe("Join", () => {
  it("renders a horizontal group by default", async () => {
    expect(
      await render(
        <Join>
          <span>a</span>
        </Join>,
      ),
    ).toBe('<div data-slot="join" class="inline-flex items-stretch" data-orientation="horizontal"><span>a</span></div>');
  });

  it("stacks on the block axis when orientation is vertical, and merges a caller class last", async () => {
    expect(
      await render(
        <Join orientation='vertical' class='w-40'>
          <span>a</span>
        </Join>,
      ),
    ).toBe('<div data-slot="join" class="inline-flex items-stretch flex-col w-40" data-orientation="vertical"><span>a</span></div>');
  });

  it("forwards unknown props and merges an inherited data-slot", async () => {
    expect(await render(<Join id='toolbar' data-slot='segmented' />)).toBe(
      '<div data-slot="join segmented" class="inline-flex items-stretch" data-orientation="horizontal" id="toolbar"></div>',
    );
  });
});
