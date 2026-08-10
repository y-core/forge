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

/** The class strings the composed cases assert, spelled out rather than imported, so a change to any
 * of them is a failing test here rather than a silently co-moving expectation. */
const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const TOOLBAR_ITEM_CLASS = `${BUTTON_BASE} text-foreground hover:bg-accent h-8 px-3 text-sm`;

/**
 * The composed cases below assert the class string *after* `cn` has merged the two components'
 * own strings, so each is spelled out whole rather than concatenated from its parts — writing
 * `${A} ${B}` here would assert the inputs, not the merge.
 *
 * Every composed trigger declares `outline-none focus-visible:ring-2 focus-visible:ring-ring`
 * for itself, so composing two of them yields the token twice and the earlier copy is dropped.
 * A repeated identical class name has no cascade effect, so the rendered result is unchanged.
 *
 * The `cursor-*` pair is a real conflict rather than a duplicate: a trigger that declares
 * `cursor-pointer` loses it to the tooltip's later `cursor-default`, which is the resolution the
 * stylesheet would have had to make anyway.
 */
const MENU_WITH_TOOLTIP_CLASS = "cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring";
const POPOVER_WITH_TOOLTIP_CLASS = "list-none cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** `focus-visible:outline-none` survives: a modifier scope is part of the key, so it never met the bare `outline-none`. */
const TOOLBAR_ITEM_WITH_TOOLTIP_CLASS =
  "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none " +
  "disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm " +
  "cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MENU_ITEM_WITH_TOOLTIP_CLASS =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-popover-foreground bg-transparent border-0 " +
  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 " +
  "cursor-default outline-none focus-visible:ring-2 focus-visible:ring-ring";
/**
 * Coincides with `TOOLBAR_ITEM_WITH_TOOLTIP_CLASS` — the menu trigger's only surviving contribution
 * was `cursor-pointer`, which the tooltip's `cursor-default` now takes. Kept as its own constant so
 * a change to either assertion fails on its own rather than silently co-moving with the other.
 */
const MENU_WITH_TOOLBAR_WITH_TOOLTIP_CLASS =
  "inline-flex items-center justify-center rounded-lg font-medium transition-colors " +
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
    // Composing two compounds produces one element that genuinely is both. Overwriting used to
    // destroy the inner compound silently: every `[data-slot~="menu-trigger"]` rule stopped matching,
    // and with them the `anchor-name` that positions the menu's popup.
    const child = (
      <button type='button' data-slot='menu-trigger'>
        File
      </button>
    );

    expect(await render(cloneAsChild(child, base))).toBe('<button type="button" data-slot="menu-trigger probe" class="probe-class">File</button>');
  });

  it("stamps its own slot alone when the child declares none", async () => {
    // The single-token path, pinned so the append never leaks a leading space or an empty token into
    // markup that has only one compound in it.
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
    // `Toolbar.Link` passes no `type` and no `disabled`; spreading those as undefined used to erase
    // the child's own `type`, leaving a button that submits the surrounding form on click.
    expect(
      await render(
        <Toolbar.Link asChild>
          <button type='button'>Docs</button>
        </Toolbar.Link>,
      ),
    ).toBe(
      '<button type="button" data-toolbar-item="" class="inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 text-foreground hover:bg-accent h-8 px-3 text-sm underline-offset-4 hover:underline" data-slot="toolbar-link">Docs</button>',
    );
  });
});

describe("slotToken", () => {
  it("concatenates own first, matching cloneAsChild's order", () => {
    // The order is the contract, not an accident: `cloneAsChild` writes the *child's* token first and
    // appends the outer compound's, so a compound composing an inherited token has to do the same or
    // the two halves of the same rule would disagree about which end a token joins at.
    expect(slotToken("menu-trigger", "tooltip-trigger")).toBe("menu-trigger tooltip-trigger");
  });

  it("appends a whole inherited token list, not just its first token", () => {
    // The three-deep case arrives here as a two-token `inherited`.
    expect(slotToken("menu-trigger", "toolbar-button tooltip-trigger")).toBe("menu-trigger toolbar-button tooltip-trigger");
  });

  it("contributes no token, and no trailing space, for anything that is not a non-empty string", () => {
    // `inherited` comes from a caller-supplied prop bag, so every one of these is reachable. A
    // trailing space would be harmless in HTML token-splitting but would break the exact-match
    // goldens that pin every non-composed element in this library, so it is asserted rather than
    // assumed.
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

    // Asserted as `{ label, token }` pairs rather than one `toBe` per row, so a failure reports which
    // input produced the wrong token instead of only that some row did.
    expect(cases.map(({ inherited, label }) => ({ label, token: slotToken("menu-trigger", inherited) }))).toEqual(
      cases.map(({ label }) => ({ label, token: "menu-trigger" })),
    );
  });
});

