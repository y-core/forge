/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Toolbar } from "./toolbar";

/**
 * `core/Toolbar`'s SSR markup, pinned exactly.
 *
 * The item classes come from `core/Button`'s `buttonVariants` rather than a base string of the
 * toolbar's own, which is the whole point of the unification: exact strings are what make a second
 * base reappearing here a failing test instead of a slow divergence.
 */

const ITEM_BASE =
  "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent";

describe("Toolbar", () => {
  it("renders the root with the scope, the role and the orientation pair", async () => {
    expect(await render(<Toolbar>x</Toolbar>)).toBe(
      '<div role="toolbar" data-slot="toolbar" data-scope="toolbar" data-orientation="horizontal" aria-orientation="horizontal" class="flex items-center gap-1">x</div>',
    );
  });

  it("stacks a vertical toolbar and says so to both readers", async () => {
    expect(await render(<Toolbar orientation='vertical'>x</Toolbar>)).toBe(
      '<div role="toolbar" data-slot="toolbar" data-scope="toolbar" data-orientation="vertical" aria-orientation="vertical" class="flex items-center gap-1 flex-col">x</div>',
    );
  });
});

describe("Toolbar.Button", () => {
  it("defaults to the ghost variant at the small size, and carries the item marker", async () => {
    expect(await render(<Toolbar.Button>Bold</Toolbar.Button>)).toBe(
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE} h-8 px-3 text-sm" data-toolbar-item="">Bold</button>`,
    );
  });

  it("takes core/Button's variant and size", async () => {
    expect(
      await render(
        <Toolbar.Button variant='secondary' size='icon'>
          B
        </Toolbar.Button>,
      ),
    ).toBe(
      '<button type="button" data-slot="toolbar-button" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input text-foreground hover:bg-accent size-9 p-0" data-toolbar-item="">B</button>',
    );
  });

  it("sizes to its container with `square`, and still merges a caller class", async () => {
    // The size an icon rail actually wants: width from the parent, height from the width. No fixed
    // box can express it, which is why an app was previously forced to override what it asked for.
    expect(
      await render(
        <Toolbar.Button size='square' class='my-item'>
          B
        </Toolbar.Button>,
      ),
    ).toBe(
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE} w-full aspect-square p-0 my-item" data-toolbar-item="">B</button>`,
    );
  });

  it("stamps aria-pressed, data-pressed and the composite marker together when pressed", async () => {
    // All three or none: ARIA for the screen reader, `data-pressed` for CSS, and the composite
    // marker so the rail's boot tab stop lands on the active tool rather than on the first button.
    expect(await render(<Toolbar.Button pressed>Bold</Toolbar.Button>)).toBe(
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE} h-8 px-3 text-sm" data-toolbar-item="" aria-pressed="true" data-pressed="" data-composite-item-active="">Bold</button>`,
    );
  });

  it("announces an explicitly unpressed item without claiming the tab stop", async () => {
    expect(await render(<Toolbar.Button pressed={false}>Bold</Toolbar.Button>)).toBe(
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE} h-8 px-3 text-sm" data-toolbar-item="" aria-pressed="false">Bold</button>`,
    );
  });

  // Exact markup, not `.not.toContain("aria-pressed")`: a `not.toContain` over this markup passes
  // just as happily if `Toolbar.Button` renders nothing at all, so it never distinguished "the
  // pressed pair was omitted" from "there was no button".
  it("omits the pressed pair entirely for a one-state item", async () => {
    expect(await render(<Toolbar.Button>Bold</Toolbar.Button>)).toBe(
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE} h-8 px-3 text-sm" data-toolbar-item="">Bold</button>`,
    );
  });

  it("renders onto the caller's element with asChild, carrying the marks with it", async () => {
    expect(
      await render(
        <Toolbar.Button asChild pressed>
          <a href='/x'>Go</a>
        </Toolbar.Button>,
      ),
    ).toBe(
      `<a href="/x" data-toolbar-item="" aria-pressed="true" data-pressed="" data-composite-item-active="" class="${ITEM_BASE} h-8 px-3 text-sm" data-slot="toolbar-button">Go</a>`,
    );
  });

  it("throws rather than degrading when asChild has no single element child", async () => {
    expect(() => render(<Toolbar.Button asChild>text</Toolbar.Button>)).toThrow(/exactly one JSX element child/);
  });
});

