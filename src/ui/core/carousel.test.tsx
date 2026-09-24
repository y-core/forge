/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { LABEL_DEFAULTS } from "../contracts/labels";
import { Carousel } from "./carousel";

const STRIP = 'data-slot="carousel-strip"';
const DOT = 'data-slot="pagination-item"';

const dots = (html: string): { href: string; label: string; current: boolean }[] =>
  [...html.matchAll(/<a [^>]*>/g)].map((match) => ({
    href: attrOf(match[0], "href"),
    label: attrOf(match[0], "aria-label"),
    current: match[0].includes('aria-current="location"'),
  }));

describe("Carousel", () => {
  it("renders the whole root and strip exactly, a forwarded value escaped", async () => {
    expect(await render(<Carousel data-note={`R&D's "n" <x>`} />)).toBe(
      '<div data-slot="carousel" data-snap="start" class="relative" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;">' +
        '<div data-slot="carousel-strip" role="group" aria-label="Slides" tabindex="0"' +
        ' class="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain rounded-box [scrollbar-width:thin] motion-safe:scroll-smooth">' +
        "</div></div>",
    );
  });

  it("snaps to the start and says so on the root, where a controller reads it", async () => {
    expect(attrsOf(await render(<Carousel />))).toEqual({ "data-slot": "carousel", "data-snap": "start" });
    expect(attrOf(await render(<Carousel snap='center' />), "data-snap")).toBe("center");
  });

  // A roledescription and a name are both dropped by the user agent on a roleless element, so the
  // three attributes are one decision: without the role, neither of the others reaches a reader.
  it("becomes a named region renamed `carousel` when it has a name, and stays a plain wrapper without one", async () => {
    expect(attrsOf(await render(<Carousel label='Featured' />))).toEqual({
      "data-slot": "carousel",
      "data-snap": "start",
      role: "region",
      "aria-roledescription": "carousel",
      "aria-label": "Featured",
    });
  });

  it("merges a caller class onto the root and never onto the strip, keeping its own slot token first", async () => {
    const html = await render(<Carousel class='w-96' data-slot='hero' />);

    expect(attrOf(html, "data-slot")).toBe("carousel hero");
    expect(classesOf(html).at(-1)).toBe("w-96");
    expect(classesOf(html, STRIP)).toEqual(classesOf(await render(<Carousel />), STRIP));
  });

  it("makes the strip a named tab stop, because WCAG 2.1.1 requires the scrolling region to be reachable", async () => {
    expect(attrsOf(await render(<Carousel />), STRIP)).toEqual({
      "data-slot": "carousel-strip",
      role: "group",
      "aria-label": "Slides",
      tabindex: "0",
    });
  });

  it("names the strip from stripLabel, ahead of the root's own label", async () => {
    const html = await render(<Carousel label='Featured' stripLabel='Featured slides' />);

    expect(attrOf(html, "aria-label")).toBe("Featured");
    expect(attrOf(html, "aria-label", STRIP)).toBe("Featured slides");
  });
});

describe("Carousel.Item", () => {
  it("is a full-width slide snapping to the start, carrying the id a dot links to", async () => {
    const html = await render(<Carousel.Item id='s-1'>One</Carousel.Item>);

    expect(attrsOf(html)).toEqual({ "data-slot": "carousel-item", role: "group", id: "s-1" });
    expect(classesOf(html)).toEqual(["w-full", "shrink-0", "snap-start"]);
  });

  it("snaps to the centre instead when told, rather than snapping to both", async () => {
    expect(variantClasses(await render(<Carousel.Item snap='center' />), await render(<Carousel.Item />))).toEqual({
      added: ["snap-center"],
      dropped: ["snap-start"],
    });
  });

  // All-or-nothing, mirroring the root: renaming the role without naming the thing leaves a reader
  // told "slide" and nothing about which slide.
  it("calls itself a slide only when it has a name", async () => {
    expect(attrsOf(await render(<Carousel.Item label='Rainfall, 1990–2020' />))).toEqual({
      "data-slot": "carousel-item",
      role: "group",
      "aria-roledescription": "slide",
      "aria-label": "Rainfall, 1990–2020",
    });
  });

  it("lets a caller width evict the full-width default, and escapes a forwarded value", async () => {
    const html = await render(<Carousel.Item class='w-1/2' data-note={`R&D's "n" <x>`} />);

    expect(variantClasses(html, await render(<Carousel.Item />))).toEqual({ added: ["w-1/2"], dropped: ["w-full"] });
    expect(attrOf(html, "data-note")).toBe("R&amp;D&#39;s &quot;n&quot; &lt;x&gt;");
  });
});