/**
 * The composed-trigger cases, and the reason they are written as **JSX** rather than as a direct call
 * to the compound.
 *
 * `Menu.Trigger({ id, children })` returns already-rendered intrinsic markup whose `data-slot` is a
 * plain string prop — the one child shape `cloneAsChild` could always merge, and therefore the one
 * shape that cannot detect this bug. JSX (and `createElement`) hand `cloneAsChild` an *unrendered*
 * component element instead, so the token has to survive being injected into the inner compound's
 * props and re-emitted by it. Every assertion below must go through that path or it pins nothing.
 *
 * These are the compositions `theme-base.css` writes `[data-slot~="tooltip-trigger"][data-slot~="…"]`
 * rules for; a dropped token makes all three rules unmatchable and the popup falls back to the UA's
 * `[popover]` centring.
 */
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
        `aria-haspopup="menu" class="${MENU_WITH_TOOLTIP_CLASS}" aria-describedby="tip">File</button>`,
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
        `class="${POPOVER_WITH_TOOLTIP_CLASS}" aria-describedby="tip">Panel</button>`,
    );
  });

  it("keeps both toolbar tokens when a tooltip is composed onto a chrome rail trigger", async () => {
    // `chrome/Toolbar` passes `data-slot='toolbar-trigger'` *through* `core/Toolbar.Button`, so this
    // element carries three tokens at once and each has a rule keyed on it: `toolbar-button` for the
    // item styling, `toolbar-trigger` for the flyout's `anchor-name` and the open-flyout highlight,
    // and `tooltip-trigger` for the tooltip's own anchor.
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
        `commandfor="more" aria-haspopup="menu" class="${MENU_ITEM_WITH_TOOLTIP_CLASS}" aria-describedby="tip">More</button>`,
    );
  });

  it("accumulates all three tokens through two nested asChild compounds", async () => {
    // Two clones deep: the outer token is injected into `Toolbar.Button`'s props, merged there, then
    // handed on as `cloneAsChild`'s slot for the innermost compound. Nothing may be lost at either hop.
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
        `commandfor="file-menu" aria-haspopup="menu" class="${MENU_WITH_TOOLBAR_WITH_TOOLTIP_CLASS}" ` +
        'data-toolbar-item="" aria-describedby="tip">File</button>',
    );
  });

  it("merges the same way for a child built with createElement rather than JSX syntax", async () => {
    // JSX desugars to this, so the two are the same path — pinned because the *third* spelling,
    // `Menu.Trigger({ … })`, is not: it renders the child eagerly and reaches `cloneAsChild` as an
    // intrinsic `<button>`, which merged correctly even before this fix.
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild>
          {createElement(Menu.Trigger, { id: "file-menu", children: "File" })}
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="menu-trigger tooltip-trigger" command="toggle-popover" commandfor="file-menu" ' +
        `aria-haspopup="menu" class="${MENU_WITH_TOOLTIP_CLASS}" aria-describedby="tip">File</button>`,
    );
  });
});

/**
 * The other half of the same bug: `cloneAsChild` writes `"data-slot"` as the **last** key of its
 * literal, so a token the caller handed the compound through its own props used to be spread in and
 * then overwritten. The six merging compounds now lift it out of the prop bag and fold it into the
 * slot they pass down, so it survives.
 */
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
    ).toBe(`<a href="/x" class="${BUTTON_BASE} text-foreground hover:bg-accent size-[34px] p-0" data-slot="button toolbar-title-action">Go</a>`);
  });

  it("stacks behind the child's own token when the child declares one too", async () => {
    // Three sources for one attribute: the child element's literal, the compound's literal, and the
    // caller's prop. All three are kept, child-first, because the element is genuinely all three.
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
