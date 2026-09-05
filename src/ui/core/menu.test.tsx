/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { MENU_SCOPE, menuItemAttrs } from "../contracts/menu-contract";
import { POPOVER_COORDS_ATTR } from "../contracts/overlay-contract";
import { Menu } from "./menu";

const POPUP_CLASS = "z-50 min-w-40 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none";
const TRIGGER_CLASS = "cursor-pointer focus-ring";
const ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 " +
  "cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground " +
  "state-disabled";

describe("Menu.Trigger — data-slot", () => {
  it("emits its own token alone when none was inherited", async () => {
    expect(await render(<Menu.Trigger for='m' />)).toBe(
      `<button type="button" data-slot="menu-trigger" command="toggle-popover" commandfor="m" aria-haspopup="menu" aria-controls="m" aria-expanded="false" class="${TRIGGER_CLASS}"></button>`,
    );
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(await render(<Menu.Trigger for='m' data-slot='rail-tool' />)).toBe(
      '<button type="button" data-slot="menu-trigger rail-tool" command="toggle-popover" commandfor="m" aria-haspopup="menu" aria-controls="m" aria-expanded="false" ' +
        `class="${TRIGGER_CLASS}"></button>`,
    );
  });

  it("treats an empty inherited token as none rather than emitting a trailing space", async () => {
    expect(await render(<Menu.Trigger for='m' data-slot='' />)).toBe(
      `<button type="button" data-slot="menu-trigger" command="toggle-popover" commandfor="m" aria-haspopup="menu" aria-controls="m" aria-expanded="false" class="${TRIGGER_CLASS}"></button>`,
    );
  });
});

describe("Menu.SubmenuTrigger — data-slot", () => {
  it("emits its own token alone when none was inherited", async () => {
    expect(await render(<Menu.SubmenuTrigger for='s' />)).toBe(
      '<button type="button" role="menuitem" data-slot="menu-submenu-trigger" command="toggle-popover" commandfor="s" ' +
        `aria-haspopup="menu" aria-controls="s" aria-expanded="false" class="${ITEM_CLASS}"></button>`,
    );
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(await render(<Menu.SubmenuTrigger for='s' data-slot='rail-tool' />)).toBe(
      '<button type="button" role="menuitem" data-slot="menu-submenu-trigger rail-tool" command="toggle-popover" commandfor="s" ' +
        `aria-haspopup="menu" aria-controls="s" aria-expanded="false" class="${ITEM_CLASS}"></button>`,
    );
  });
});

describe("Menu.Popup — placement attributes", () => {
  it("defaults to the bottom-start placement a top-level menu wants", async () => {
    expect(await render(<Menu.Popup id='m' />)).toBe(
      `<div id="m" role="menu" data-slot="menu-popup" data-scope="${MENU_SCOPE}" popover="auto" data-side="bottom" data-align="start" class="${POPUP_CLASS}"></div>`,
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
      `<div id="m" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" ${POPOVER_COORDS_ATTR}="" data-side="top" data-align="end" class="${POPUP_CLASS}"></div>`,
    );
  });
});

// One emission serves both tiers, so an exact assertion on each is what pins it: `menuItemAttrs`
// once gave `aria-checked` with no `data-checked`, the split `STATE_ATTRIBUTES.md` §1b forbids.
describe("a checkable row carries both halves of its state, in both tiers", () => {
  it("the published client-built attributes name data-checked beside aria-checked", () => {
    expect(menuItemAttrs({ closes: "m", role: "menuitemcheckbox", checked: true })).toEqual({
      role: "menuitemcheckbox",
      "data-slot": "menu-checkbox-item",
      "aria-checked": "true",
      "data-checked": "",
      "data-on-click": "check",
      command: "hide-popover",
      commandfor: "m",
    });
  });

  it("and the SSR row renders exactly those, in that order", async () => {
    expect(
      await render(
        <Menu.CheckboxItem for='m' checked>
          Wrap
        </Menu.CheckboxItem>,
      ),
    ).toBe(
      '<button type="button" role="menuitemcheckbox" data-slot="menu-checkbox-item" aria-checked="true" data-checked="" ' +
        `data-on-click="check" command="hide-popover" commandfor="m" class="${ITEM_CLASS}">Wrap</button>`,
    );
  });

  it("an unchecked row carries neither half's positive value", () => {
    expect(menuItemAttrs({ role: "menuitemradio" })).toEqual({
      role: "menuitemradio",
      "data-slot": "menu-radio-item",
      "aria-checked": "false",
      "data-on-click": "select",
    });
  });
});
