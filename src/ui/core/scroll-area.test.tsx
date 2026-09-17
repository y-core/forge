import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { attrOf, attrsOf, classesOf, variantClasses } from "./core.fixture";
import { ScrollArea } from "./scroll-area";

const viewport = (props: Omit<Parameters<typeof ScrollArea.Viewport>[0], "label"> = {}) => render(<ScrollArea.Viewport label='Log' {...props} />);

describe("ScrollArea", () => {
  it("renders the whole region and its viewport exactly, label, children and forwarded values escaped", async () => {
    expect(
      await render(
        <ScrollArea class='h-48' data-note={`R&D's "logs" <all>`}>
          <ScrollArea.Viewport label={`R&D's "log" <pane>`}>{`R&D's <logs>`}</ScrollArea.Viewport>
        </ScrollArea>,
      ),
    ).toBe(
      '<div data-slot="scroll-area" data-orientation="vertical" class="relative h-48" data-note="R&amp;D&#39;s &quot;logs&quot; &lt;all&gt;">' +
        '<section data-slot="scroll-area-viewport" aria-label="R&amp;D&#39;s &quot;log&quot; &lt;pane&gt;" tabindex="0"' +
        ' class="h-full max-h-[inherit] w-full overflow-auto overscroll-contain rounded-[inherit] focus-ring' +
        ' [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]">R&amp;D&#39;s &lt;logs&gt;</section></div>',
    );
  });

  it("defaults to a vertical region and says so in the state attribute", async () => {
    expect(attrsOf(await render(<ScrollArea />))).toEqual({ "data-slot": "scroll-area", "data-orientation": "vertical" });
  });

  it("carries a horizontal orientation through without changing the containing box, which the viewport's overflow already handles", async () => {
    const html = await render(<ScrollArea orientation='horizontal' />);

    expect(attrsOf(html)).toEqual({ "data-slot": "scroll-area", "data-orientation": "horizontal" });
    expect(variantClasses(html, await render(<ScrollArea />))).toEqual({ added: [], dropped: [] });
  });

  it("appends a caller class after its own, so a caller sizes the box the viewport scrolls inside", async () => {
    expect(classesOf(await render(<ScrollArea class='h-48 w-64' />)).at(-1)).toBe("w-64");
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(attrOf(await render(<ScrollArea data-slot='log-pane' />), "data-slot")).toBe("scroll-area log-pane");
  });
});

describe("ScrollArea.Viewport", () => {
  it("is a named tab stop, because a keyboard user who cannot reach the region cannot scroll it", async () => {
    expect(attrsOf(await viewport())).toEqual({ "data-slot": "scroll-area-viewport", "aria-label": "Log", tabindex: "0" });
  });

  it("is the element that scrolls, bounded by an inherited max-height so it cannot spill out of the root", async () => {
    const classes = classesOf(await viewport());

    expect(classes.filter((token) => token.startsWith("over"))).toEqual(["overflow-auto", "overscroll-contain"]);
    expect(classes.filter((token) => token.startsWith("max-h"))).toEqual(["max-h-[inherit]"]);
  });

  it("lets a caller class override the conflicting overflow utility rather than stacking on it", async () => {
    expect(variantClasses(await viewport({ class: "overflow-hidden" }), await viewport())).toEqual({
      added: ["overflow-hidden"],
      dropped: ["overflow-auto"],
    });
  });

  it("merges a caller class last and keeps its own slot token ahead of an inherited one", async () => {
    const html = await viewport({ class: "p-2", "data-slot": "log-viewport" });

    expect(classesOf(html).at(-1)).toBe("p-2");
    expect(attrOf(html, "data-slot")).toBe("scroll-area-viewport log-viewport");
  });
});
