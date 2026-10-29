/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import { escapeHtml } from "../../../html/escape";
import { createElement } from "../../../render/jsx/element";
import type { FC, JSX } from "../../../render/jsx/types";
import { attrOf, attrsOf } from "../../../testing/markup";
import { render } from "../../../testing/render";
import { MENU_ITEM_CLASS } from "../../contracts/menu-contract";
import { Button, buttonBox, buttonVariants } from "../button";
import { Input } from "../input";
import { Link } from "../link";
import { Menu } from "../menu";
import { Popover } from "../popover";
import { Slider } from "../slider";
import { Switch } from "../switch";
import { Toggle } from "../toggle";
import { Toolbar } from "../toolbar";
import { Tooltip } from "../tooltip";
import { cloneAsChild, slotToken } from "./as-child";
import { cn } from "./cn";

const MESSAGE = "test compound with asChild requires exactly one JSX element child";

const base = { slot: "probe", class: "probe-class", props: {}, message: MESSAGE };

const ghostItem = (overrides: Parameters<typeof buttonVariants>[0] = {}): string =>
  buttonVariants({ tone: "neutral", appearance: "ghost", size: "sm", ...overrides });

const TOOLBAR_ITEM_CLASS = ghostItem();
const BUTTON_ICON_CLASS = ghostItem({ shape: "icon" });
const BUTTON_DEFAULT_CLASS = buttonVariants();

const TOOLTIP_TRIGGER_CLASS = "cursor-default focus-ring";
const TRIGGER_BOX_CLASS = cn(buttonBox({ size: "sm" }), "border-transparent");
const MENU_WITH_TOOLTIP_CLASS = cn(TRIGGER_BOX_CLASS, "cursor-pointer", TOOLTIP_TRIGGER_CLASS);
const POPOVER_WITH_TOOLTIP_CLASS = cn(TRIGGER_BOX_CLASS, "cursor-pointer list-none", TOOLTIP_TRIGGER_CLASS);
const TOOLBAR_ITEM_WITH_TOOLTIP_CLASS = cn(TOOLBAR_ITEM_CLASS, TOOLTIP_TRIGGER_CLASS);
const MENU_ITEM_WITH_TOOLTIP_CLASS = cn(MENU_ITEM_CLASS, TOOLTIP_TRIGGER_CLASS);
const MENU_WITH_TOOLBAR_WITH_TOOLTIP_CLASS = TOOLBAR_ITEM_WITH_TOOLTIP_CLASS;

describe("cloneAsChild — button options the compound never set", () => {
  it("leaves a child button's own type alone when no type option is given", async () => {
    expect(await render(cloneAsChild(<button type='button'>Go</button>, base))).toBe(
      '<button type="button" class="probe-class" data-slot="probe">Go</button>',
    );
  });

  it("leaves a child button's own disabled alone when no disabled option is given", async () => {
    const child = <button disabled>Go</button>;

    expect(await render(cloneAsChild(child, base))).toBe('<button disabled type="button" class="probe-class" data-slot="probe">Go</button>');
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
    const child = <button>Go</button>;

    expect(await render(cloneAsChild(child, { ...base, disabled: true }))).toBe(
      '<button disabled type="button" class="probe-class" data-slot="probe">Go</button>',
    );
  });

  it("disabled=false is a decision, not an omission, and clears the child's own", async () => {
    const child = <button disabled>Go</button>;

    expect(await render(cloneAsChild(child, { ...base, disabled: false }))).toBe(
      '<button type="button" class="probe-class" data-slot="probe">Go</button>',
    );
  });
});

