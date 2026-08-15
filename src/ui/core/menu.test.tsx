/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { Menu } from "./menu";

const POPUP_CLASS = "z-50 min-w-[10rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none";
const TRIGGER_CLASS = "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 " +
  "cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

describe("Menu.Trigger — data-slot", () => {
  it("emits its own token alone when none was inherited", async () => {
    expect(await render(<Menu.Trigger id='m' />)).toBe(
      `<button type="button" data-slot="menu-trigger" command="toggle-popover" commandfor="m" aria-haspopup="menu" aria-controls="m" aria-expanded="false" class="${TRIGGER_CLASS}"></button>`,
    );
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(await render(<Menu.Trigger id='m' data-slot='rail-tool' />)).toBe(
      '<button type="button" data-slot="menu-trigger rail-tool" command="toggle-popover" commandfor="m" aria-haspopup="menu" aria-controls="m" aria-expanded="false" ' +
        `class="${TRIGGER_CLASS}"></button>`,
    );
  });

  it("treats an empty inherited token as none rather than emitting a trailing space", async () => {
    expect(await render(<Menu.Trigger id='m' data-slot='' />)).toBe(
      `<button type="button" data-slot="menu-trigger" command="toggle-popover" commandfor="m" aria-haspopup="menu" aria-controls="m" aria-expanded="false" class="${TRIGGER_CLASS}"></button>`,
    );
  });
});

describe("Menu.SubmenuTrigger — data-slot", () => {
  it("emits its own token alone when none was inherited", async () => {
    expect(await render(<Menu.SubmenuTrigger id='s' />)).toBe(
      '<button type="button" role="menuitem" data-slot="menu-submenu-trigger" command="toggle-popover" commandfor="s" ' +
        `aria-haspopup="menu" aria-controls="s" aria-expanded="false" class="${ITEM_CLASS}"></button>`,
    );
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(await render(<Menu.SubmenuTrigger id='s' data-slot='rail-tool' />)).toBe(
      '<button type="button" role="menuitem" data-slot="menu-submenu-trigger rail-tool" command="toggle-popover" commandfor="s" ' +
        `aria-haspopup="menu" aria-controls="s" aria-expanded="false" class="${ITEM_CLASS}"></button>`,
    );
  });
});

describe("Menu.Popup — placement attributes", () => {
  it("defaults to the bottom-start placement a top-level menu wants", async () => {
    expect(await render(<Menu.Popup id='m' />)).toBe(
      `<div id="m" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-side="bottom" data-align="start" class="${POPUP_CLASS}"></div>`,
    );
  });

  it("emits side=right, the placement a submenu needs", async () => {
    expect(await render(<Menu.Popup id='m' side='right' />)).toBe(
      `<div id="m" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-side="right" data-align="start" class="${POPUP_CLASS}"></div>`,
    );
  });

  it("emits side=left, for a submenu in a mirrored layout", async () => {
    expect(await render(<Menu.Popup id='m' side='left' />)).toBe(
      `<div id="m" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-side="left" data-align="start" class="${POPUP_CLASS}"></div>`,
    );
  });

  it("still emits side and align alongside data-coords, as a styling hook that no longer places it", async () => {
    expect(await render(<Menu.Popup id='m' coords side='top' align='end' />)).toBe(
      `<div id="m" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-coords="" data-side="top" data-align="end" class="${POPUP_CLASS}"></div>`,
    );
  });
});
