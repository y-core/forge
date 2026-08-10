import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { ScrollArea } from "./scroll-area";

/**
 * `core/ScrollArea`'s SSR markup, pinned exactly.
 *
 * The component is CSS and nothing else — no scroll listener, no custom scrollbar — so the emitted
 * string *is* the whole implementation, and these assertions are the only place the utilities that
 * make it scroll are pinned. `tabindex="0"` on the viewport is asserted for the same reason: a
 * scrollable region that cannot be focused cannot be scrolled from the keyboard, and losing the
 * attribute changes nothing a mouse-driven behaviour test would notice.
 */

const VIEWPORT_BASE =
  "h-full w-full overflow-auto overscroll-contain rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]";

describe("ScrollArea", () => {
  it("defaults to a vertical region and says so in the state attribute", async () => {
    expect(await render(<ScrollArea />)).toBe('<div data-slot="scroll-area" data-orientation="vertical" class="relative"></div>');
  });

  it("carries a horizontal orientation through without changing the containing box", async () => {
    expect(await render(<ScrollArea orientation='horizontal' />)).toBe(
      '<div data-slot="scroll-area" data-orientation="horizontal" class="relative"></div>',
    );
  });

  it("merges a caller class onto the positioning base", async () => {
    expect(await render(<ScrollArea class='h-48 w-64 rounded-md border border-border' />)).toBe(
      '<div data-slot="scroll-area" data-orientation="vertical" class="relative h-48 w-64 rounded-md border border-border"></div>',
    );
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(await render(<ScrollArea data-slot='log-pane' />)).toBe(
      '<div data-slot="scroll-area log-pane" data-orientation="vertical" class="relative"></div>',
    );
  });

  it("escapes arbitrary data-* and aria-* values spread onto the root", async () => {
    expect(await render(<ScrollArea data-note={`R&D's "logs" <all>`} aria-label={`R&D's log pane`} />)).toBe(
      '<div data-slot="scroll-area" data-orientation="vertical" class="relative" ' +
        'data-note="R&amp;D&#39;s &quot;logs&quot; &lt;all&gt;" aria-label="R&amp;D&#39;s log pane"></div>',
    );
  });

  it("renders the whole compound in one tree", async () => {
    expect(
      await render(
        <ScrollArea class='h-48'>
          <ScrollArea.Viewport>Log line</ScrollArea.Viewport>
        </ScrollArea>,
      ),
    ).toBe(
      '<div data-slot="scroll-area" data-orientation="vertical" class="relative h-48">' +
        `<div data-slot="scroll-area-viewport" tabindex="0" class="${VIEWPORT_BASE}">Log line</div>` +
        "</div>",
    );
  });
});

describe("ScrollArea.Viewport", () => {
  it("renders the focusable scrolling element with its overflow utilities", async () => {
    expect(await render(<ScrollArea.Viewport>Log line</ScrollArea.Viewport>)).toBe(
      `<div data-slot="scroll-area-viewport" tabindex="0" class="${VIEWPORT_BASE}">Log line</div>`,
    );
  });

  it("merges a caller class, appends an inherited slot token, and escapes children", async () => {
    expect(
      await render(
        <ScrollArea.Viewport class='p-2' data-slot='log-viewport'>
          {`R&D's <logs>`}
        </ScrollArea.Viewport>,
      ),
    ).toBe(`<div data-slot="scroll-area-viewport log-viewport" tabindex="0" class="${VIEWPORT_BASE} p-2">R&amp;D&#39;s &lt;logs&gt;</div>`);
  });

  it("lets a caller class override the conflicting overflow utility rather than stacking on it", async () => {
    expect(await render(<ScrollArea.Viewport class='overflow-hidden'>Log line</ScrollArea.Viewport>)).toBe(
      '<div data-slot="scroll-area-viewport" tabindex="0" class="h-full w-full overscroll-contain rounded-[inherit] outline-none ' +
        "focus-visible:ring-2 focus-visible:ring-ring [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent] " +
        'overflow-hidden">Log line</div>',
    );
  });
});
