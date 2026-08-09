/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Menu } from "./menu";

const POPUP_CLASS = "z-50 min-w-[10rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none";
const TRIGGER_CLASS = "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-popover-foreground bg-transparent border-0 " +
  "cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

/**
 * `data-slot` is a token list, and both triggers compose an inherited token with their own instead of
 * letting `{...rest}` replace it. The composed-with-a-tooltip cases live beside the rule they belong
 * to, in `utils/as-child.test.tsx`; these pin the single-compound halves — the token an outer compound
 * injects arrives as an ordinary prop, so this *is* the mechanism, reached directly.
 */
describe("Menu.Trigger — data-slot", () => {
  it("emits its own token alone when none was inherited", async () => {
    expect(await render(<Menu.Trigger id='m' />)).toBe(
      `<button type="button" data-slot="menu-trigger" command="toggle-popover" commandfor="m" aria-haspopup="menu" class="${TRIGGER_CLASS}"></button>`,
    );
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(await render(<Menu.Trigger id='m' data-slot='rail-tool' />)).toBe(
      '<button type="button" data-slot="menu-trigger rail-tool" command="toggle-popover" commandfor="m" aria-haspopup="menu" ' +
        `class="${TRIGGER_CLASS}"></button>`,
    );
  });

  it("treats an empty inherited token as none rather than emitting a trailing space", async () => {
    expect(await render(<Menu.Trigger id='m' data-slot='' />)).toBe(
      `<button type="button" data-slot="menu-trigger" command="toggle-popover" commandfor="m" aria-haspopup="menu" class="${TRIGGER_CLASS}"></button>`,
    );
  });
});

describe("Menu.SubmenuTrigger — data-slot", () => {
  it("emits its own token alone when none was inherited", async () => {
    expect(await render(<Menu.SubmenuTrigger id='s' />)).toBe(
      '<button type="button" role="menuitem" data-slot="menu-submenu-trigger" command="toggle-popover" commandfor="s" ' +
        `aria-haspopup="menu" class="${ITEM_CLASS}"></button>`,
    );
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(await render(<Menu.SubmenuTrigger id='s' data-slot='rail-tool' />)).toBe(
      '<button type="button" role="menuitem" data-slot="menu-submenu-trigger rail-tool" command="toggle-popover" commandfor="s" ' +
        `aria-haspopup="menu" class="${ITEM_CLASS}"></button>`,
    );
  });
});

/** The attributes that decide placement, and nothing else — the surrounding markup is pinned by
 * `navbar.test.tsx`'s whole-tree fixtures. */
describe("Menu.Popup — placement attributes", () => {
  it("defaults to the bottom-start placement a top-level menu wants", async () => {
    expect(await render(<Menu.Popup id='m' />)).toBe(
      `<div id="m" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-closed="" data-side="bottom" data-align="start" class="${POPUP_CLASS}"></div>`,
    );
  });

  // `side` used to be `Extract<Side, "top" | "bottom">`, which could not describe a submenu at all:
  // a nested popup opens *beside* the panel containing it, and on the default it opened below the
  // whole parent panel. The CSS matrix keyed on `data-side` has all eight rows — the four physical
  // ones, plus the logical four, whose inline-axis pair resolves through `:dir()`; this is the half
  // that lets a caller reach them.
  it("emits side=right, the placement a submenu needs", async () => {
    expect(await render(<Menu.Popup id='m' side='right' />)).toBe(
      `<div id="m" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-closed="" data-side="right" data-align="start" class="${POPUP_CLASS}"></div>`,
    );
  });

  it("emits side=left, for a submenu in a mirrored layout", async () => {
    expect(await render(<Menu.Popup id='m' side='left' />)).toBe(
      `<div id="m" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-closed="" data-side="left" data-align="start" class="${POPUP_CLASS}"></div>`,
    );
  });

  it("still emits side and align alongside data-coords, as a styling hook that no longer places it", async () => {
    // The anchored rules are guarded by `:not([data-coords])`, so these attributes stop deciding
    // placement here — they remain because a consumer may key its own arrow or shadow on them.
    expect(await render(<Menu.Popup id='m' coords side='top' align='end' />)).toBe(
      `<div id="m" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-coords="" data-closed="" data-side="top" data-align="end" class="${POPUP_CLASS}"></div>`,
    );
  });
});
