import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Toggle } from "./toggle";

/**
 * `core/Toggle`'s SSR markup, pinned exactly.
 *
 * `toggle.browser.ts` proves the button flips when clicked. This proves what the server hands the
 * browser before any of that runs — and specifically that `aria-pressed` and `data-pressed` are
 * emitted *together*, which is the pair `UI_SSR_COMPONENTS.md` §4b names: a screen reader reads the
 * first, a stylesheet matches the second, and a test asserting only one leaves the other free to
 * disappear. The `data-on-click` is asserted for the same reason — the scope is lazy, so a Toggle
 * that lost it would render as a button nothing can ever resume.
 */

const TOGGLE_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium " +
  "bg-transparent text-foreground border border-input cursor-pointer outline-none " +
  "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring " +
  "aria-pressed:bg-primary aria-pressed:text-primary-foreground " +
  "disabled:pointer-events-none disabled:opacity-50";

const HEAD = '<button type="button" data-slot="toggle" data-scope="toggle" data-on-click="toggle"';

describe("Toggle", () => {
  it("renders an unpressed button carrying the scope and its own delegation attribute", async () => {
    expect(await render(<Toggle>Bold</Toggle>)).toBe(`${HEAD} aria-pressed="false" class="${TOGGLE_BASE}">Bold</button>`);
  });

  it("stamps aria-pressed and data-pressed together when pressed", async () => {
    expect(await render(<Toggle pressed>Bold</Toggle>)).toBe(`${HEAD} aria-pressed="true" data-pressed="" class="${TOGGLE_BASE}">Bold</button>`);
  });

  it("announces an explicitly unpressed toggle without the CSS hook", async () => {
    // `aria-pressed="false"` is not the same claim as an absent `aria-pressed`, and `data-pressed`
    // is a presence flag — so the unpressed rendering carries exactly one of the pair, not neither
    // and not both.
    expect(await render(<Toggle pressed={false}>Bold</Toggle>)).toBe(`${HEAD} aria-pressed="false" class="${TOGGLE_BASE}">Bold</button>`);
  });

  it("merges a caller class onto the base", async () => {
    expect(await render(<Toggle class='my-toggle'>Bold</Toggle>)).toBe(
      `${HEAD} aria-pressed="false" class="${TOGGLE_BASE} my-toggle">Bold</button>`,
    );
  });

  it("lets a caller class override a conflicting base utility", async () => {
    expect(await render(<Toggle class='rounded-full'>Bold</Toggle>)).toBe(
      `${HEAD} aria-pressed="false" class="inline-flex items-center justify-center gap-2 px-2.5 py-1.5 text-sm font-medium ` +
        "bg-transparent text-foreground border border-input cursor-pointer outline-none " +
        "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring " +
        "aria-pressed:bg-primary aria-pressed:text-primary-foreground " +
        'disabled:pointer-events-none disabled:opacity-50 rounded-full">Bold</button>',
    );
  });

  it("keeps its own slot token ahead of one handed down through props", async () => {
    expect(await render(<Toggle data-slot='toolbar-action'>Bold</Toggle>)).toBe(
      '<button type="button" data-slot="toggle toolbar-action" data-scope="toggle" data-on-click="toggle" ' +
        `aria-pressed="false" class="${TOGGLE_BASE}">Bold</button>`,
    );
  });

  it("treats an empty inherited token as none rather than emitting a trailing space", async () => {
    expect(await render(<Toggle data-slot=''>Bold</Toggle>)).toBe(`${HEAD} aria-pressed="false" class="${TOGGLE_BASE}">Bold</button>`);
  });

  it("passes the disabled attribute through", async () => {
    expect(await render(<Toggle disabled>Bold</Toggle>)).toBe(`${HEAD} aria-pressed="false" class="${TOGGLE_BASE}" disabled>Bold</button>`);
  });

  it("escapes arbitrary data-* and aria-* values and its children", async () => {
    expect(await render(<Toggle data-note={`R&D's "bold" <b>`} aria-label={`R&D's toggle`}>{`R&D's <b>`}</Toggle>)).toBe(
      `${HEAD} aria-pressed="false" class="${TOGGLE_BASE}" data-note="R&amp;D&#39;s &quot;bold&quot; &lt;b&gt;" ` +
        'aria-label="R&amp;D&#39;s toggle">R&amp;D&#39;s &lt;b&gt;</button>',
    );
  });
});
