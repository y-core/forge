/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";

import { render } from "../../testing/render";
import { createIcon } from "../core/icon";
import { Navbar } from "./navbar";
import type { NavDefinition } from "./types";

const id = (key: string) => `/route/${key}`;

const BAR_LINK =
  "inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground";

const icon = createIcon("/sprite.svg", {
  "icon-chevron-down": "0 0 16 16",
  "icon-hamburger": "0 0 22 22",
  "icon-close": "0 0 22 22",
  "icon-panel-open": "0 0 24 24",
  "icon-panel-close": "0 0 24 24",
});

const MENU_FILE_NEW =
  '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><div data-slot="menu" class="relative inline-block"><button type="button" data-slot="menu-trigger" command="toggle-popover" commandfor="navbar-menu-top-0" aria-haspopup="menu" aria-controls="navbar-menu-top-0" aria-expanded="false" class="cursor-pointer focus-ring inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"><span>File</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-top-0" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-40 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"><a role="menuitem" data-slot="menu-link-item" class="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground state-disabled" href="/route/new">New</a></div></div></div></div></details></nav></div>';

const MENU_NESTED =
  '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><div data-slot="menu" class="relative inline-block"><button type="button" data-slot="menu-trigger" command="toggle-popover" commandfor="navbar-menu-top-0" aria-haspopup="menu" aria-controls="navbar-menu-top-0" aria-expanded="false" class="cursor-pointer focus-ring inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"><span>Edit</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-top-0" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-40 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"><button type="button" role="menuitem" data-slot="menu-submenu-trigger" command="toggle-popover" commandfor="navbar-menu-top-1" aria-haspopup="menu" aria-controls="navbar-menu-top-1" aria-expanded="false" class="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground state-disabled"><span>More</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-top-1" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-side="inline-end" data-align="start" class="z-50 min-w-40 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"><a role="menuitem" data-slot="menu-link-item" class="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground state-disabled" href="/route/deep">Deep</a></div></div></div></div></div></details></nav></div>';

const GROUP_DOCS =
  '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><div data-slot="navbar-group" role="group" aria-labelledby="navbar-group-top-0" class="flex flex-col gap-1"><p id="navbar-group-top-0" data-slot="navbar-group-heading" class="px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Docs</p><a href="/route/intro" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">Intro</a></div></div></div></details></nav></div>';

const GROUP_FILTERED =
  '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[&quot;root&quot;]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><div data-slot="navbar-group" role="group" aria-labelledby="navbar-group-top-0" class="flex flex-col gap-1" data-filter="admin" hidden><p id="navbar-group-top-0" data-slot="navbar-group-heading" class="px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Admin</p><a href="/route/users" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground" data-filter="root">Users</a></div></div></div></details></nav></div>';

describe("Navbar — links", () => {
  it("resolves href through resolveHref and never emits the raw key", async () => {
    const calls: string[] = [];
    const resolve = (k: string) => {
      calls.push(k);
      return "/secret-path";
    };
    const config: NavDefinition = { sections: [{ items: [{ label: "Dash", href: "dashboard" }] }] };
    const out = await render(<Navbar config={config} resolveHref={resolve} icon={icon} />);
    expect(calls).toEqual(["dashboard"]);
    expect(out).toBe(
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/secret-path" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">Dash</a></div></div></details></nav></div>',
    );
  });

  // `BAR_LINK` carried `aria-[current]:*` utilities for a state no renderer emitted, so the
  // highlight could never appear. `Dock` already wires `current` this way.
  it("marks the current page in ARIA and in the styling hook, and neither otherwise", async () => {
    const config: NavDefinition = {
      sections: [
        {
          items: [
            { label: "Here", href: "here", current: true },
            { label: "There", href: "there" },
          ],
        },
      ],
    };

    const out = await render(<Navbar config={config} resolveHref={(k) => `/${k}`} icon={icon} />);

    expect([...out.matchAll(/<a href="\/(here|there)"[^>]*>/g)].map((match) => match[0])).toEqual([
      `<a href="/here" data-slot="navbar-link" aria-current="page" data-selected="" class="${BAR_LINK}">`,
      `<a href="/there" data-slot="navbar-link" class="${BAR_LINK}">`,
    ]);
  });
});

