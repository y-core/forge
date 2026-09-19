/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf, classesOf, variantClasses } from "../../testing/markup";
import { render } from "../../testing/render";
import { Timeline } from "./timeline";

const MARKER = 'data-slot="timeline-marker"';

describe("Timeline", () => {
  it("renders the whole record exactly, a forwarded value escaped and the caller's state attribute winning", async () => {
    expect(await render(<Timeline data-note={`R&D's "n" <x>`} data-orientation='caller-wins' />)).toBe(
      '<ol data-slot="timeline" data-orientation="caller-wins" class="[--tone:var(--color-primary)] [--tone-fg:var(--color-primary-foreground)]' +
        " [--tone-text:var(--color-primary-text)] [--tone-soft:var(--color-primary-soft)] [--tone-soft-fg:var(--color-primary-soft-foreground)]" +
        ' [--tone-soft-border:var(--color-primary-soft-border)] group/timeline flex flex-col" data-note="R&amp;D&#39;s &quot;n&quot; &lt;x&gt;"></ol>',
    );
  });

  it("stacks the record down the block axis and says so in the state attribute", async () => {
    expect(attrsOf(await render(<Timeline />))).toEqual({ "data-slot": "timeline", "data-orientation": "vertical" });
  });

  it("lays a horizontal record along the inline axis rather than stacking it", async () => {
    const horizontal = await render(<Timeline orientation='horizontal' />);

    expect(attrOf(horizontal, "data-orientation")).toBe("horizontal");
    expect(variantClasses(horizontal, await render(<Timeline />))).toEqual({ added: [], dropped: ["flex-col"] });
  });

  it("swaps the whole tone palette every marker inherits rather than overlaying a second one", async () => {
    const { added, dropped } = variantClasses(await render(<Timeline tone='success' />), await render(<Timeline />));

    expect(added[0]).toBe("[--tone:var(--color-success)]");
    expect([...added, ...dropped].every((token) => token.startsWith("[--tone"))).toBe(true);
    expect(added.length).toBe(dropped.length);
  });

  it("appends a caller class after its own and keeps its slot token ahead of an inherited one", async () => {
    const html = await render(<Timeline class='p-2' data-slot='history' />);

    expect(classesOf(html).at(-1)).toBe("p-2");
    expect(attrOf(html, "data-slot")).toBe("timeline history");
  });
});

describe("Timeline.Item", () => {
  it("treats an item with no state as upcoming and hides its rule when it is last", async () => {
    const html = await render(<Timeline.Item />);

    expect(attrsOf(html)).toEqual({ "data-slot": "timeline-item", "data-state": "upcoming" });
    expect(classesOf(html, 'data-slot="timeline-rule"').filter((token) => token.startsWith("group-last/"))).toEqual([
      "group-last/timeline-item:hidden",
    ]);
  });

  it("fills the marker of a complete item from the inherited tone", async () => {
    expect(variantClasses(await render(<Timeline.Item state='complete' />), await render(<Timeline.Item />), MARKER)).toEqual({
      added: ["border-transparent", "bg-(--tone)", "text-(--tone-fg)"],
      dropped: ["border-border", "text-muted-foreground"],
    });
  });

  it("outlines the current item and claims no ARIA current, since a record is not a wizard", async () => {
    const html = await render(<Timeline.Item state='current' />);

    expect(attrsOf(html)).toEqual({ "data-slot": "timeline-item", "data-state": "current" });
    expect(variantClasses(html, await render(<Timeline.Item />), MARKER)).toEqual({
      added: ["border-(--tone-text)", "text-(--tone-text)"],
      dropped: ["border-border", "text-muted-foreground"],
    });
  });

  it("shows the marker it was given inside the circle a screen reader is told to skip", async () => {
    const html = await render(<Timeline.Item state='complete' marker='✓' />);

    expect(/data-slot="timeline-marker"[^>]*>([^<]*)</.exec(html)?.[1]).toBe("✓");
    expect(attrOf(html, "aria-hidden", 'data-slot="timeline-marker-column"')).toBe("true");
  });

  it("appends a caller class and forwards an attribute onto the item itself", async () => {
    const html = await render(<Timeline.Item class='p-2' data-note='a&b' />);

    expect(classesOf(html).at(-1)).toBe("p-2");
    expect(attrsOf(html)).toEqual({ "data-slot": "timeline-item", "data-state": "upcoming", "data-note": "a&amp;b" });
  });

  it("puts Time and Content in the body, in the order given", async () => {
    const html = await render(
      <Timeline.Item state='complete' marker='1'>
        <Timeline.Time datetime='2026-09-04'>4 Sep</Timeline.Time>
        <Timeline.Content>Shipped</Timeline.Content>
      </Timeline.Item>,
    );

    expect([...html.matchAll(/data-slot="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "timeline-item",
      "timeline-marker-column",
      "timeline-marker",
      "timeline-rule",
      "timeline-body",
      "timeline-time",
      "timeline-content",
    ]);
    expect(attrOf(html, "datetime", 'data-slot="timeline-time"')).toBe("2026-09-04");
  });
});

describe("Timeline.Time", () => {
  it("appends a caller class and escapes the datetime it was handed", async () => {
    const html = await render(<Timeline.Time class='font-medium' datetime={`R&D's "n" <x>`} />);

    expect(classesOf(html).at(-1)).toBe("font-medium");
    expect(attrOf(html, "datetime")).toBe("R&amp;D&#39;s &quot;n&quot; &lt;x&gt;");
  });
});

describe("Timeline.Content", () => {
  it("appends a caller class and escapes a forwarded value", async () => {
    const html = await render(<Timeline.Content class='p-2' data-note={`R&D's "n" <x>`} />);

    expect(classesOf(html).at(-1)).toBe("p-2");
    expect(attrsOf(html)).toEqual({ "data-slot": "timeline-content", "data-note": "R&amp;D&#39;s &quot;n&quot; &lt;x&gt;" });
  });
});

describe("Timeline — the whole record", () => {
  it("renders the three states under one tone declaration", async () => {
    const html = await render(
      <Timeline>
        <Timeline.Item state='complete' marker='1' />
        <Timeline.Item state='current' marker='2' />
        <Timeline.Item marker='3' />
      </Timeline>,
    );

    expect([...html.matchAll(/data-state="([^"]+)"/g)].map((match) => match[1])).toEqual(["complete", "current", "upcoming"]);
    expect(html.match(/\[--tone:/g)).toHaveLength(1);
  });
});

describe("Timeline.Item — forge-ui-not-color-alone", () => {
  it("names every state in a visually-hidden span, so completion reaches a reader without aria-current", async () => {
    const rendered = await Promise.all((["complete", "current", "upcoming"] as const).map((state) => render(<Timeline.Item state={state} />)));

    expect(rendered.map((html) => html.match(/<span class="sr-only">([^<]*)<\/span>/)?.[1])).toEqual(["Completed", "Current", "Not started"]);
    expect(rendered.map((html) => attrOf(html, "aria-current"))).toEqual(["", "", ""]);
  });
});

describe("Timeline.Item — stateLabel", () => {
  it("replaces the shipped state word on the one entry given it, leaving its siblings alone", async () => {
    const overridden = await render(<Timeline.Item state='current' stateLabel='En cours' />);
    const shipped = await render(<Timeline.Item state='current' />);

    expect(/<span class="sr-only">([^<]*)<\/span>/.exec(overridden)?.[1]).toBe("En cours");
    expect(/<span class="sr-only">([^<]*)<\/span>/.exec(shipped)?.[1]).toBe("Current");
  });
});
