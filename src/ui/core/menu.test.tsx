/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { Menu } from "./menu";

const POPUP_CLASS = "z-50 min-w-[10rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none";

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
  // whole parent panel. The CSS matrix keyed on `data-side` has all four rows; this is the half that
  // lets a caller reach them.
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
