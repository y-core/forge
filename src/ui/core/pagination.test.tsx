/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { createIcon } from "./icon";
import { Pagination } from "./pagination";

const icon = createIcon("/sprite.svg", { "icon-chevron-left": "0 0 16 16", "icon-chevron-right": "0 0 16 16" });

const LIST = '<ul data-slot="pagination-list" class="flex items-center gap-1">';

const BOX =
  "state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors";
const NEUTRAL_VARS =
  "[--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] " +
  "[--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)]";
const PRIMARY_VARS =
  "[--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)] [--tone-text:var(--color-primary-text)] " +
  "[--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)] [--tone-soft-border:var(--color-primary-soft-border)]";
const GHOST = "border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground";
const SOLID =
  "border-transparent bg-(--tone) text-(--tone-fg) [--focus-ring:var(--tone-fg)] hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]";

const ITEM_SM = `${BOX} h-control-sm text-sm px-0 w-control-sm ${NEUTRAL_VARS} ${GHOST}`;
const ITEM_SM_CURRENT = `${BOX} h-control-sm text-sm px-0 w-control-sm ${PRIMARY_VARS} ${SOLID}`;
const ITEM_MD = `${BOX} h-control-md text-sm w-control-md px-0 ${NEUTRAL_VARS} ${GHOST}`;
const ITEM_LG_CURRENT = `${BOX} h-control-lg text-base px-0 w-control-lg ${PRIMARY_VARS} ${SOLID}`;
const STEP_SM = `${BOX} h-control-sm px-3 text-sm ${NEUTRAL_VARS} ${GHOST}`;
const BOX_NO_RADIUS =
  "state-busy state-disabled inline-flex items-center justify-center gap-2 border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors";
const ITEM_SM_ROUNDED_FULL = `${BOX_NO_RADIUS} h-control-sm text-sm px-0 w-control-sm ${NEUTRAL_VARS} ${GHOST} rounded-full`;

const LEFT =
  '<svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true"><use href="/sprite.svg#icon-chevron-left"></use></svg>';
const RIGHT =
  '<svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true"><use href="/sprite.svg#icon-chevron-right"></use></svg>';

describe("Pagination", () => {
  it("labels the landmark Pagination and stamps no size of its own — each child carries the size that paints it", async () => {
    expect(await render(<Pagination />)).toBe(`<nav aria-label="Pagination" data-slot="pagination">${LIST}</ul></nav>`);
  });

  it("takes a caller label", async () => {
    expect(await render(<Pagination label='Pages' />)).toBe(`<nav aria-label="Pages" data-slot="pagination">${LIST}</ul></nav>`);
  });

  it("keeps its own slot token ahead of an inherited one and escapes a forwarded value", async () => {
    expect(await render(<Pagination class='mt-4' data-slot='pager' data-note={`R&D's "n" <x>`} />)).toBe(
      '<nav aria-label="Pagination" data-slot="pagination pager" class="mt-4" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;">' +
        `${LIST}</ul></nav>`,
    );
  });
});

describe("Pagination.Item", () => {
  it("paints a page link as a small ghost icon button", async () => {
    expect(await render(<Pagination.Item href='/1'>1</Pagination.Item>)).toBe(
      `<li><a data-slot="pagination-item" class="${ITEM_SM}" href="/1">1</a></li>`,
    );
  });

  it("fills the current page and announces it in ARIA beside the styling hook", async () => {
    expect(
      await render(
        <Pagination.Item href='/2' current>
          2
        </Pagination.Item>,
      ),
    ).toBe(`<li><a data-slot="pagination-item" class="${ITEM_SM_CURRENT}" aria-current="page" data-selected="" href="/2">2</a></li>`);
  });

  it("takes the medium control height", async () => {
    expect(
      await render(
        <Pagination.Item href='/3' size='md'>
          3
        </Pagination.Item>,
      ),
    ).toBe(`<li><a data-slot="pagination-item" class="${ITEM_MD}" href="/3">3</a></li>`);
  });

  it("takes the large control height on the current page", async () => {
    expect(
      await render(
        <Pagination.Item href='/3' size='lg' current>
          3
        </Pagination.Item>,
      ),
    ).toBe(`<li><a data-slot="pagination-item" class="${ITEM_LG_CURRENT}" aria-current="page" data-selected="" href="/3">3</a></li>`);
  });

  it("lets a caller radius evict the button radius", async () => {
    expect(
      await render(
        <Pagination.Item href='/3' class='rounded-full'>
          3
        </Pagination.Item>,
      ),
    ).toBe(`<li><a data-slot="pagination-item" class="${ITEM_SM_ROUNDED_FULL}" href="/3">3</a></li>`);
  });

  it("merges its chrome onto a single element child under asChild", async () => {
    expect(
      await render(
        <Pagination.Item asChild current>
          <a href='/9'>9</a>
        </Pagination.Item>,
      ),
    ).toBe(`<li><a href="/9" aria-current="page" data-selected="" class="${ITEM_SM_CURRENT}" data-slot="pagination-item">9</a></li>`);
  });

  it("throws rather than degrading when asChild receives a string child", async () => {
    expect(() => render(<Pagination.Item asChild>9</Pagination.Item>)).toThrow(
      "Pagination.Item with asChild requires exactly one JSX element child (e.g. <a>); received a string, number, fragment, array, or empty child instead.",
    );
  });
});

