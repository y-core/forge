import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Separator } from "./separator";

describe("Separator", () => {
  it("renders an <hr> element", async () => {
    expect(await render(<Separator />)).toBe('<hr data-slot="separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border">');
  });

  it("defaults to horizontal with h-px and w-full classes", async () => {
    expect(await render(<Separator />)).toBe('<hr data-slot="separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border">');
  });

  it("renders vertical classes when orientation=vertical", async () => {
    expect(await render(<Separator orientation='vertical' />)).toBe(
      '<hr data-slot="separator" aria-orientation="vertical" class="h-full w-px border-0 bg-border">',
    );
  });

  it("sets aria-orientation=horizontal by default", async () => {
    expect(await render(<Separator />)).toBe('<hr data-slot="separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border">');
  });

  it("sets aria-orientation=vertical when specified", async () => {
    expect(await render(<Separator orientation='vertical' />)).toBe(
      '<hr data-slot="separator" aria-orientation="vertical" class="h-full w-px border-0 bg-border">',
    );
  });

  it("merges a custom class with the base classes", async () => {
    expect(await render(<Separator class='my-sep' />)).toBe(
      '<hr data-slot="separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border my-sep">',
    );
  });

  it("forwards id and data-* attributes and keeps aria-orientation", async () => {
    expect(await render(<Separator id='sep1' data-testid='sep' data-note='a&b' />)).toBe(
      '<hr data-slot="separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border" id="sep1" data-testid="sep" data-note="a&amp;b">',
    );
  });
});