describe("cloneAsChild — non-button children", () => {
  it("a disabled anchor loses the href it would otherwise navigate on Enter, and stays a focus stop", async () => {
    expect(await render(cloneAsChild(<a href='/docs'>Docs</a>, { ...base, disabled: true }))).toBe(
      '<a aria-disabled="true" data-disabled="" role="link" tabindex="0" class="probe-class" data-slot="probe">Docs</a>',
    );
  });

  it("reads disabled from an aria-disabled the compound resolved, not only from the option", async () => {
    const options = { ...base, props: { "aria-disabled": "true" } };

    expect(await render(cloneAsChild(<a href='/docs'>Docs</a>, options))).toBe(
      '<a aria-disabled="true" role="link" tabindex="0" class="probe-class" data-slot="probe">Docs</a>',
    );
  });

  it("an anchor is never given a native type, even when the compound sets one", async () => {
    expect(await render(cloneAsChild(<a href='/docs'>Docs</a>, { ...base, type: "button" }))).toBe(
      '<a href="/docs" class="probe-class" data-slot="probe">Docs</a>',
    );
  });
});

const Probe: FC<JSX.IntrinsicElements["button"]> = (props) => <button {...props} />;
const ProbeLink: FC<JSX.IntrinsicElements["a"]> = ({ children, ...props }) => <a {...props}>{children}</a>;

describe("cloneAsChild — a component child renders its own disabled and type", () => {
  const cases = [
    {
      label: "keeps its own disabled when no disabled option is given",
      child: <Probe disabled>Go</Probe>,
      options: base,
      expected: '<button disabled class="probe-class" data-slot="probe">Go</button>',
    },
    {
      label: "keeps its own type when no type option is given",
      child: <Probe type='submit'>Go</Probe>,
      options: base,
      expected: '<button type="submit" class="probe-class" data-slot="probe">Go</button>',
    },
    {
      label: "receives a disabled option as the prop itself, not translated to aria-disabled",
      child: <Probe>Go</Probe>,
      options: { ...base, disabled: true },
      expected: '<button disabled class="probe-class" data-slot="probe">Go</button>',
    },
    {
      label: "receives disabled=false as a decision that clears its own",
      child: <Probe disabled>Go</Probe>,
      options: { ...base, disabled: false },
      expected: '<button class="probe-class" data-slot="probe">Go</button>',
    },
    {
      label: "a type option overrides the child's own",
      child: <Probe type='submit'>Go</Probe>,
      options: { ...base, type: "button" },
      expected: '<button type="button" class="probe-class" data-slot="probe">Go</button>',
    },
    {
      label: "gets no type at all when the compound declares no default, so a link component stays a plain link",
      child: <ProbeLink href='/docs'>Docs</ProbeLink>,
      options: base,
      expected: '<a href="/docs" class="probe-class" data-slot="probe">Docs</a>',
    },
    {
      label: "keeps its own type when it carries an href",
      child: (
        <ProbeLink href='/docs' type='text/html'>
          Docs
        </ProbeLink>
      ),
      options: base,
      expected: '<a href="/docs" type="text/html" class="probe-class" data-slot="probe">Docs</a>',
    },
    {
      label: "is never given the compound's type option when it carries an href, like an `<a>`",
      child: <ProbeLink href='/docs'>Docs</ProbeLink>,
      options: { ...base, type: "button" },
      expected: '<a href="/docs" class="probe-class" data-slot="probe">Docs</a>',
    },
  ];

  for (const { label, child, options, expected } of cases) {
    it(label, async () => {
      expect(await render(cloneAsChild(child, options))).toBe(expected);
    });
  }
});

describe("cloneAsChild — a component that renders a form control keeps its own type under Tooltip.Trigger asChild", () => {
  it("leaves Switch, Toggle and Slider their input type, and Input none", async () => {
    const triggers = [
      <Tooltip.Trigger for='t' asChild>
        <Switch name='s' />
      </Tooltip.Trigger>,
      <Tooltip.Trigger for='t' asChild>
        <Toggle name='s'>B</Toggle>
      </Tooltip.Trigger>,
      <Tooltip.Trigger for='t' asChild>
        <Slider name='s' />
      </Tooltip.Trigger>,
      <Tooltip.Trigger for='t' asChild>
        <Input name='s' />
      </Tooltip.Trigger>,
    ];

    expect(await Promise.all(triggers.map(async (el) => attrOf(await render(el), "type", 'aria-describedby="t"')))).toEqual([
      "checkbox",
      "checkbox",
      "range",
      "",
    ]);
  });
});

