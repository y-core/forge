/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { TOOLBAR_SCOPE } from "../contracts/toolbar-contract";
import { buttonVariants } from "./button";
import { Toolbar } from "./toolbar";

const item = (overrides: Parameters<typeof buttonVariants>[0] = {}): string =>
  buttonVariants({ tone: "neutral", appearance: "ghost", size: "sm", ...overrides });
const ITEM_BASE = item();

describe("Toolbar", () => {
  it("renders the root with the scope, the role and the orientation pair", async () => {
    expect(await render(<Toolbar>x</Toolbar>)).toBe(
      `<div role="toolbar" data-slot="toolbar" data-scope="${TOOLBAR_SCOPE}" data-orientation="horizontal" aria-orientation="horizontal" class="flex items-center gap-1">x</div>`,
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
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE}" data-toolbar-item="">Bold</button>`,
    );
  });

  it("takes core/Button's variant and size", async () => {
    expect(
      await render(
        <Toolbar.Button tone='neutral' appearance='outline' shape='icon'>
          B
        </Toolbar.Button>,
      ),
    ).toBe(
      '<button type="button" data-slot="toolbar-button" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm text-sm px-0 w-control-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] bg-transparent [--focus-ring:var(--color-ring)] border-input text-foreground hover:bg-accent hover:text-accent-foreground" data-toolbar-item="">B</button>',
    );
  });

  it("sizes to its container with `square`, and still merges a caller class", async () => {
    expect(
      await render(
        <Toolbar.Button shape='square' class='my-item'>
          B
        </Toolbar.Button>,
      ),
    ).toBe(
      `<button type="button" data-slot="toolbar-button" class="${item({ shape: "square", class: "my-item" })}" data-toolbar-item="">B</button>`,
    );
  });

  // Pressed is not the tab stop. A toolbar may have several items pressed at once, and
  // `composite.ts` takes the first marked item and ignores the rest — so deriving the marker from
  // `pressed` handed the tab stop to whichever pressed item came first, with no app override.
  it("stamps the pressed pair and claims no tab stop", async () => {
    expect(await render(<Toolbar.Button pressed>Bold</Toolbar.Button>)).toBe(
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE}" data-toolbar-item="" aria-pressed="true" data-pressed="">Bold</button>`,
    );
  });

  it("lets the app mark the tab stop explicitly, on an item pressed or not", async () => {
    const marked = await render(<Toolbar.Button data-composite-item-active=''>Save</Toolbar.Button>);

    expect(marked).toBe(
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE}" data-toolbar-item="" data-composite-item-active="">Save</button>`,
    );
    expect(await render(<Toolbar.Button pressed>Bold</Toolbar.Button>)).toBe(
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE}" data-toolbar-item="" aria-pressed="true" data-pressed="">Bold</button>`,
    );
  });

  it("announces an explicitly unpressed item without claiming the tab stop", async () => {
    expect(await render(<Toolbar.Button pressed={false}>Bold</Toolbar.Button>)).toBe(
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE}" data-toolbar-item="" aria-pressed="false">Bold</button>`,
    );
  });

  it("omits the pressed pair entirely for a one-state item", async () => {
    expect(await render(<Toolbar.Button>Bold</Toolbar.Button>)).toBe(
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE}" data-toolbar-item="">Bold</button>`,
    );
  });

  it("renders onto the caller's element with asChild, carrying the marks with it", async () => {
    expect(
      await render(
        <Toolbar.Button asChild pressed>
          <a href='/x'>Go</a>
        </Toolbar.Button>,
      ),
    ).toBe(`<a href="/x" data-toolbar-item="" aria-pressed="true" data-pressed="" class="${ITEM_BASE}" data-slot="toolbar-button">Go</a>`);
  });

  it("throws rather than degrading when asChild has no single element child", async () => {
    expect(() => render(<Toolbar.Button asChild>text</Toolbar.Button>)).toThrow(/exactly one JSX element child/);
  });
});

describe("Toolbar.Button — data-slot", () => {
  it("keeps its own token ahead of one handed down through props", async () => {
    expect(await render(<Toolbar.Button data-slot='toolbar-action'>B</Toolbar.Button>)).toBe(
      `<button type="button" data-slot="toolbar-button toolbar-action" class="${ITEM_BASE}" data-toolbar-item="">B</button>`,
    );
  });

  it("treats an empty inherited token as none rather than emitting a trailing space", async () => {
    expect(await render(<Toolbar.Button data-slot=''>B</Toolbar.Button>)).toBe(
      `<button type="button" data-slot="toolbar-button" class="${ITEM_BASE}" data-toolbar-item="">B</button>`,
    );
  });

  it("carries an inherited token onto the caller's element with asChild", async () => {
    expect(
      await render(
        <Toolbar.Button asChild data-slot='toolbar-action'>
          <a href='/x'>Go</a>
        </Toolbar.Button>,
      ),
    ).toBe(`<a href="/x" data-toolbar-item="" class="${ITEM_BASE}" data-slot="toolbar-button toolbar-action">Go</a>`);
  });
});

describe("Toolbar.Link", () => {
  it("shares the item base and adds its own underline affordance", async () => {
    expect(await render(<Toolbar.Link href='/docs'>Docs</Toolbar.Link>)).toBe(
      `<a data-slot="toolbar-link" class="${item({ class: "underline-offset-4 hover:underline" })}" data-toolbar-item="" href="/docs">Docs</a>`,
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
      `<a data-slot="toolbar-link rail-tool" class="${item({ class: "underline-offset-4 hover:underline" })}" data-toolbar-item="" href="/docs">Docs</a>`,
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
      `<button type="button" data-toolbar-item="" class="${item({ class: "underline-offset-4 hover:underline" })}" ` +
        'data-slot="toolbar-link rail-tool">Docs</button>',
    );
  });
});

describe("Toolbar.Input", () => {
  it("is a focus stop like any other item", async () => {
    expect(await render(<Toolbar.Input placeholder='Search' />)).toBe(
      '<input data-slot="toolbar-input" data-toolbar-item="" class="rounded-field border border-input bg-background px-2 py-1 text-sm text-foreground focus-ring placeholder:text-muted-foreground" placeholder="Search">',
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

  // `disabled` arrives through `rest` here, so it landed on the `<a>` beside `aria-disabled` — an
  // attribute the platform ignores sitting next to the one that does the work.
  it("strips the native disabled attribute from a non-button asChild child", async () => {
    expect(
      await render(
        <Toolbar.Button asChild disabled>
          <a href='/x'>Go</a>
        </Toolbar.Button>,
      ),
    ).toBe(
      '<a href="/x" data-toolbar-item="" aria-disabled="true" data-disabled="" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" data-slot="toolbar-button">Go</a>',
    );
  });
});

// The defect this replaced: `composite.ts`'s `initialIndex` takes the *first* marked item, so a
// toolbar with Bold and Italic pressed gave the tab stop to Bold and ignored the app's own marker.
describe("Toolbar — exactly one tab stop, whatever is pressed", () => {
  it("marks only the item the app marked, across two pressed siblings", async () => {
    const html = await render(
      <Toolbar>
        <Toolbar.Button pressed>Bold</Toolbar.Button>
        <Toolbar.Button pressed>Italic</Toolbar.Button>
        <Toolbar.Button data-composite-item-active=''>Save</Toolbar.Button>
      </Toolbar>,
    );

    const marked = [...html.matchAll(/<button[^>]*data-composite-item-active[^>]*>([^<]*)</g)].map((match) => match[1]);
    expect(marked).toEqual(["Save"]);
  });
});