describe("Pagination.Previous and Pagination.Next", () => {
  it("puts the glyph before the visible text on the previous link", async () => {
    expect(
      await render(
        <Pagination.Previous icon={icon} label='Previous page' href='/0'>
          Prev
        </Pagination.Previous>,
      ),
    ).toBe(`<li><a data-slot="pagination-previous" class="${STEP_SM}" href="/0">${LEFT}Prev<span class="sr-only">Previous page</span></a></li>`);
  });

  it("puts the glyph after the visible text on the next link", async () => {
    expect(
      await render(
        <Pagination.Next icon={icon} label='Next page' href='/2'>
          Next
        </Pagination.Next>,
      ),
    ).toBe(`<li><a data-slot="pagination-next" class="${STEP_SM}" href="/2">Next<span class="sr-only">Next page</span>${RIGHT}</a></li>`);
  });

  it("merges the previous-link chrome onto a single element child under asChild", async () => {
    expect(
      await render(
        <Pagination.Previous icon={icon} label='Previous page' asChild>
          <a href='/p'>Prev</a>
        </Pagination.Previous>,
      ),
    ).toBe(
      `<li><a href="/p" class="${STEP_SM}" data-slot="pagination-previous"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true"><use href="/sprite.svg#icon-chevron-left"></use></svg>Prev<span class="sr-only">Previous page</span></a></li>`,
    );
  });
});

// `Icon` is `aria-hidden` by default and `children` is optional, so an icon-only step link had no
// accessible name at all. `label` is required for the same reason `Pagination.Ellipsis` has always
// carried its own `sr-only` span.
describe("Pagination.Previous and Pagination.Next — the name is unavoidable", () => {
  it("names an icon-only step link even with no visible text", async () => {
    expect(await render(<Pagination.Previous icon={icon} label='Previous page' href='/0' />)).toBe(
      `<li><a data-slot="pagination-previous" class="${STEP_SM}" href="/0">${LEFT}<span class="sr-only">Previous page</span></a></li>`,
    );
    expect(await render(<Pagination.Next icon={icon} label='Next page' href='/2' />)).toBe(
      `<li><a data-slot="pagination-next" class="${STEP_SM}" href="/2"><span class="sr-only">Next page</span>${RIGHT}</a></li>`,
    );
  });
});

describe("Pagination.Ellipsis", () => {
  it("hides the glyph and names the gap for a screen reader", async () => {
    expect(await render(<Pagination.Ellipsis />)).toBe(
      '<li data-slot="pagination-ellipsis"><span aria-hidden="true" class="inline-flex size-control-sm items-center justify-center">…</span>' +
        '<span class="sr-only">More pages</span></li>',
    );
  });
});

describe("Pagination — the whole control", () => {
  it("renders steps, pages, a gap, and the current page in one tree", async () => {
    expect(
      await render(
        <Pagination>
          <Pagination.Previous icon={icon} label='Previous page' href='/0'>
            Prev
          </Pagination.Previous>
          <Pagination.Item href='/1'>1</Pagination.Item>
          <Pagination.Item href='/2' current>
            2
          </Pagination.Item>
          <Pagination.Ellipsis />
          <Pagination.Next icon={icon} label='Next page' href='/3'>
            Next
          </Pagination.Next>
        </Pagination>,
      ),
    ).toBe(
      '<nav aria-label="Pagination" data-slot="pagination">' +
        LIST +
        `<li><a data-slot="pagination-previous" class="${STEP_SM}" href="/0">${LEFT}Prev<span class="sr-only">Previous page</span></a></li>` +
        `<li><a data-slot="pagination-item" class="${ITEM_SM}" href="/1">1</a></li>` +
        `<li><a data-slot="pagination-item" class="${ITEM_SM_CURRENT}" aria-current="page" data-selected="" href="/2">2</a></li>` +
        '<li data-slot="pagination-ellipsis"><span aria-hidden="true" class="inline-flex size-control-sm items-center justify-center">…</span>' +
        '<span class="sr-only">More pages</span></li>' +
        `<li><a data-slot="pagination-next" class="${STEP_SM}" href="/3">Next<span class="sr-only">Next page</span>${RIGHT}</a></li>` +
        "</ul></nav>",
    );
  });

  // The icon is a required prop and used to render only on the non-asChild branch, so an `asChild`
  // Previous or Next came out with its visible text and no chevron at all.
  it("renders the required icon on an asChild Previous, before the child's own children", async () => {
    expect(
      await render(
        <Pagination.Previous icon={icon} label='Previous page' asChild rel='prev'>
          <a href='/p/1'>Previous</a>
        </Pagination.Previous>,
      ),
    ).toBe(
      '<li><a href="/p/1" rel="prev" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" data-slot="pagination-previous"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true"><use href="/sprite.svg#icon-chevron-left"></use></svg>Previous<span class="sr-only">Previous page</span></a></li>',
    );
  });

  it("renders the required icon on an asChild Next, after the child's own children", async () => {
    expect(
      await render(
        <Pagination.Next icon={icon} label='Next page' asChild rel='next'>
          <a href='/p/3'>Next</a>
        </Pagination.Next>,
      ),
    ).toBe(
      '<li><a href="/p/3" rel="next" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground" data-slot="pagination-next"><span class="sr-only">Next page</span>Next<svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true"><use href="/sprite.svg#icon-chevron-right"></use></svg></a></li>',
    );
  });
});