describe("cloneAsChild — a component child carrying an href is a link", () => {
  it("is withdrawn from navigation and marked aria-disabled when the compound is disabled", async () => {
    expect(
      attrsOf(
        await render(
          <Button asChild disabled>
            <Link href='/next'>Next</Link>
          </Button>,
        ),
      ),
    ).toEqual({
      "data-slot": "link button",
      "data-tone": "primary",
      "data-decoration": "underline",
      "aria-disabled": "true",
      "data-disabled": "",
      role: "link",
      tabindex: "0",
    });
  });

  it("is withdrawn from navigation and marked aria-disabled when the compound is loading", async () => {
    expect(
      attrsOf(
        await render(
          <Button asChild loading>
            <Link href='/next'>Next</Link>
          </Button>,
        ),
      ),
    ).toEqual({
      "data-slot": "link button",
      "data-tone": "primary",
      "data-decoration": "underline",
      "aria-busy": "true",
      "aria-disabled": "true",
      "data-busy": "",
      role: "link",
      tabindex: "0",
    });
  });

  it("is withdrawn from navigation by an aria-disabled the compound resolved, not only by the option", async () => {
    const options = { ...base, props: { "aria-disabled": "true" } };

    expect(attrsOf(await render(cloneAsChild(<ProbeLink href='/docs'>Docs</ProbeLink>, options)))).toEqual({
      "aria-disabled": "true",
      role: "link",
      tabindex: "0",
      "data-slot": "probe",
    });
  });

  it("keeps its href and gains no disabled state when the compound is enabled", async () => {
    expect(
      attrsOf(
        await render(
          <Button asChild>
            <Link href='/next'>Next</Link>
          </Button>,
        ),
      ),
    ).toEqual({ "data-slot": "link button", "data-tone": "primary", "data-decoration": "underline", href: "/next" });
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
      '<button type="button" data-toolbar-item="" class="state-busy state-disabled inline-flex items-center justify-center gap-2 rounded-field border-field font-medium whitespace-nowrap focus-ring motion-safe:transition-colors h-control-sm px-3 text-sm [--tone:var(--color-foreground)] [--tone-fg:var(--color-background)] [--tone-text:var(--color-foreground)] [--tone-soft:var(--color-muted)] [--tone-soft-fg:var(--color-foreground)] [--tone-soft-border:var(--color-border)] border-transparent bg-transparent [--focus-ring:var(--color-ring)] text-foreground hover:bg-accent hover:text-accent-foreground underline-offset-4 hover:underline" data-slot="toolbar-link">Docs</button>',
    );
  });
});

