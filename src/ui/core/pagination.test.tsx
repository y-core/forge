/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrsOf, classesOf, variantClasses } from "./core.fixture";
import { createIcon } from "./icon";
import { Pagination } from "./pagination";

const icon = createIcon("/sprite.svg", { "icon-chevron-left": "0 0 16 16", "icon-chevron-right": "0 0 16 16" });

const LEFT =
  '<svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true"><use href="/sprite.svg#icon-chevron-left"></use></svg>';
const RIGHT =
  '<svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true"><use href="/sprite.svg#icon-chevron-right"></use></svg>';

const ITEM = 'data-slot="pagination-item"';
const PREVIOUS = 'data-slot="pagination-previous"';
const NEXT = 'data-slot="pagination-next"';
const CURRENT = 'aria-current="page"';

function contentOf(html: string, tag: string): string {
  return new RegExp(`<${tag}[^>]*>(.*)</${tag}>`).exec(html)?.[1] ?? "";
}

function slotsOf(html: string): string[] {
  return [...html.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1] ?? "");
}

function spansOf(html: string): string[] {
  return [...html.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((match) => match[1] ?? "");
}

describe("Pagination", () => {
  it("renders the whole landmark exactly, its own slot token ahead of an inherited one and a forwarded value escaped", async () => {
    expect(await render(<Pagination class='mt-4' data-slot='pager' data-note={`R&D's "n" <x>`} />)).toBe(
      '<nav aria-label="Pagination" data-slot="pagination pager" class="mt-4" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;">' +
        '<ul data-slot="pagination-list" class="flex items-center gap-1"></ul></nav>',
    );
  });

  it("labels the landmark Pagination and stamps no size of its own — each child carries the size that paints it", async () => {
    const html = await render(<Pagination />);

    expect(attrsOf(html)).toEqual({ "aria-label": "Pagination", "data-slot": "pagination" });
    expect(slotsOf(html)).toEqual(["pagination", "pagination-list"]);
  });

  it("takes a caller label, so two paginations on one page are told apart by a screen reader", async () => {
    expect(attrsOf(await render(<Pagination label='Pages' />))).toEqual({ "aria-label": "Pages", "data-slot": "pagination" });
  });
});

describe("Pagination.Item", () => {
  it("paints a page link at the small size without being asked, which is the size the list is built for", async () => {
    expect(
      variantClasses(
        await render(
          <Pagination.Item href='/1' size='sm'>
            1
          </Pagination.Item>,
        ),
        await render(<Pagination.Item href='/1'>1</Pagination.Item>),
        ITEM,
      ),
    ).toEqual({ added: [], dropped: [] });
  });

  it("announces the current page in ARIA beside the styling hook, so neither reader depends on the other", async () => {
    expect(
      attrsOf(
        await render(
          <Pagination.Item href='/2' current>
            2
          </Pagination.Item>,
        ),
        ITEM,
      ),
    ).toEqual({ "data-slot": "pagination-item", "aria-current": "page", "data-selected": "", href: "/2" });
  });

  it("fills the current page with the primary tone and evicts the ghost chrome it conflicts with", async () => {
    expect(
      variantClasses(
        await render(
          <Pagination.Item href='/2' current>
            2
          </Pagination.Item>,
        ),
        await render(<Pagination.Item href='/2'>2</Pagination.Item>),
        ITEM,
      ),
    ).toEqual({
      added: [
        "[--tone:var(--color-primary)]",
        "[--tone-fg:var(--color-primary-foreground)]",
        "[--tone-text:var(--color-primary-text)]",
        "[--tone-soft:var(--color-primary-soft)]",
        "[--tone-soft-fg:var(--color-primary-soft-foreground)]",
        "[--tone-soft-border:var(--color-primary-soft-border)]",
        "bg-(--tone)",
        "text-(--tone-fg)",
        "[--focus-ring:var(--tone-fg)]",
        "hover:bg-[color-mix(in_oklab,var(--tone),var(--color-background)_12%)]",
      ],
      dropped: [
        "[--tone:var(--color-foreground)]",
        "[--tone-fg:var(--color-background)]",
        "[--tone-text:var(--color-foreground)]",
        "[--tone-soft:var(--color-muted)]",
        "[--tone-soft-fg:var(--color-foreground)]",
        "[--tone-soft-border:var(--color-border)]",
        "bg-transparent",
        "[--focus-ring:var(--color-ring)]",
        "text-foreground",
        "hover:bg-accent",
        "hover:text-accent-foreground",
      ],
    });
  });

  it("swaps the control height and width for the medium size rather than painting two of them", async () => {
    expect(
      variantClasses(
        await render(
          <Pagination.Item href='/3' size='md'>
            3
          </Pagination.Item>,
        ),
        await render(<Pagination.Item href='/3'>3</Pagination.Item>),
        ITEM,
      ),
    ).toEqual({ added: ["h-control-md", "w-control-md"], dropped: ["h-control-sm", "w-control-sm"] });
  });

  it("takes the large control height on the current page, type step included", async () => {
    expect(
      variantClasses(
        await render(
          <Pagination.Item href='/3' size='lg' current>
            3
          </Pagination.Item>,
        ),
        await render(
          <Pagination.Item href='/3' current>
            3
          </Pagination.Item>,
        ),
        ITEM,
      ),
    ).toEqual({ added: ["h-control-lg", "text-base", "w-control-lg"], dropped: ["h-control-sm", "text-sm", "w-control-sm"] });
  });

  it("lets a caller radius evict the button radius instead of landing beside it", async () => {
    expect(
      variantClasses(
        await render(
          <Pagination.Item href='/3' class='rounded-full'>
            3
          </Pagination.Item>,
        ),
        await render(<Pagination.Item href='/3'>3</Pagination.Item>),
        ITEM,
      ),
    ).toEqual({ added: ["rounded-full"], dropped: ["rounded-field"] });
  });

  it("merges its chrome onto a single element child under asChild, giving it the same paint as its own anchor", async () => {
    const html = await render(
      <Pagination.Item asChild current>
        <a href='/9'>9</a>
      </Pagination.Item>,
    );

    expect(attrsOf(html, ITEM)).toEqual({ href: "/9", "aria-current": "page", "data-selected": "", "data-slot": "pagination-item" });
    expect(contentOf(html, "a")).toBe("9");
    expect(classesOf(html, ITEM)).toEqual(
      classesOf(
        await render(
          <Pagination.Item href='/9' current>
            9
          </Pagination.Item>,
        ),
        ITEM,
      ),
    );
  });

  it("throws rather than degrading when asChild receives a string child", async () => {
    expect(() => render(<Pagination.Item asChild>9</Pagination.Item>)).toThrow(
      "Pagination.Item with asChild requires exactly one JSX element child (e.g. <a>); received a string, number, fragment, array, or empty child instead.",
    );
  });
});

describe("Pagination.Previous and Pagination.Next", () => {
  it("puts the glyph before the visible text on the previous link, the direction it points", async () => {
    const html = await render(
      <Pagination.Previous icon={icon} label='Previous page' href='/0'>
        Prev
      </Pagination.Previous>,
    );

    expect(attrsOf(html, PREVIOUS)).toEqual({ "data-slot": "pagination-previous", href: "/0" });
    expect(contentOf(html, "a")).toBe(`${LEFT}Prev<span class="sr-only">Previous page</span>`);
  });

  it("puts the glyph after the visible text on the next link, the direction it points", async () => {
    const html = await render(
      <Pagination.Next icon={icon} label='Next page' href='/2'>
        Next
      </Pagination.Next>,
    );

    expect(attrsOf(html, NEXT)).toEqual({ "data-slot": "pagination-next", href: "/2" });
    expect(contentOf(html, "a")).toBe(`Next<span class="sr-only">Next page</span>${RIGHT}`);
  });

  it("merges the previous-link chrome onto a single element child under asChild", async () => {
    const html = await render(
      <Pagination.Previous icon={icon} label='Previous page' asChild>
        <a href='/p'>Prev</a>
      </Pagination.Previous>,
    );

    expect(attrsOf(html, PREVIOUS)).toEqual({ href: "/p", "data-slot": "pagination-previous" });
    expect(classesOf(html, PREVIOUS)).toEqual(
      classesOf(await render(<Pagination.Previous icon={icon} label='Previous page' href='/p' />), PREVIOUS),
    );
  });
});

// `Icon` is `aria-hidden` by default and `children` is optional, so without a required `label` an
// icon-only step link would carry no accessible name at all.
describe("Pagination.Previous and Pagination.Next — the name is unavoidable", () => {
  it("names an icon-only step link even with no visible text", async () => {
    expect([
      contentOf(await render(<Pagination.Previous icon={icon} label='Previous page' href='/0' />), "a"),
      contentOf(await render(<Pagination.Next icon={icon} label='Next page' href='/2' />), "a"),
    ]).toEqual([`${LEFT}<span class="sr-only">Previous page</span>`, `<span class="sr-only">Next page</span>${RIGHT}`]);
  });
});

describe("Pagination.Ellipsis", () => {
  it("hides the glyph and names the gap for a screen reader", async () => {
    const html = await render(<Pagination.Ellipsis />);

    expect(attrsOf(html)).toEqual({ "data-slot": "pagination-ellipsis" });
    expect(attrsOf(html, 'aria-hidden="true"')).toEqual({ "aria-hidden": "true" });
    expect(spansOf(html)).toEqual(["…", "More pages"]);
  });
});

describe("Pagination — the whole control", () => {
  it("renders steps, pages, a gap, and the current page in one tree, in the order they were written", async () => {
    const html = await render(
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
    );

    expect(slotsOf(html)).toEqual([
      "pagination",
      "pagination-list",
      "pagination-previous",
      "icon",
      "pagination-item",
      "pagination-item",
      "pagination-ellipsis",
      "pagination-next",
      "icon",
    ]);
    expect(attrsOf(html, CURRENT)).toEqual({ "data-slot": "pagination-item", "aria-current": "page", "data-selected": "", href: "/2" });
  });

  // The icon is a required prop and used to render only on the non-asChild branch, so an `asChild`
  // Previous or Next came out with its visible text and no chevron at all.
  it("renders the required icon on an asChild Previous, before the child's own children", async () => {
    const html = await render(
      <Pagination.Previous icon={icon} label='Previous page' asChild rel='prev'>
        <a href='/p/1'>Previous</a>
      </Pagination.Previous>,
    );

    expect(attrsOf(html, PREVIOUS)).toEqual({ href: "/p/1", rel: "prev", "data-slot": "pagination-previous" });
    expect(contentOf(html, "a")).toBe(`${LEFT}Previous<span class="sr-only">Previous page</span>`);
  });

  it("renders the required icon on an asChild Next, after the child's own children", async () => {
    const html = await render(
      <Pagination.Next icon={icon} label='Next page' asChild rel='next'>
        <a href='/p/3'>Next</a>
      </Pagination.Next>,
    );

    expect(attrsOf(html, NEXT)).toEqual({ href: "/p/3", rel: "next", "data-slot": "pagination-next" });
    expect(contentOf(html, "a")).toBe(`<span class="sr-only">Next page</span>Next${RIGHT}`);
  });
});
