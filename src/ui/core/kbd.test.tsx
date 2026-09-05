/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Kbd } from "./kbd";

const BOX = "inline-flex items-center rounded-field border-field border-border bg-muted font-mono font-medium text-foreground shadow-xs";

describe("Kbd", () => {
  it("renders the md size by default", async () => {
    expect(await render(<Kbd>K</Kbd>)).toBe(`<kbd data-slot="kbd" class="${BOX} px-1.5 py-0.5 text-xs">K</kbd>`);
  });

  it("renders the sm size", async () => {
    expect(await render(<Kbd size='sm'>K</Kbd>)).toBe(`<kbd data-slot="kbd" class="${BOX} px-1 py-px text-[0.6875rem]">K</kbd>`);
  });

  it("renders the lg size", async () => {
    expect(await render(<Kbd size='lg'>K</Kbd>)).toBe(`<kbd data-slot="kbd" class="${BOX} px-2 py-1 text-sm">K</kbd>`);
  });

  it("merges a caller class last, evicting the size padding it conflicts with", async () => {
    expect(await render(<Kbd class='p-2'>K</Kbd>)).toBe(`<kbd data-slot="kbd" class="${BOX} text-xs p-2">K</kbd>`);
  });

  it("forwards attributes with escaped values and escapes children", async () => {
    expect(
      await render(
        <Kbd id='k1' data-note='a&b'>
          {`R&D's`}
        </Kbd>,
      ),
    ).toBe(`<kbd data-slot="kbd" class="${BOX} px-1.5 py-0.5 text-xs" id="k1" data-note="a&amp;b">R&amp;D&#39;s</kbd>`);
  });

  it("composes an inherited data-slot token after its own", async () => {
    expect(await render(<Kbd data-slot='inherited'>K</Kbd>)).toBe(`<kbd data-slot="kbd inherited" class="${BOX} px-1.5 py-0.5 text-xs">K</kbd>`);
  });
});