describe("slotToken", () => {
  it("concatenates own first, matching cloneAsChild's order", () => {
    expect(slotToken("menu-trigger", "tooltip-trigger")).toBe("menu-trigger tooltip-trigger");
  });

  it("returns the own token alone when called with no inherited argument", () => {
    expect(slotToken("menu-trigger")).toBe("menu-trigger");
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
          <Menu.Trigger for='file-menu'>File</Menu.Trigger>
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="menu-trigger tooltip-trigger" command="toggle-popover" commandfor="file-menu" ' +
        `aria-controls="file-menu" aria-expanded="false" aria-haspopup="menu" class="${MENU_WITH_TOOLTIP_CLASS}" aria-describedby="tip" id="file-menu-trigger">File</button>`,
    );
  });

  it("keeps popover-trigger when a tooltip is composed onto it", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild>
          <Popover.Trigger for='panel'>Panel</Popover.Trigger>
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="popover-trigger tooltip-trigger" command="toggle-popover" commandfor="panel" ' +
        'aria-controls="panel" aria-expanded="false" aria-haspopup="dialog" ' +
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
          <Menu.SubmenuTrigger for='more'>More</Menu.SubmenuTrigger>
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" role="menuitem" data-slot="menu-submenu-trigger tooltip-trigger" command="toggle-popover" ' +
        `commandfor="more" aria-controls="more" aria-expanded="false" aria-haspopup="menu" class="${escapeHtml(MENU_ITEM_WITH_TOOLTIP_CLASS)}" aria-describedby="tip" id="more-trigger">More</button>`,
    );
  });

  it("accumulates all three tokens through two nested asChild compounds", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild>
          <Toolbar.Button asChild>
            <Menu.Trigger for='file-menu'>File</Menu.Trigger>
          </Toolbar.Button>
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="menu-trigger toolbar-button tooltip-trigger" command="toggle-popover" ' +
        `commandfor="file-menu" aria-controls="file-menu" aria-expanded="false" aria-haspopup="menu" class="${MENU_WITH_TOOLBAR_WITH_TOOLTIP_CLASS}" ` +
        'data-toolbar-item="" aria-describedby="tip" id="file-menu-trigger">File</button>',
    );
  });

  it("merges the same way for a child built with createElement rather than JSX syntax", async () => {
    expect(
      await render(
        <Tooltip.Trigger for='tip' asChild>
          {createElement(Menu.Trigger, { for: "file-menu", children: "File" })}
        </Tooltip.Trigger>,
      ),
    ).toBe(
      '<button type="button" data-slot="menu-trigger tooltip-trigger" command="toggle-popover" commandfor="file-menu" ' +
        `aria-controls="file-menu" aria-expanded="false" aria-haspopup="menu" class="${MENU_WITH_TOOLTIP_CLASS}" aria-describedby="tip" id="file-menu-trigger">File</button>`,
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
        <Button asChild data-slot='toolbar-title-action' tone='neutral' appearance='ghost' shape='icon' size='sm'>
          <a href='/x'>Go</a>
        </Button>,
      ),
    ).toBe(`<a href="/x" class="${BUTTON_ICON_CLASS}" data-slot="button toolbar-title-action">Go</a>`);
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
    ).toBe('<button type="button" data-slot="inner button caller" ' + `class="${BUTTON_DEFAULT_CLASS}">Go</button>`);
  });
});

describe("cloneAsChild — a compound's IDREF list joins the child's", () => {
  it("keeps the child's aria-describedby and appends the compound's after it", async () => {
    const html = await render(
      <Button asChild aria-describedby='compound'>
        <a href='/x' aria-describedby='own'>
          x
        </a>
      </Button>,
    );

    expect(attrOf(html, "aria-describedby")).toBe("own compound");
  });

  it("keeps the child's aria-labelledby and appends the compound's after it", async () => {
    const html = await render(
      <Button asChild aria-labelledby='compound'>
        <a href='/x' aria-labelledby='own'>
          x
        </a>
      </Button>,
    );

    expect(attrOf(html, "aria-labelledby")).toBe("own compound");
  });

  it("names an id the child and the compound share once", async () => {
    const html = await render(
      <Button asChild aria-describedby='shared'>
        <a href='/x' aria-describedby='own shared'>
          x
        </a>
      </Button>,
    );

    expect(attrOf(html, "aria-describedby")).toBe("own shared");
  });

  it("emits neither attribute when neither side sets one", async () => {
    const html = await render(
      <Button asChild>
        <a href='/x'>x</a>
      </Button>,
    );

    expect(attrsOf(html)).toEqual({ href: "/x", "data-slot": "button" });
  });

  it("merges through Link asChild as well as Button", async () => {
    const html = await render(
      <Link asChild aria-labelledby='compound'>
        <a href='/x' aria-labelledby='own'>
          x
        </a>
      </Link>,
    );

    expect(attrOf(html, "aria-labelledby")).toBe("own compound");
  });
});
