/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../jsx/render-test-helper";
import { createIcon } from "../core/icon";
import { Navbar, type NavDefinition } from "./navbar";

const id = (key: string) => `/route/${key}`;

const icon = createIcon("/sprite.svg", { "icon-chevron-down": "0 0 16 16", "icon-hamburger": "0 0 22 22", "icon-close": "0 0 22 22" });

const SINGLE_A =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">A</a></div></div></details></div>';

const MENU_FILE_NEW =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><div data-slot="popover" class="relative inline-block"><button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="navbar-menu-0" class="list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"><span>File</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-0" data-slot="popover-content" popover="auto" data-align="start" data-side="bottom" class="z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"><a href="/route/new" data-slot="navbar-link" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">New</a></div></div></div></div></details></div>';

const MENU_NESTED =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><div data-slot="popover" class="relative inline-block"><button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="navbar-menu-0" class="list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"><span>Edit</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-0" data-slot="popover-content" popover="auto" data-align="start" data-side="bottom" class="z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"><div data-slot="popover" class="relative inline-block block w-full"><button type="button" data-slot="popover-trigger" command="toggle-popover" commandfor="navbar-menu-1" class="list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"><span>More</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-1" data-slot="popover-content" popover="auto" data-align="start" data-side="bottom" class="z-50 min-w-[8rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"><a href="/route/deep" data-slot="navbar-link" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">Deep</a></div></div></div></div></div></div></details></div>';

describe("Navbar — structure", () => {
  it("renders the root with data-slot=navbar inside a resumable scope", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(SINGLE_A);
  });

  it("spreads sections in a justify-between container", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "Left", href: "l" }] }, { items: [{ label: "Right", href: "r" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/l" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">Left</a></div><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/r" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">Right</a></div></div></details></div>',
    );
  });

  it("renders the mobile hamburger toggle as md:hidden and the sections container as collapsible", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(SINGLE_A);
  });

  it("renders hamburger and close icons via sprite <use> references", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(SINGLE_A);
  });
});

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
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/secret-path" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">Dash</a></div></div></details></div>',
    );
  });
});

describe("Navbar — menus", () => {
  it("renders a menu as a popover <details>/<summary> with the label and chevron icon", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "File", items: [{ label: "New", href: "new" }] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(MENU_FILE_NEW);
  });

  it("nests submenus as nested popover <details>", async () => {
    const config: NavDefinition = {
      sections: [{ items: [{ label: "Edit", items: [{ label: "More", items: [{ label: "Deep", href: "deep" }] }] }] }],
    };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(MENU_NESTED);
  });

  it("links each menu trigger to its popover content via a shared commandfor/id", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "File", items: [{ label: "New", href: "new" }] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(MENU_FILE_NEW);
  });

  it("mints a distinct id per nested menu popover", async () => {
    const config: NavDefinition = {
      sections: [{ items: [{ label: "Edit", items: [{ label: "More", items: [{ label: "Deep", href: "deep" }] }] }] }],
    };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(MENU_NESTED);
  });
});

describe("Navbar — slots", () => {
  it("renders an inline JSX node slot directly", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: <button type='button'>Toggle</button> }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><button type="button">Toggle</button></div></div></details></div>',
    );
  });

  it("resolves a string slot from the slots map", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: "user_name" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} slots={{ user_name: <span>Ada</span> }} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><span>Ada</span></div></div></details></div>',
    );
  });

  it("renders nothing and does not throw for a missing string slot", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: "absent" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"></div></div></details></div>',
    );
  });

  it("renders an optional label beside the slot content", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: "x", label: "Hello" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} slots={{ x: <i>!</i> }} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><span data-slot="navbar-slot" class="inline-flex items-center gap-2"><span>Hello</span><i>!</i></span></div></div></details></div>',
    );
  });
});

describe("Navbar — auth filters", () => {
  it("stamps data-filter and seeds hidden when no active token matches", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "Account", href: "acct", filters: ["user"] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["guest"]} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[&quot;guest&quot;]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/acct" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" data-filter="user" hidden>Account</a></div></div></details></div>',
    );
  });

  it("leaves a matching filtered item visible (no hidden attribute)", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "Account", href: "acct", filters: ["user"] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["user"]} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[&quot;user&quot;]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/acct" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring" data-filter="user">Account</a></div></div></details></div>',
    );
  });

  it("serializes the initial filters into the resumable scope state", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["user"]} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[&quot;user&quot;]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">A</a></div></div></details></div>',
    );
  });
});

describe("Navbar — placement", () => {
  it("emits the top placement class string by default", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(SINGLE_A);
  });

  it("emits the bottom placement class string", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} placement='bottom' />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky right-0 inset-y-0 md:inset-x-0 md:bottom-0 md:top-auto md:left-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">A</a></div></div></details></div>',
    );
  });

  it("merges a custom class onto the root", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} class='my-bar' />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto my-bar"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">A</a></div></div></details></div>',
    );
  });

  it("forwards passthrough nav attributes (id, data-ref) to the root", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} id='main-nav' data-ref='nav' />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><details data-slot="navbar" class="group z-40 border-border bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto" id="main-nav" data-ref="nav"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">A</a></div></div></details></div>',
    );
  });
});