describe("Carousel.Dots", () => {
  it("is Pagination by anchor, one dot per id in strip order, with the slide on show marked current", async () => {
    const html = await render(<Carousel.Dots ids={["s-1", "s-2", "s-3"]} current={1} />);

    expect(attrsOf(html)).toEqual({ role: "group", "aria-label": "Slides", "data-slot": "pagination carousel-dots" });
    expect(dots(html)).toEqual([
      { href: "#s-1", label: "Slide 1", current: false },
      { href: "#s-2", label: "Slide 2", current: true },
      { href: "#s-3", label: "Slide 3", current: false },
    ]);
  });

  it("marks the first slide current by default, and takes a label, a class and a forwarded value", async () => {
    const html = await render(<Carousel.Dots ids={["s-1"]} label='Photos' class='mt-6' data-note={`R&D's "n" <x>`} />);

    expect(attrsOf(html)).toEqual({
      role: "group",
      "aria-label": "Photos",
      "data-slot": "pagination carousel-dots",
      "data-note": "R&amp;D&#39;s &quot;n&quot; &lt;x&gt;",
    });
    expect(classesOf(html).at(-1)).toBe("mt-6");
    expect(dots(html)[0]?.current).toBe(true);
  });

  it("hands its size down to every dot, which is the only way a dot gets one", async () => {
    expect(variantClasses(await render(<Carousel.Dots ids={["s-1"]} size='md' />), await render(<Carousel.Dots ids={["s-1"]} />), DOT)).toEqual({
      added: ["h-control-md", "w-control-md"],
      dropped: ["h-control-sm", "w-control-sm"],
    });
  });
});

describe("Carousel.Dots — current outside the slide range", () => {
  // `current` is a public `number` with no clamp of its own, so `-1` or `9` used to mark no dot at
  // all — and a row with nothing marked leaves the controller no selected paint to read.
  it("marks exactly one dot whatever index the caller passes", async () => {
    for (const current of [-1, 9, Number.NaN, 1.7]) {
      const html = await render(<Carousel.Dots ids={["a", "b", "c"]} current={current} />);

      expect(dots(html).filter((dot) => dot.current).length).toBe(1);
    }
  });

  it("clamps below the range to the first dot and above it to the last", async () => {
    const below = await render(<Carousel.Dots ids={["a", "b", "c"]} current={-4} />);
    const above = await render(<Carousel.Dots ids={["a", "b", "c"]} current={7} />);

    expect(dots(below).findIndex((dot) => dot.current)).toBe(0);
    expect(dots(above).findIndex((dot) => dot.current)).toBe(2);
  });
});

describe("Carousel.Dots — slideLabel", () => {
  it("names every dot from the prop, so the per-slide word is the caller's and not forge's English", async () => {
    const html = await render(<Carousel.Dots ids={["a", "b", "c"]} slideLabel={(position) => `Diapositive ${position}`} />);

    expect([...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1])).toEqual([
      LABEL_DEFAULTS.carouselDots,
      "Diapositive 1",
      "Diapositive 2",
      "Diapositive 3",
    ]);
  });

  it("falls back to the table's word in position order, which is the only English left here", async () => {
    const html = await render(<Carousel.Dots ids={["a", "b"]} />);

    expect([...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1])).toEqual([
      LABEL_DEFAULTS.carouselDots,
      `${LABEL_DEFAULTS.carouselSlide} 1`,
      `${LABEL_DEFAULTS.carouselSlide} 2`,
    ]);
  });
});
