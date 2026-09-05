/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { Breadcrumbs } from "./breadcrumbs";
import { createIcon } from "./icon";

const icon = createIcon("/sprite.svg", { "icon-chevron-right": "0 0 16 16" });

const LIST = '<ol data-slot="breadcrumbs-list" class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">';
const ITEM_CLASS = "inline-flex items-center gap-1.5";
const LINK_CLASS = "focus-ring rounded-sm hover:text-foreground";
const CHEVRON =
  '<svg data-slot="icon" width="14" height="14" viewBox="0 0 16 16" class="" aria-hidden="true"><use href="/sprite.svg#icon-chevron-right"></use></svg>';

describe("Breadcrumbs", () => {
  it("labels the landmark Breadcrumb and wraps its children in an ordered list", async () => {
    expect(await render(<Breadcrumbs />)).toBe(`<nav aria-label="Breadcrumb" data-slot="breadcrumbs">${LIST}</ol></nav>`);
  });

  it("takes a caller label over the default", async () => {
    expect(await render(<Breadcrumbs label='Trail' />)).toBe(`<nav aria-label="Trail" data-slot="breadcrumbs">${LIST}</ol></nav>`);
  });

  it("keeps its own slot token ahead of an inherited one and escapes a forwarded value", async () => {
    expect(await render(<Breadcrumbs class='mb-2' data-slot='trail' data-note={`R&D's "n" <x>`} />)).toBe(
      '<nav aria-label="Breadcrumb" data-slot="breadcrumbs trail" class="mb-2" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;">' +
        `${LIST}</ol></nav>`,
    );
  });
});

describe("Breadcrumbs.Item", () => {
  it("renders a plain list item when it is not the current page", async () => {
    expect(await render(<Breadcrumbs.Item>Home</Breadcrumbs.Item>)).toBe(`<li data-slot="breadcrumbs-item" class="${ITEM_CLASS}">Home</li>`);
  });

  it("announces the current page in ARIA and stamps the styling hook beside it", async () => {
    expect(await render(<Breadcrumbs.Item current>Now</Breadcrumbs.Item>)).toBe(
      `<li data-slot="breadcrumbs-item" aria-current="page" data-selected="" class="${ITEM_CLASS} font-medium text-foreground">Now</li>`,
    );
  });

  it("escapes a forwarded value on the item", async () => {
    expect(await render(<Breadcrumbs.Item data-note={`R&D's "n" <x>`}>Home</Breadcrumbs.Item>)).toBe(
      `<li data-slot="breadcrumbs-item" class="${ITEM_CLASS}" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;">Home</li>`,
    );
  });
});

describe("Breadcrumbs.Link", () => {
  it("renders an anchor carrying the link chrome", async () => {
    expect(await render(<Breadcrumbs.Link href='/'>Home</Breadcrumbs.Link>)).toBe(
      `<a data-slot="breadcrumbs-link" class="${LINK_CLASS}" href="/">Home</a>`,
    );
  });

  it("lets a caller radius evict its own", async () => {
    expect(
      await render(
        <Breadcrumbs.Link href='/a' class='rounded-lg'>
          A
        </Breadcrumbs.Link>,
      ),
    ).toBe('<a data-slot="breadcrumbs-link" class="focus-ring hover:text-foreground rounded-lg" href="/a">A</a>');
  });

  it("merges its chrome onto a single element child under asChild", async () => {
    expect(
      await render(
        <Breadcrumbs.Link asChild>
          <a href='/x'>X</a>
        </Breadcrumbs.Link>,
      ),
    ).toBe(`<a href="/x" class="${LINK_CLASS}" data-slot="breadcrumbs-link">X</a>`);
  });

  it("throws rather than degrading when asChild receives a string child", async () => {
    expect(() => render(<Breadcrumbs.Link asChild>X</Breadcrumbs.Link>)).toThrow(
      "Breadcrumbs.Link with asChild requires exactly one JSX element child (e.g. <a>); received a string, number, fragment, array, or empty child instead.",
    );
  });
});

describe("Breadcrumbs.Separator", () => {
  it("hides the passed glyph from assistive technology", async () => {
    expect(await render(<Breadcrumbs.Separator icon={icon} />)).toBe(
      `<li role="presentation" aria-hidden="true" data-slot="breadcrumbs-separator">${CHEVRON}</li>`,
    );
  });

  it("renders caller children in place of the glyph", async () => {
    expect(await render(<Breadcrumbs.Separator>/</Breadcrumbs.Separator>)).toBe(
      '<li role="presentation" aria-hidden="true" data-slot="breadcrumbs-separator">/</li>',
    );
  });
});

describe("Breadcrumbs — the whole trail", () => {
  it("renders links, separators, and the current page in one tree", async () => {
    expect(
      await render(
        <Breadcrumbs>
          <Breadcrumbs.Item>
            <Breadcrumbs.Link href='/'>Home</Breadcrumbs.Link>
          </Breadcrumbs.Item>
          <Breadcrumbs.Separator icon={icon} />
          <Breadcrumbs.Item current>Now</Breadcrumbs.Item>
        </Breadcrumbs>,
      ),
    ).toBe(
      '<nav aria-label="Breadcrumb" data-slot="breadcrumbs">' +
        LIST +
        `<li data-slot="breadcrumbs-item" class="${ITEM_CLASS}"><a data-slot="breadcrumbs-link" class="${LINK_CLASS}" href="/">Home</a></li>` +
        `<li role="presentation" aria-hidden="true" data-slot="breadcrumbs-separator">${CHEVRON}</li>` +
        `<li data-slot="breadcrumbs-item" aria-current="page" data-selected="" class="${ITEM_CLASS} font-medium text-foreground">Now</li>` +
        "</ol></nav>",
    );
  });
});
