/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { menuItemAttrs } from "../contracts/menu-contract";
import { POPOVER_COORDS_ATTR } from "../contracts/overlay-contract";
import { Menu } from "./menu";
import { attrOf, attrsOf, classesOf } from "./test-support";

describe("Menu.Trigger — data-slot", () => {
  it("emits its own token alone when none was inherited", async () => {
    expect(attrsOf(await render(<Menu.Trigger for='m' />))).toEqual({
      type: "button",
      "data-slot": "menu-trigger",
      command: "toggle-popover",
      commandfor: "m",
      "aria-haspopup": "menu",
      "aria-controls": "m",
      "aria-expanded": "false",
    });
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(attrOf(await render(<Menu.Trigger for='m' data-slot='rail-tool' />), "data-slot")).toBe("menu-trigger rail-tool");
  });

  it("treats an empty inherited token as none rather than emitting a trailing space", async () => {
    expect(attrOf(await render(<Menu.Trigger for='m' data-slot='' />), "data-slot")).toBe("menu-trigger");
  });
});

describe("Menu.SubmenuTrigger — data-slot", () => {
  it("emits its own token alone when none was inherited, and calls itself a menu item", async () => {
    expect(attrsOf(await render(<Menu.SubmenuTrigger for='s' />))).toEqual({
      type: "button",
      role: "menuitem",
      "data-slot": "menu-submenu-trigger",
      command: "toggle-popover",
      commandfor: "s",
      "aria-haspopup": "menu",
      "aria-controls": "s",
      "aria-expanded": "false",
    });
  });

  it("keeps its own token ahead of one handed down through props", async () => {
    expect(attrOf(await render(<Menu.SubmenuTrigger for='s' data-slot='rail-tool' />), "data-slot")).toBe("menu-submenu-trigger rail-tool");
  });

  it("wears the row chrome rather than the trigger chrome, so it lines up with its siblings", async () => {
    expect(classesOf(await render(<Menu.SubmenuTrigger for='s' />))).toEqual(classesOf(await render(<Menu.Item for='s' />)));
  });
});

describe("Menu.Popup — placement attributes", () => {
  it("defaults to the bottom-start placement a top-level menu wants", async () => {
    expect(attrsOf(await render(<Menu.Popup id='m' />))).toEqual({
      id: "m",
      role: "menu",
      "data-slot": "menu-popup",
      "data-scope": "menu",
      popover: "auto",
      "data-side": "bottom",
      "data-align": "start",
    });
  });

  it("emits the side it was given, which is what places a submenu and its mirrored twin", async () => {
    const sides = await Promise.all((["right", "left"] as const).map((side) => render(<Menu.Popup id='m' side={side} />)));

    expect(sides.map((html) => attrOf(html, "data-side"))).toEqual(["right", "left"]);
  });

  it("still emits side and align alongside data-coords, as a styling hook that no longer places it", async () => {
    expect(attrsOf(await render(<Menu.Popup id='m' coords side='top' align='end' />))).toEqual({
      id: "m",
      role: "menu",
      "data-slot": "menu-popup",
      "data-scope": "menu",
      popover: "auto",
      [POPOVER_COORDS_ATTR]: "",
      "data-side": "top",
      "data-align": "end",
    });
  });
});

// `STATE_ATTRIBUTES.md` §1b forbids emitting `aria-checked` without `data-checked`, so each tier is
// pinned exactly — the SSR half by a whole-element assertion, because order is part of the claim.
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
        'data-on-click="check" command="hide-popover" commandfor="m" class="flex w-full items-center gap-2 rounded-field px-2 py-1.5' +
        " text-start text-sm text-popover-foreground bg-transparent border-0 cursor-pointer outline-none hover:bg-accent" +
        ' hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground state-disabled">Wrap</button>',
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