describe("Navbar — menus", () => {
  it("renders a bar menu as a Menu trigger and popup with the label and chevron icon", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "File", items: [{ label: "New", href: "new" }] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(MENU_FILE_NEW);
  });

  it("nests a submenu as a Menu.SubmenuTrigger beside its own popup, with no wrapper element", async () => {
    const config: NavDefinition = {
      sections: [{ items: [{ label: "Edit", items: [{ label: "More", items: [{ label: "Deep", href: "deep" }] }] }] }],
    };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(MENU_NESTED);
  });

  it("links each menu trigger to its popup via a shared commandfor/id", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "File", items: [{ label: "New", href: "new" }] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(MENU_FILE_NEW);
  });

  it("mints a distinct id per nested menu popup", async () => {
    const config: NavDefinition = {
      sections: [{ items: [{ label: "Edit", items: [{ label: "More", items: [{ label: "Deep", href: "deep" }] }] }] }],
    };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(MENU_NESTED);
  });
});

describe("Navbar — menu id scoping", () => {
  const ONE_MENU: NavDefinition = { sections: [{ items: [{ label: "File", items: [{ label: "New", href: "new" }] }] }] };
  const NESTED: NavDefinition = {
    sections: [{ items: [{ label: "Edit", items: [{ label: "More", items: [{ label: "Deep", href: "deep" }] }] }] }],
  };

  function idLinks(html: string): { ids: string[]; commandfor: string[] } {
    return {
      ids: [...html.matchAll(/ id="([^"]*)"/g)].map(([, value]) => value ?? ""),
      commandfor: [...html.matchAll(/ commandfor="([^"]*)"/g)].map(([, value]) => value ?? ""),
    };
  }

  it("namespaces each bar's menu ids by its own id, so two bars on a page never collide", async () => {
    const out = await render([
      <Navbar config={ONE_MENU} resolveHref={id} icon={icon} id='primary' />,
      <Navbar config={ONE_MENU} resolveHref={id} icon={icon} id='secondary' />,
    ]);
    expect(idLinks(out)).toEqual({
      ids: ["primary", "navbar-menu-primary-0", "secondary", "navbar-menu-secondary-0"],
      commandfor: ["navbar-menu-primary-0", "navbar-menu-secondary-0"],
    });
  });

  it("falls back to the placement when no id is given, so a top bar and a bottom bar stay disjoint", async () => {
    const out = await render([
      <Navbar config={ONE_MENU} resolveHref={id} icon={icon} />,
      <Navbar config={ONE_MENU} resolveHref={id} icon={icon} placement='bottom' />,
    ]);
    expect(idLinks(out)).toEqual({ ids: ["navbar-menu-top-0", "navbar-menu-bottom-0"], commandfor: ["navbar-menu-top-0", "navbar-menu-bottom-0"] });
  });

  it("keeps every trigger of a single bar pointed at that bar's own popups", async () => {
    const out = await render(<Navbar config={NESTED} resolveHref={id} icon={icon} id='main' />);
    expect(idLinks(out)).toEqual({
      ids: ["main", "navbar-menu-main-0", "navbar-menu-main-1"],
      commandfor: ["navbar-menu-main-0", "navbar-menu-main-1"],
    });
  });

  it("collides when two bars share a placement and neither is given an id", async () => {
    const out = await render([
      <Navbar config={ONE_MENU} resolveHref={id} icon={icon} />,
      <Navbar config={ONE_MENU} resolveHref={id} icon={icon} />,
    ]);

    expect(idLinks(out)).toEqual({ ids: ["navbar-menu-top-0", "navbar-menu-top-0"], commandfor: ["navbar-menu-top-0", "navbar-menu-top-0"] });
  });

  it("an id on either bar is enough to separate two same-placement bars", async () => {
    const out = await render([
      <Navbar config={ONE_MENU} resolveHref={id} icon={icon} />,
      <Navbar config={ONE_MENU} resolveHref={id} icon={icon} id='secondary' />,
    ]);

    expect(idLinks(out)).toEqual({
      ids: ["navbar-menu-top-0", "secondary", "navbar-menu-secondary-0"],
      commandfor: ["navbar-menu-top-0", "navbar-menu-secondary-0"],
    });
  });
});

