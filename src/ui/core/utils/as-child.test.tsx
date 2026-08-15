/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { createElement } from "../../../jsx/element";
import { render } from "../../../testing/render";
import { Button } from "../button";
import { Menu } from "../menu";
import { Popover } from "../popover";
import { Toolbar } from "../toolbar";
import { Tooltip } from "../tooltip";
import { cloneAsChild, slotToken } from "./as-child";

const MESSAGE = "test compound with asChild requires exactly one JSX element child";

const base = { slot: "probe", class: "probe-class", props: {}, message: MESSAGE };

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-lg font-medium motion-safe:transition-colors focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const TOOLBAR_ITEM_CLASS = `${BUTTON_BASE} text-foreground hover:bg-accent h-8 px-3 text-sm`;

const MENU_WITH_TOOLTIP_CLASS = "cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring";
const POPOVER_WITH_TOOLTIP_CLASS = "list-none cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring";
const TOOLBAR_ITEM_WITH_TOOLTIP_CLASS =
  "inline-flex items-center justify-center rounded-lg font-medium motion-safe:transition-colors focus-visible:outline-none " +
  "disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm " +
  "cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MENU_ITEM_WITH_TOOLTIP_CLASS =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 " +
  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 " +
  "cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MENU_WITH_TOOLBAR_WITH_TOOLTIP_CLASS =
  "inline-flex items-center justify-center rounded-lg font-medium motion-safe:transition-colors " +
  "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent " +
  "h-8 px-3 text-sm cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring";

describe("cloneAsChild — button options the compound never set", () => {
  it("leaves a child button's own type alone when no type option is given", async () => {
    expect(await render(cloneAsChild(<button type='button'>Go</button>, base))).toBe(
      '<button type="button" class="probe-class" data-slot="probe">Go</button>',
    );
  });

  it("leaves a child button's own disabled alone when no disabled option is given", async () => {
    // biome-ignore lint/a11y/useButtonType: a child that declares no type is the case under test
    const child = <button disabled>Go</button>;

    expect(await render(cloneAsChild(child, base))).toBe('<button disabled class="probe-class" data-slot="probe">Go</button>');
  });

  it("keeps type and disabled together on a child that declares both", async () => {
    expect(
      await render(
        cloneAsChild(
          <button type='reset' disabled>
            Go
          </button>,
          base,
        ),
      ),
    ).toBe('<button type="reset" disabled class="probe-class" data-slot="probe">Go</button>');
  });
});

describe("cloneAsChild — button options the compound did set", () => {
  it("an explicit type option overrides the child's own", async () => {
    expect(await render(cloneAsChild(<button type='button'>Go</button>, { ...base, type: "submit" }))).toBe(
      '<button type="submit" class="probe-class" data-slot="probe">Go</button>',
    );
  });

  it("an explicit disabled option overrides the child's own", async () => {
    // biome-ignore lint/a11y/useButtonType: a child that declares no type is the case under test
    const child = <button>Go</button>;

    expect(await render(cloneAsChild(child, { ...base, disabled: true }))).toBe(
      '<button disabled class="probe-class" data-slot="probe">Go</button>',
    );
  });

  it("disabled=false is a decision, not an omission, and clears the child's own", async () => {
    // biome-ignore lint/a11y/useButtonType: a child that declares no type is the case under test
    const child = <button disabled>Go</button>;

    expect(await render(cloneAsChild(child, { ...base, disabled: false }))).toBe('<button class="probe-class" data-slot="probe">Go</button>');
  });
});

describe("cloneAsChild — non-button children", () => {
  it("an anchor gets the ARIA form of disabled and keeps its href", async () => {
    expect(await render(cloneAsChild(<a href='/docs'>Docs</a>, { ...base, disabled: true }))).toBe(
      '<a href="/docs" aria-disabled="true" data-disabled="" class="probe-class" data-slot="probe">Docs</a>',
    );
  });

  it("an anchor is never given a native type, even when the compound sets one", async () => {
    expect(await render(cloneAsChild(<a href='/docs'>Docs</a>, { ...base, type: "button" }))).toBe(
      '<a href="/docs" class="probe-class" data-slot="probe">Docs</a>',
    );
  });
});

describe("cloneAsChild — data-slot is a token list", () => {
  it("appends to a child that already declares a slot, rather than unmaking it", async () => {
    const child = (
      <button type='button' data-slot='menu-trigger'>
        File
      </button>
    );

    expect(await render(cloneAsChild(child, base))).toBe('<button type="button" data-slot="menu-trigger probe" class="probe-class">File</button>');
  });

  it("stamps its own slot alone when the child declares none", async () => {
    expect(await render(cloneAsChild(<button type='button'>Go</button>, base))).toBe(
      '<button type="button" class="probe-class" data-slot="probe">Go</button>',
    );
  });

  it("treats an empty child slot as none rather than appending to nothing", async () => {
    expect(await render(cloneAsChild(<button type='button' data-slot='' />, base))).toBe(
      '<button type="button" data-slot="probe" class="probe-class"></button>',
    );
  });
});

describe("Toolbar.Link asChild — the compound that sets neither option", () => {
  it("does not turn a child button into a submit button", async () => {
    expect(
      await render(
        <Toolbar.Link asChild>
          <button type='button'>Docs</button>
        </Toolbar.Link>,
      ),
    ).toBe(
      '<button type="button" data-toolbar-item="" class="inline-flex items-center justify-center rounded-lg font-medium motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm underline-offset-4 hover:underline" data-slot="toolbar-link">Docs</button>',
    );
  });
});

