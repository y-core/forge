/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, tagOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Breadcrumbs } from "./breadcrumbs";
import { createIcon } from "./icon";

const icon = createIcon("/sprite.svg", { "icon-chevron-right": "0 0 16 16" });
const slotsOf = (html: string) => [...html.matchAll(/data-slot="([^"]*)"/g)].map((match) => match[1]);

describe("Breadcrumbs", () => {
  it("renders the whole landmark exactly, its own slot token ahead of an inherited one and a forwarded value escaped", async () => {
    expect(await render(<Breadcrumbs class='mb-2' data-slot='trail' data-note={`R&D's "n" <x>`} />)).toBe(
      '<nav aria-label="Breadcrumb" data-slot="breadcrumbs trail" class="mb-2" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;">' +
        '<ol data-slot="breadcrumbs-list" class="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"></ol></nav>',
    );
  });

  it("labels the landmark Breadcrumb, so a screen reader names the trail without being told to", async () => {
    expect(attrsOf(await render(<Breadcrumbs />))).toEqual({ "aria-label": "Breadcrumb", "data-slot": "breadcrumbs" });
  });

  it("takes a caller label over the default", async () => {
    expect(attrsOf(await render(<Breadcrumbs label='Trail' />))).toEqual({ "aria-label": "Trail", "data-slot": "breadcrumbs" });
  });
});

describe("Breadcrumbs.Item", () => {
  it("carries nothing but its slot when it is not the current page", async () => {
    expect(attrsOf(await render(<Breadcrumbs.Item>Home</Breadcrumbs.Item>))).toEqual({ "data-slot": "breadcrumbs-item" });
  });

  it("announces the current page in ARIA and stamps the styling hook beside it", async () => {
    expect(attrsOf(await render(<Breadcrumbs.Item current>Now</Breadcrumbs.Item>))).toEqual({
      "data-slot": "breadcrumbs-item",
      "aria-current": "page",
      "data-selected": "",
    });
  });

  it("weights the current page rather than restyling the item wholesale", async () => {
    expect(
      variantClasses(await render(<Breadcrumbs.Item current>Now</Breadcrumbs.Item>), await render(<Breadcrumbs.Item>Now</Breadcrumbs.Item>)),
    ).toEqual({ added: ["font-medium", "text-foreground"], dropped: [] });
  });

  it("escapes a forwarded value on the item", async () => {
    expect(attrsOf(await render(<Breadcrumbs.Item data-note={`R&D's "n" <x>`}>Home</Breadcrumbs.Item>))).toEqual({
      "data-slot": "breadcrumbs-item",
      "data-note": "R&amp;D&#39;s &quot;n&quot; &lt;x&gt;",
    });
  });
});

describe("Breadcrumbs.Link", () => {
  it("renders an anchor, so the trail is navigable rather than merely legible", async () => {
    const html = await render(<Breadcrumbs.Link href='/'>Home</Breadcrumbs.Link>);

    expect(tagOf(html).startsWith("<a ")).toBe(true);
    expect(attrsOf(html)).toEqual({ "data-slot": "breadcrumbs-link", href: "/" });
  });

  it("lets a caller radius evict its own rather than sitting behind it", async () => {
    const html = await render(
      <Breadcrumbs.Link href='/a' class='rounded-lg'>
        A
      </Breadcrumbs.Link>,
    );

    expect(variantClasses(html, await render(<Breadcrumbs.Link href='/a'>A</Breadcrumbs.Link>))).toEqual({
      added: ["rounded-lg"],
      dropped: ["rounded-sm"],
    });
    expect(classesOf(html).at(-1)).toBe("rounded-lg");
  });

  it("merges its chrome onto a single element child under asChild, leaving the child's own tag", async () => {
    const html = await render(
      <Breadcrumbs.Link asChild>
        <a href='/x'>X</a>
      </Breadcrumbs.Link>,
    );

    expect(attrsOf(html)).toEqual({ href: "/x", "data-slot": "breadcrumbs-link" });
    expect(classesOf(html)).toEqual(classesOf(await render(<Breadcrumbs.Link href='/x'>X</Breadcrumbs.Link>)));
  });

  it("throws rather than degrading when asChild receives a string child", async () => {
    expect(() => render(<Breadcrumbs.Link asChild>X</Breadcrumbs.Link>)).toThrow(
      "Breadcrumbs.Link with asChild requires exactly one JSX element child (e.g. <a>); received a string, number, fragment, array, or empty child instead.",
    );
  });
});

describe("Breadcrumbs.Separator", () => {
  it("hides the glyph it was passed from assistive technology, which would otherwise read it aloud", async () => {
    const html = await render(<Breadcrumbs.Separator icon={icon} />);

    expect(attrsOf(html)).toEqual({ role: "presentation", "aria-hidden": "true", "data-slot": "breadcrumbs-separator" });
    expect(attrOf(html, "aria-hidden", 'data-slot="icon"')).toBe("true");
    expect([attrOf(html, "width", 'data-slot="icon"'), attrOf(html, "height", 'data-slot="icon"')]).toEqual(["14", "14"]);
  });

  it("renders caller children in place of the glyph rather than beside it", async () => {
    const html = await render(<Breadcrumbs.Separator icon={icon}>/</Breadcrumbs.Separator>);

    expect(tagOf(html, 'data-slot="icon"')).toBe("");
    expect(html.split(/<[^>]+>/).filter(Boolean)).toEqual(["/"]);
  });
});

describe("Breadcrumbs — the whole trail", () => {
  it("nests link, separator and current page inside the one ordered list", async () => {
    const html = await render(
      <Breadcrumbs>
        <Breadcrumbs.Item>
          <Breadcrumbs.Link href='/'>Home</Breadcrumbs.Link>
        </Breadcrumbs.Item>
        <Breadcrumbs.Separator icon={icon} />
        <Breadcrumbs.Item current>Now</Breadcrumbs.Item>
      </Breadcrumbs>,
    );

    expect(slotsOf(html)).toEqual([
      "breadcrumbs",
      "breadcrumbs-list",
      "breadcrumbs-item",
      "breadcrumbs-link",
      "breadcrumbs-separator",
      "icon",
      "breadcrumbs-item",
    ]);
    expect(html.split(/<[^>]+>/).filter(Boolean)).toEqual(["Home", "Now"]);
  });
});