describe("Navbar — slots", () => {
  it("renders an inline JSX node slot directly", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: <button type='button'>Toggle</button> }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><button type="button">Toggle</button></div></div></details></nav></div>',
    );
  });

  it("resolves a string slot from the slots map", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: "user_name" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} slots={{ user_name: <span>Ada</span> }} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><span>Ada</span></div></div></details></nav></div>',
    );
  });

  it("renders nothing and does not throw for a missing string slot", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: "absent" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"></div></div></details></nav></div>',
    );
  });

  it("renders an optional label beside the slot content", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: "x", label: "Hello" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} slots={{ x: <i>!</i> }} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><span data-slot="navbar-slot" class="inline-flex items-center gap-2"><span>Hello</span><i>!</i></span></div></div></details></nav></div>',
    );
  });
});

describe("Navbar — auth filters", () => {
  it("stamps data-filter and seeds hidden when no active token matches", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "Account", href: "acct", filters: ["user"] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["guest"]} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[&quot;guest&quot;]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/route/acct" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground" data-filter="user" hidden>Account</a></div></div></details></nav></div>',
    );
  });

  it("leaves a matching filtered item visible (no hidden attribute)", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "Account", href: "acct", filters: ["user"] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["user"]} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[&quot;user&quot;]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/route/acct" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground" data-filter="user">Account</a></div></div></details></nav></div>',
    );
  });

  it("serializes the initial filters into the resumable scope state", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["user"]} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[&quot;user&quot;]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">A</a></div></div></details></nav></div>',
    );
  });
});

describe("Navbar — groups", () => {
  const DOCS: NavDefinition = { sections: [{ items: [{ heading: "Docs", group: [{ label: "Intro", href: "intro" }] }] }] };

  const attrs = (html: string, name: string) => [...html.matchAll(new RegExp(` ${name}="([^"]*)"`, "g"))].map(([, value]) => value ?? "");

  it("renders a labelled group whose children are visible bar links", async () => {
    const out = await render(<Navbar config={DOCS} resolveHref={id} icon={icon} />);
    expect(out).toBe(GROUP_DOCS);
  });

  it("associates the group with its heading by id, without asserting a heading level", async () => {
    const out = await render(<Navbar config={DOCS} resolveHref={id} icon={icon} />);
    expect(attrs(out, "aria-labelledby")).toEqual(["navbar-group-top-0"]);
    expect(attrs(out, "id")).toEqual(["navbar-group-top-0"]);
    expect(/<p id="navbar-group-top-0"/.test(out)).toBe(true);
  });

  it("renders a group's children as navbar links, never as menu rows", async () => {
    const out = await render(<Navbar config={DOCS} resolveHref={id} icon={icon} />);
    expect(attrs(out, "data-slot")).toEqual([
      "navbar",
      "navbar-toggle",
      "icon",
      "icon",
      "navbar-section",
      "navbar-group",
      "navbar-group-heading",
      "navbar-link",
    ]);
  });

  it("mints a distinct heading id per group", async () => {
    const config: NavDefinition = {
      sections: [
        {
          items: [
            { heading: "One", group: [{ label: "a", href: "a" }] },
            { heading: "Two", group: [{ label: "b", href: "b" }] },
          ],
        },
      ],
    };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(attrs(out, "id")).toEqual(["navbar-group-top-0", "navbar-group-top-1"]);
    expect(attrs(out, "aria-labelledby")).toEqual(["navbar-group-top-0", "navbar-group-top-1"]);
  });

  it("shares one counter with the menus, so a group and a menu in one bar never collide", async () => {
    const config: NavDefinition = {
      sections: [
        {
          items: [
            { heading: "One", group: [{ label: "a", href: "a" }] },
            { label: "File", items: [{ label: "New", href: "new" }] },
            { heading: "Two", group: [{ label: "b", href: "b" }] },
          ],
        },
      ],
    };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(attrs(out, "id")).toEqual(["navbar-group-top-0", "navbar-menu-top-1", "navbar-group-top-2"]);
    expect(attrs(out, "commandfor")).toEqual(["navbar-menu-top-1"]);
  });

  it("filters a group as a whole while its children keep their own filter state", async () => {
    const config: NavDefinition = {
      sections: [{ items: [{ heading: "Admin", group: [{ label: "Users", href: "users", filters: ["root"] }], filters: ["admin"] }] }],
    };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["root"]} />);
    expect(out).toBe(GROUP_FILTERED);
  });
});