describe("slotToken", () => {
  it("concatenates own first, matching cloneAsChild's order", () => {
    expect(slotToken("menu-trigger", "tooltip-trigger")).toBe("menu-trigger tooltip-trigger");
  });

  it("appends a whole inherited token list, not just its first token", () => {
    expect(slotToken("menu-trigger", "toolbar-button tooltip-trigger")).toBe("menu-trigger toolbar-button tooltip-trigger");
  });

  it("contributes no token, and no trailing space, for anything that is not a non-empty string", () => {
    const cases: Array<{ inherited: unknown; label: string }> = [
      { inherited: "", label: "empty string" },
      { inherited: undefined, label: "undefined" },
      { inherited: null, label: "null" },
      { inherited: 0, label: "the number zero" },
      { inherited: 42, label: "a non-zero number" },
      { inherited: false, label: "false" },
      { inherited: true, label: "true" },
      { inherited: {}, label: "an object" },
      { inherited: ["a"], label: "an array" },
    ];

    expect(cases.map(({ inherited, label }) => ({ label, token: slotToken("menu-trigger", inherited) }))).toEqual(
      cases.map(({ label }) => ({ label, token: "menu-trigger" })),
    );
  });
});

describe("data-slot composition through an unrendered component child", () => {
  it("keeps menu-trigger when a tooltip is composed onto it", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild>
          <Menu.Trigger id='file-menu'>File</Menu.Trigger>
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="menu-trigger tooltip-trigger" command="toggle-popover" commandfor="file-menu" ' +
        `aria-haspopup="menu" aria-controls="file-menu" aria-expanded="false" class="${MENU_WITH_TOOLTIP_CLASS}" aria-describedby="tip">File</button>`,
    );
  });

  it("keeps popover-trigger when a tooltip is composed onto it", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild>
          <Popover.Trigger id='panel'>Panel</Popover.Trigger>
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="popover-trigger tooltip-trigger" command="toggle-popover" commandfor="panel" ' +
        'aria-controls="panel" aria-expanded="false" ' +
        `class="${POPOVER_WITH_TOOLTIP_CLASS}" aria-describedby="tip">Panel</button>`,
    );
  });

  it("keeps both toolbar tokens when a tooltip is composed onto a chrome rail trigger", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild>
          <Toolbar.Button data-slot='toolbar-trigger' command='toggle-popover' commandfor='flyout'>
            B
          </Toolbar.Button>
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="toolbar-button toolbar-trigger tooltip-trigger" ' +
        `class="${TOOLBAR_ITEM_WITH_TOOLTIP_CLASS}" data-toolbar-item="" command="toggle-popover" ` +
        'commandfor="flyout" aria-describedby="tip">B</button>',
    );
  });

  it("keeps toolbar-button alone when the rail trigger declares no token of its own", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild>
          <Toolbar.Button>B</Toolbar.Button>
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="toolbar-button tooltip-trigger" ' +
        `class="${TOOLBAR_ITEM_WITH_TOOLTIP_CLASS}" data-toolbar-item="" aria-describedby="tip">B</button>`,
    );
  });

  it("keeps menu-submenu-trigger when a tooltip is composed onto it", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild>
          <Menu.SubmenuTrigger id='more'>More</Menu.SubmenuTrigger>
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" role="menuitem" data-slot="menu-submenu-trigger tooltip-trigger" command="toggle-popover" ' +
        `commandfor="more" aria-haspopup="menu" aria-controls="more" aria-expanded="false" class="${MENU_ITEM_WITH_TOOLTIP_CLASS}" aria-describedby="tip">More</button>`,
    );
  });

  it("accumulates all three tokens through two nested asChild compounds", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild>
          <Toolbar.Button asChild>
            <Menu.Trigger id='file-menu'>File</Menu.Trigger>
          </Toolbar.Button>
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="menu-trigger toolbar-button tooltip-trigger" command="toggle-popover" ' +
        `commandfor="file-menu" aria-haspopup="menu" aria-controls="file-menu" aria-expanded="false" class="${MENU_WITH_TOOLBAR_WITH_TOOLTIP_CLASS}" ` +
        'data-toolbar-item="" aria-describedby="tip">File</button>',
    );
  });

  it("merges the same way for a child built with createElement rather than JSX syntax", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild>
          {createElement(Menu.Trigger, { id: "file-menu", children: "File" })}
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="menu-trigger tooltip-trigger" command="toggle-popover" commandfor="file-menu" ' +
        `aria-haspopup="menu" aria-controls="file-menu" aria-expanded="false" class="${MENU_WITH_TOOLTIP_CLASS}" aria-describedby="tip">File</button>`,
    );
  });
});

describe("a caller's own data-slot on an asChild compound", () => {
  it("survives on Toolbar.Button", async () => {
    expect(
      await render(
        <Toolbar.Button asChild data-slot='rail-tool'>
          <a href='/x'>Go</a>
        </Toolbar.Button>,
      ),
    ).toBe(`<a href="/x" data-toolbar-item="" class="${TOOLBAR_ITEM_CLASS}" data-slot="toolbar-button rail-tool">Go</a>`);
  });

  it("survives on Button — the shape chrome/Toolbar's flyout title action renders", async () => {
    expect(
      await render(
        <Button asChild data-slot='toolbar-title-action' variant='ghost' size='icon-sm'>
          <a href='/x'>Go</a>
        </Button>,
      ),
    ).toBe(`<a href="/x" class="${BUTTON_BASE} text-foreground hover:bg-accent size-8 p-0" data-slot="button toolbar-title-action">Go</a>`);
  });

  it("stacks behind the child's own token when the child declares one too", async () => {
    expect(
      await render(
        <Button asChild data-slot='caller'>
          <button type='button' data-slot='inner'>
            Go
          </button>
        </Button>,
      ),
    ).toBe(
      '<button type="button" data-slot="inner button caller" ' +
        `class="${BUTTON_BASE} bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 text-sm">Go</button>`,
    );
  });
});