/**
 * `data-slot` is a token list, and this is the compound where that matters most in practice:
 * `chrome/Toolbar` passes `toolbar-trigger`, `toolbar-action` and `toolbar-title-action` *through* the
 * primitives' rest spread, which used to replace the primitive's own token and unmake the item.
 * Composed-with-a-tooltip cases live with the rule, in `utils/as-child.test.tsx`.
 */
describe("Toolbar.Button — data-slot", () => {
  it("keeps its own token ahead of one handed down through props", async () => {
    expect(await render(<Toolbar.Button data-slot='toolbar-action'>B</Toolbar.Button>)).toBe(
      `<button type="button" data-slot="toolbar-button toolbar-action" class="${ITEM_BASE} h-8 px-3 text-sm" data-toolbar-item="">B</button>`,
    );
  });

  it("treats an empty inherited token as none rather than emitting a trailing space", async () => {
    expect(await render(<Toolbar.Button data-slot=''>B</Toolbar.Button>)).toBe(
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE} h-8 px-3 text-sm" data-toolbar-item="">B</button>`,
    );
  });

  it("carries an inherited token onto the caller's element with asChild", async () => {
    // The reverse of the composition bug: `cloneAsChild` writes `data-slot` last, so a token arriving
    // through the prop bag used to be spread in and then overwritten by the compound's own literal.
    expect(
      await render(
        <Toolbar.Button asChild data-slot='toolbar-action'>
          <a href='/x'>Go</a>
        </Toolbar.Button>,
      ),
    ).toBe(`<a href="/x" data-toolbar-item="" class="${ITEM_BASE} h-8 px-3 text-sm" data-slot="toolbar-button toolbar-action">Go</a>`);
  });
});

describe("Toolbar.Link", () => {
  it("shares the item base and adds its own underline affordance", async () => {
    expect(await render(<Toolbar.Link href='/docs'>Docs</Toolbar.Link>)).toBe(
      `<a data-slot="toolbar-link" class="${ITEM_BASE} h-8 px-3 text-sm underline-offset-4 hover:underline" data-toolbar-item="" href="/docs">Docs</a>`,
    );
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(
      await render(
        <Toolbar.Link href='/docs' data-slot='rail-tool'>
          Docs
        </Toolbar.Link>,
      ),
    ).toBe(
      `<a data-slot="toolbar-link rail-tool" class="${ITEM_BASE} h-8 px-3 text-sm underline-offset-4 hover:underline" data-toolbar-item="" href="/docs">Docs</a>`,
    );
  });

  it("carries an inherited token onto the caller's element with asChild", async () => {
    expect(
      await render(
        <Toolbar.Link asChild data-slot='rail-tool'>
          <button type='button'>Docs</button>
        </Toolbar.Link>,
      ),
    ).toBe(
      `<button type="button" data-toolbar-item="" class="${ITEM_BASE} h-8 px-3 text-sm underline-offset-4 hover:underline" ` +
        'data-slot="toolbar-link rail-tool">Docs</button>',
    );
  });
});

describe("Toolbar.Input", () => {
  it("is a focus stop like any other item", async () => {
    expect(await render(<Toolbar.Input placeholder='Search' />)).toBe(
      '<input data-slot="toolbar-input" data-toolbar-item="" class="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" placeholder="Search">',
    );
  });
});

describe("Toolbar.Separator", () => {
  it("defaults to the axis across a horizontal toolbar", async () => {
    expect(await render(<Toolbar.Separator />)).toBe(
      '<hr data-slot="toolbar-separator" aria-orientation="vertical" class="h-5 w-px border-0 bg-border">',
    );
  });

  it("takes a caller class for the margins a rail needs", async () => {
    expect(await render(<Toolbar.Separator orientation='horizontal' class='my-1' />)).toBe(
      '<hr data-slot="toolbar-separator" aria-orientation="horizontal" class="h-px w-full border-0 bg-border my-1">',
    );
  });
});