describe("Navbar — megamenu", () => {
  const groups = (n: number) => Array.from({ length: n }, (_, i) => ({ heading: `G${i}`, group: [{ label: `l${i}`, href: `l${i}` }] }));
  const MEGA: NavDefinition = { sections: [{ items: [{ label: "Products", groups: groups(2) }] }] };

  const attrs = (html: string, name: string) => [...html.matchAll(new RegExp(` ${name}="([^"]*)"`, "g"))].map(([, value]) => value ?? "");
  const section = (html: string) => html.slice(html.indexOf('<div data-slot="navbar-section"'));

  const MEGA_SECTION =
    '<div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><div data-slot="popover navbar-megamenu" class="relative inline-block max-md:hidden"><button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="navbar-menu-top-0" aria-controls="navbar-menu-top-0" aria-expanded="false" class="cursor-pointer list-none focus-ring inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"><span>Products</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-top-0" data-slot="popover-content" data-scope="popover" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-32 rounded-box border border-border bg-popover text-popover-foreground shadow-md w-max max-w-[calc(100vw-2rem)] p-4"><div class="grid gap-6 grid-cols-2"><div data-slot="navbar-group" role="group" aria-labelledby="navbar-group-top-1" class="flex flex-col gap-1"><p id="navbar-group-top-1" data-slot="navbar-group-heading" class="px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">G0</p><a href="/route/l0" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">l0</a></div><div data-slot="navbar-group" role="group" aria-labelledby="navbar-group-top-2" class="flex flex-col gap-1"><p id="navbar-group-top-2" data-slot="navbar-group-heading" class="px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">G1</p><a href="/route/l1" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">l1</a></div></div></div></div><div data-slot="navbar-megamenu-list" class="flex flex-col gap-2 md:hidden"><div data-slot="navbar-group" role="group" aria-labelledby="navbar-group-top-3" class="flex flex-col gap-1"><p id="navbar-group-top-3" data-slot="navbar-group-heading" class="px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">G0</p><a href="/route/l0" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">l0</a></div><div data-slot="navbar-group" role="group" aria-labelledby="navbar-group-top-4" class="flex flex-col gap-1"><p id="navbar-group-top-4" data-slot="navbar-group-heading" class="px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">G1</p><a href="/route/l1" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">l1</a></div></div></div></div></details></nav></div>';

  const SUBMENU_SECTION =
    '<div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><div data-slot="menu" class="relative inline-block"><button type="button" data-slot="menu-trigger" command="toggle-popover" commandfor="navbar-menu-top-0" aria-haspopup="menu" aria-controls="navbar-menu-top-0" aria-expanded="false" class="cursor-pointer focus-ring inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"><span>More</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-top-0" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-40 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"><button type="button" role="menuitem" data-slot="menu-submenu-trigger" command="toggle-popover" commandfor="navbar-menu-top-1" aria-haspopup="menu" aria-controls="navbar-menu-top-1" aria-expanded="false" class="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground state-disabled"><span>Mega</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-top-1" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-side="inline-end" data-align="start" class="z-50 min-w-40 rounded-box border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"><fieldset data-slot="menu-group" class="m-0 flex flex-col border-0 p-0" aria-labelledby="navbar-group-top-2"><div data-slot="menu-group-label" class="px-2 py-1.5 text-xs font-medium text-muted-foreground" id="navbar-group-top-2">G0</div><a role="menuitem" data-slot="menu-link-item" class="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground state-disabled" href="/route/l0">l0</a></fieldset></div></div></div></div></div></details></nav></div>';

  const RAIL_MEGA_SECTION =
    '<div data-slot="navbar-section" class="flex flex-col gap-1"><div data-slot="navbar-megamenu-list" class="flex flex-col gap-2"><div data-slot="navbar-group" role="group" aria-labelledby="navbar-group-left-0" class="flex flex-col gap-1"><p id="navbar-group-left-0" data-slot="navbar-group-heading" class="px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">G0</p><a href="/route/l0" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">l0</a></div><div data-slot="navbar-group" role="group" aria-labelledby="navbar-group-left-1" class="flex flex-col gap-1"><p id="navbar-group-left-1" data-slot="navbar-group-heading" class="px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">G1</p><a href="/route/l1" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">l1</a></div></div></div></div></details></nav></div>';

  it("renders a bar-level megamenu as a Popover of link columns beside its collapsed list twin", async () => {
    expect(section(await render(<Navbar config={MEGA} resolveHref={id} icon={icon} />))).toBe(MEGA_SECTION);
  });

  it("renders the columns as role=group blocks and never as a role=menu", async () => {
    const out = await render(<Navbar config={MEGA} resolveHref={id} icon={icon} />);
    expect(attrs(out, "role")).toEqual(["group", "group", "group", "group"]);
    expect(attrs(out, "data-slot").filter((slot) => slot === "navbar-link")).toHaveLength(4);
  });

  it("maps the column count to a literal grid class and caps it at four", async () => {
    const cols = async (n: number) =>
      /class="grid gap-6 (grid-cols-\d)"/.exec(
        await render(<Navbar config={{ sections: [{ items: [{ label: "P", groups: groups(n) }] }] }} resolveHref={id} icon={icon} />),
      )?.[1];
    expect(await cols(1)).toBe("grid-cols-1");
    expect(await cols(3)).toBe("grid-cols-3");
    expect(await cols(4)).toBe("grid-cols-4");
    expect(await cols(6)).toBe("grid-cols-4");
  });

  it("align=end keeps a wide panel on the last bar item inside the viewport", async () => {
    const out = await render(
      <Navbar config={{ sections: [{ items: [{ label: "P", align: "end", groups: groups(1) }] }] }} resolveHref={id} icon={icon} />,
    );
    expect(attrs(out, "data-align")).toEqual(["end"]);
  });

  it("mints one popover id and distinct heading ids per copy, in document order", async () => {
    const out = await render(<Navbar config={MEGA} resolveHref={id} icon={icon} />);
    expect(attrs(out, "id")).toEqual(["navbar-menu-top-0", "navbar-group-top-1", "navbar-group-top-2", "navbar-group-top-3", "navbar-group-top-4"]);
    expect(attrs(out, "aria-labelledby")).toEqual(["navbar-group-top-1", "navbar-group-top-2", "navbar-group-top-3", "navbar-group-top-4"]);
  });

  it("stamps the filter on both copies, hidden together until a token is active", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "P", groups: groups(1), filters: ["user"] }] }] };
    const filtered = (html: string) => [...html.matchAll(/<div [^>]*data-filter="[^"]*"[^>]*>/g)].map(([tag]) => tag);

    expect(filtered(await render(<Navbar config={config} resolveHref={id} icon={icon} />))).toEqual([
      '<div data-slot="popover navbar-megamenu" class="relative inline-block max-md:hidden" data-filter="user" hidden>',
      '<div data-slot="navbar-megamenu-list" class="flex flex-col gap-2 md:hidden" data-filter="user" hidden>',
    ]);
    expect(filtered(await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["user"]} />))).toEqual([
      '<div data-slot="popover navbar-megamenu" class="relative inline-block max-md:hidden" data-filter="user">',
      '<div data-slot="navbar-megamenu-list" class="flex flex-col gap-2 md:hidden" data-filter="user">',
    ]);
  });

  it("renders only the list form in a rail", async () => {
    const out = section(await render(<Navbar config={MEGA} resolveHref={id} icon={icon} collapsible='always' />));
    expect(out).toBe(RAIL_MEGA_SECTION);
    expect(attrs(out, "id")).toEqual(["navbar-group-left-0", "navbar-group-left-1"]);
  });

  it("degrades to a submenu of menu groups below the bar", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "More", items: [{ label: "Mega", groups: groups(1) }] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(section(out)).toBe(SUBMENU_SECTION);
  });
});
