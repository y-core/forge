/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Carousel } from "./carousel";

const STRIP = "flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain rounded-box [scrollbar-width:thin] motion-safe:scroll-smooth";
const ITEM = "w-full shrink-0";
const DOT_OFF =
  "state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm text-sm px-0 w-control-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground";
const DOT_ON =
  "state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm text-sm px-0 w-control-sm [--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)] border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]";
const DOT_ON_MD =
  "state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-md text-sm w-control-md px-0 [--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)] border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]";

function strip(children = "", label = "Slides"): string {
  return `<div data-slot="carousel-strip" role="group" aria-label="${label}" tabindex="0" class="${STRIP}">${children}</div>`;
}

describe("Carousel", () => {
  it("wraps a start-snapping strip and announces nothing without a label", async () => {
    expect(await render(<Carousel />)).toBe(`<div data-slot="carousel" data-snap="start" class="relative">${strip()}</div>`);
  });

  it("records a centre snap on the root for the reader of the markup", async () => {
    expect(await render(<Carousel snap='center' />)).toBe(`<div data-slot="carousel" data-snap="center" class="relative">${strip()}</div>`);
  });

  it("names itself a carousel only when given a label", async () => {
    expect(await render(<Carousel label='Featured' />)).toBe(
      `<div data-slot="carousel" data-snap="start" aria-roledescription="carousel" aria-label="Featured" class="relative">${strip("", "Featured")}</div>`,
    );
  });

  it("merges a caller class onto the root, not the strip, and keeps its own slot token first", async () => {
    expect(await render(<Carousel class='w-96' data-slot='hero' />)).toBe(
      `<div data-slot="carousel hero" data-snap="start" class="relative w-96">${strip()}</div>`,
    );
  });

  it("escapes a forwarded value", async () => {
    expect(await render(<Carousel data-note={`R&D's "n" <x>`} />)).toBe(
      `<div data-slot="carousel" data-snap="start" class="relative" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;">${strip()}</div>`,
    );
  });
});

// WCAG 2.1.1: the strip is `overflow-x-auto`, so it is the scrolling region and has to be reachable
// from the keyboard — the same obligation `ScrollArea.Viewport` already carries.
describe("Carousel — the strip is a named tab stop", () => {
  it("takes its own name from stripLabel, ahead of the root's label", async () => {
    expect(await render(<Carousel label='Featured' stripLabel='Featured slides' />)).toBe(
      `<div data-slot="carousel" data-snap="start" aria-roledescription="carousel" aria-label="Featured" class="relative">${strip("", "Featured slides")}</div>`,
    );
  });
});

describe("Carousel.Item", () => {
  it("is a full-width slide that snaps to the start", async () => {
    expect(await render(<Carousel.Item id='s-1'>One</Carousel.Item>)).toBe(
      `<div data-slot="carousel-item" role="group" class="${ITEM} snap-start" id="s-1">One</div>`,
    );
  });

  it("snaps to the centre when told", async () => {
    expect(await render(<Carousel.Item snap='center' />)).toBe(`<div data-slot="carousel-item" role="group" class="${ITEM} snap-center"></div>`);
  });

  // All-or-nothing, mirroring the root: renaming the role without naming the thing leaves a reader
  // told "slide" and nothing about which slide.
  it("calls itself a slide only when it has a name", async () => {
    expect(await render(<Carousel.Item label='Rainfall, 1990–2020' />)).toBe(
      `<div data-slot="carousel-item" role="group" aria-roledescription="slide" aria-label="Rainfall, 1990–2020" class="${ITEM} snap-start"></div>`,
    );
  });

  it("lets a caller width replace the full-width default and escapes a forwarded value", async () => {
    expect(await render(<Carousel.Item class='w-1/2' data-note={`R&D's "n" <x>`} />)).toBe(
      `<div data-slot="carousel-item" role="group" class="shrink-0 snap-start w-1/2" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;"></div>`,
    );
  });
});

describe("Carousel.Dots", () => {
  it("is Pagination by anchor, one item per id, with the current one marked", async () => {
    expect(await render(<Carousel.Dots ids={["s-1", "s-2", "s-3"]} current={1} />)).toBe(
      '<nav aria-label="Slides" data-slot="pagination carousel-dots" class="mt-3 flex justify-center">' +
        '<ul data-slot="pagination-list" class="flex items-center gap-1">' +
        `<li><a data-slot="pagination-item" class="${DOT_OFF}" href="#s-1" aria-label="Slide 1">1</a></li>` +
        `<li><a data-slot="pagination-item" class="${DOT_ON}" aria-current="page" data-selected="" href="#s-2" aria-label="Slide 2">2</a></li>` +
        `<li><a data-slot="pagination-item" class="${DOT_OFF}" href="#s-3" aria-label="Slide 3">3</a></li>` +
        "</ul></nav>",
    );
  });

  it("marks the first slide current by default and takes a label, size, class, and a forwarded value", async () => {
    expect(await render(<Carousel.Dots ids={["s-1"]} label='Photos' size='md' class='mt-6' data-note={`R&D's "n" <x>`} />)).toBe(
      '<nav aria-label="Photos" data-slot="pagination carousel-dots" class="flex justify-center mt-6" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;">' +
        '<ul data-slot="pagination-list" class="flex items-center gap-1">' +
        `<li><a data-slot="pagination-item" class="${DOT_ON_MD}" aria-current="page" data-selected="" href="#s-1" aria-label="Slide 1">1</a></li>` +
        "</ul></nav>",
    );
  });
});

describe("Carousel.Dots — current outside the slide range", () => {
  // `current` is a public `number` with no clamp of its own, so `-1` or `9` used to mark no dot at
  // all — and a row with nothing marked leaves the controller no selected paint to read.
  it("marks exactly one dot whatever index the caller passes", async () => {
    for (const current of [-1, 9, Number.NaN, 1.7]) {
      const html = await render(<Carousel.Dots ids={["a", "b", "c"]} current={current} />);
      expect(html.split('aria-current="page"').length - 1).toBe(1);
    }
  });

  it("clamps below the range to the first dot and above it to the last", async () => {
    const first = await render(<Carousel.Dots ids={["a", "b", "c"]} current={-4} />);
    const last = await render(<Carousel.Dots ids={["a", "b", "c"]} current={7} />);

    expect(first.indexOf('aria-current="page"')).toBe(
      (await render(<Carousel.Dots ids={["a", "b", "c"]} current={0} />)).indexOf('aria-current="page"'),
    );
    expect(last.indexOf('aria-current="page"')).toBe(
      (await render(<Carousel.Dots ids={["a", "b", "c"]} current={2} />)).indexOf('aria-current="page"'),
    );
  });
});
