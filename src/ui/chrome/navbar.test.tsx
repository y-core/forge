/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */
import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
import { createIcon } from "../core/icon";
import { Navbar, type NavDefinition, type NavPlacement } from "./navbar";

const id = (key: string) => `/route/${key}`;

const icon = createIcon("/sprite.svg", {
  "icon-chevron-down": "0 0 16 16",
  "icon-hamburger": "0 0 22 22",
  "icon-close": "0 0 22 22",
  "icon-panel-open": "0 0 24 24",
  "icon-panel-close": "0 0 24 24",
});

const SINGLE_A =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">A</a></div></div></details></nav></div>';

const MENU_FILE_NEW =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><div data-slot="menu" class="relative inline-block"><button type="button" data-slot="menu-trigger" command="toggle-popover" commandfor="navbar-menu-top-0" aria-haspopup="menu" aria-controls="navbar-menu-top-0" aria-expanded="false" class="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"><span>File</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-top-0" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-[10rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"><a role="menuitem" data-slot="menu-link-item" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50" href="/route/new">New</a></div></div></div></div></details></nav></div>';

const MENU_NESTED =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><div data-slot="menu" class="relative inline-block"><button type="button" data-slot="menu-trigger" command="toggle-popover" commandfor="navbar-menu-top-0" aria-haspopup="menu" aria-controls="navbar-menu-top-0" aria-expanded="false" class="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"><span>Edit</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-top-0" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-[10rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"><button type="button" role="menuitem" data-slot="menu-submenu-trigger" command="toggle-popover" commandfor="navbar-menu-top-1" aria-haspopup="menu" aria-controls="navbar-menu-top-1" aria-expanded="false" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50"><span>More</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-top-1" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-side="inline-end" data-align="start" class="z-50 min-w-[10rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"><a role="menuitem" data-slot="menu-link-item" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50" href="/route/deep">Deep</a></div></div></div></div></div></details></nav></div>';

const RAIL_LEFT_A =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}" class="h-full"><nav class="h-full"><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky top-0 left-0 max-h-dvh overflow-y-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="sticky top-0 flex items-center justify-start group-open:justify-end p-3 bg-background/95 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex flex-col gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">A</a></div></div></details></nav></div>';

const RAIL_MENU_FILE_NEW =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}" class="h-full"><nav class="h-full"><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky top-0 left-0 max-h-dvh overflow-y-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="sticky top-0 flex items-center justify-start group-open:justify-end p-3 bg-background/95 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex flex-col gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col gap-1"><div data-slot="menu" class="relative inline-block"><button type="button" data-slot="menu-trigger" command="toggle-popover" commandfor="navbar-menu-left-0" aria-haspopup="menu" aria-controls="navbar-menu-left-0" aria-expanded="false" class="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"><span>File</span><span aria-hidden="true" class="text-xs opacity-70"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></button><div id="navbar-menu-left-0" role="menu" data-slot="menu-popup" data-scope="menu" popover="auto" data-side="bottom" data-align="start" class="z-50 min-w-[10rem] rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"><a role="menuitem" data-slot="menu-link-item" class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm text-popover-foreground bg-transparent border-0 cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50" href="/route/new">New</a></div></div></div></div></details></nav></div>';

const OPEN_A =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto" open><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">A</a></div></div></details></nav></div>';

const GROUP_DOCS =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><div data-slot="navbar-group" role="group" aria-labelledby="navbar-group-top-0" class="flex flex-col gap-1"><p id="navbar-group-top-0" data-slot="navbar-group-heading" class="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Docs</p><a href="/route/intro" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">Intro</a></div></div></div></details></nav></div>';

const GROUP_FILTERED =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[&quot;root&quot;]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><div data-slot="navbar-group" role="group" aria-labelledby="navbar-group-top-0" class="flex flex-col gap-1" data-filter="admin" hidden><p id="navbar-group-top-0" data-slot="navbar-group-heading" class="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Admin</p><a href="/route/users" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold" data-filter="root">Users</a></div></div></div></details></nav></div>';

const DRAWER_TOP_A =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto max-md:bg-transparent max-md:backdrop-blur-none" data-navbar-drawer><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:relative max-md:z-50"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div data-slot="navbar-backdrop" data-on-click="closeNav" aria-hidden="true" class="hidden max-md:block max-md:fixed max-md:inset-0 max-md:z-30 max-md:bg-foreground/40 max-md:invisible max-md:opacity-0 max-md:group-open:visible max-md:group-open:opacity-100 max-md:transition-[opacity,visibility]"></div><div class="md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2 max-md:fixed max-md:inset-y-0 max-md:z-40 max-md:flex max-md:w-72 max-md:max-w-[85vw] max-md:flex-col max-md:overflow-y-auto max-md:border-border max-md:bg-background max-md:p-4 max-md:shadow-xl max-md:invisible max-md:group-open:visible max-md:group-open:translate-x-0 max-md:transition-[transform,visibility] max-md:duration-200 motion-reduce:max-md:transition-none max-md:start-0 max-md:border-e max-md:-translate-x-full max-md:rtl:translate-x-full"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">A</a></div></div></details></nav></div>';

const DRAWER_RAIL_RIGHT_A =
  '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}" class="h-full"><nav class="h-full"><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky top-0 right-0 max-h-dvh overflow-y-auto max-md:bg-transparent max-md:backdrop-blur-none max-md:max-h-none max-md:overflow-visible" data-navbar-drawer><summary data-slot="navbar-toggle" aria-label="Menu" class="sticky top-0 flex items-center justify-start group-open:justify-end p-3 bg-background/95 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:relative max-md:z-50"><span class="group-open:hidden -scale-x-100 rtl:scale-x-100" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-panel-open"></use></svg></span><span class="hidden group-open:inline -scale-x-100 rtl:scale-x-100" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-panel-close"></use></svg></span></summary><div data-slot="navbar-backdrop" data-on-click="closeNav" aria-hidden="true" class="hidden max-md:block max-md:fixed max-md:inset-0 max-md:z-30 max-md:bg-foreground/40 max-md:invisible max-md:opacity-0 max-md:group-open:visible max-md:group-open:opacity-100 max-md:transition-[opacity,visibility]"></div><div class="md:hidden md:group-open:flex flex-col gap-4 p-2 max-md:fixed max-md:inset-y-0 max-md:z-40 max-md:flex max-md:w-72 max-md:max-w-[85vw] max-md:flex-col max-md:overflow-y-auto max-md:border-border max-md:bg-background max-md:p-4 max-md:shadow-xl max-md:invisible max-md:group-open:visible max-md:group-open:translate-x-0 max-md:transition-[transform,visibility] max-md:duration-200 motion-reduce:max-md:transition-none max-md:end-0 max-md:border-s max-md:translate-x-full max-md:rtl:-translate-x-full"><div data-slot="navbar-section" class="flex flex-col gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">A</a></div></div></details></nav></div>';

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
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/l" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">Left</a></div><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/r" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">Right</a></div></div></details></nav></div>',
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

describe("Navbar — landmark", () => {
  const A: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };

  const landmark = (html: string) => /<nav([^>]*)><details([^>]*)>/.exec(html);

  it("wraps the disclosure in a real nav element", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} />);
    expect(landmark(out)?.[1]).toBe("");
    expect(out.includes('role="navigation"')).toBe(false);
  });

  it("puts aria-label on the landmark and leaves the disclosure unnamed", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} aria-label='Component catalog' />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav aria-label="Component catalog"><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">A</a></div></div></details></nav></div>',
    );
    expect(landmark(out)?.[1]).toBe(' aria-label="Component catalog"');
    expect(/<details[^>]*aria-label/.test(out)).toBe(false);
  });

  it("puts aria-labelledby on the landmark too", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} aria-labelledby='toc-heading' />);
    expect(landmark(out)?.[1]).toBe(' aria-labelledby="toc-heading"');
    expect(/<details[^>]*aria-labelledby/.test(out)).toBe(false);
  });

  it("leaves the disclosure holding its slot, its classes and its open state", async () => {
    const out = await render(
      <Navbar config={A} resolveHref={id} icon={icon} collapsible='always' placement='left' defaultOpen aria-label='Catalog' />,
    );
    expect(landmark(out)?.[1]).toBe(' aria-label="Catalog" class="h-full"');
    expect(landmark(out)?.[2]).toBe(
      ' data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky top-0 left-0 max-h-dvh overflow-y-auto" open',
    );
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
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/secret-path" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">Dash</a></div></div></details></nav></div>',
    );
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
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><button type="button">Toggle</button></div></div></details></nav></div>',
    );
  });

  it("resolves a string slot from the slots map", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: "user_name" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} slots={{ user_name: <span>Ada</span> }} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><span>Ada</span></div></div></details></nav></div>',
    );
  });

  it("renders nothing and does not throw for a missing string slot", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: "absent" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"></div></div></details></nav></div>',
    );
  });

  it("renders an optional label beside the slot content", async () => {
    const config: NavDefinition = { sections: [{ items: [{ slot: "x", label: "Hello" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} slots={{ x: <i>!</i> }} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><span data-slot="navbar-slot" class="inline-flex items-center gap-2"><span>Hello</span><i>!</i></span></div></div></details></nav></div>',
    );
  });
});

describe("Navbar — auth filters", () => {
  it("stamps data-filter and seeds hidden when no active token matches", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "Account", href: "acct", filters: ["user"] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["guest"]} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[&quot;guest&quot;]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/acct" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold" data-filter="user" hidden>Account</a></div></div></details></nav></div>',
    );
  });

  it("leaves a matching filtered item visible (no hidden attribute)", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "Account", href: "acct", filters: ["user"] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["user"]} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[&quot;user&quot;]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/acct" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold" data-filter="user">Account</a></div></div></details></nav></div>',
    );
  });

  it("serializes the initial filters into the resumable scope state", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} activeFilters={["user"]} />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[&quot;user&quot;]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">A</a></div></div></details></nav></div>',
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
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky right-0 inset-y-0 md:inset-x-0 md:bottom-0 md:top-auto md:left-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">A</a></div></div></details></nav></div>',
    );
  });

  it("merges a custom class onto the root", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} class='my-bar' />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto my-bar"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">A</a></div></div></details></nav></div>',
    );
  });

  it("forwards passthrough nav attributes (id, data-ref) to the root", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} id='main-nav' data-ref='nav' />);
    expect(out).toBe(
      '<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details data-slot="navbar" class="group z-40 bg-background/95 backdrop-blur sticky left-0 inset-y-0 md:inset-x-0 md:top-0 md:bottom-auto md:right-auto" id="main-nav" data-ref="nav"><summary data-slot="navbar-toggle" aria-label="Menu" class="md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden group-open:flex md:flex flex-col md:flex-row md:items-center justify-between gap-4 p-2"><div data-slot="navbar-section" class="flex flex-col md:flex-row md:items-center gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current]:bg-accent aria-[current]:text-accent-foreground aria-[current]:font-semibold">A</a></div></div></details></nav></div>',
    );
  });
});

describe("Navbar — collapsible", () => {
  const A: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };

  const panelClass = (html: string) => /<\/summary><div class="([^"]*)"/.exec(html)?.[1] ?? "";
  const classOf = (html: string, slot: string) => new RegExp(`data-slot="${slot}"[^>]*? class="([^"]*)"`).exec(html)?.[1] ?? "";
  const rootClass = (html: string) => /<details data-slot="navbar" class="([^"]*)"/.exec(html)?.[1] ?? "";

  it('emits exactly the pre-existing markup when collapsible="mobile" is passed explicitly', async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='mobile' />);
    expect(out).toBe(SINGLE_A);
  });

  it('renders the rail shape for collapsible="always"', async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' placement='left' />);
    expect(out).toBe(RAIL_LEFT_A);
  });

  it('defaults placement to "left" when collapsible="always" and none is given', async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' />);
    expect(out).toBe(RAIL_LEFT_A);
  });

  it("namespaces an unnamed rail's generated menu ids by the resolved placement", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "File", items: [{ label: "New", href: "new" }] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} collapsible='always' />);
    expect(out).toBe(RAIL_MENU_FILE_NEW);
  });

  it("drops md:hidden from the toggle, so the rail keeps its control at every breakpoint", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' />);
    expect(classOf(out, "navbar-toggle")).toBe(
      "sticky top-0 flex items-center justify-start group-open:justify-end p-3 bg-background/95 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring",
    );
  });

  it("pins the rail's toggle and flips its justification on the disclosure's open state", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' />);
    const toggle = classOf(out, "navbar-toggle").split(" ");

    expect(toggle).toContain("sticky");
    expect(toggle).toContain("top-0");
    expect(toggle).toContain("bg-background/95");
    expect(toggle).toContain("justify-start");
    expect(toggle).toContain("group-open:justify-end");
    expect(toggle).not.toContain("justify-end");
  });

  it("carries the height chain on both boxes it owns between the layout and the disclosure", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' />);

    expect(/<div data-scope="navbar"[^>]* class="h-full">/.test(out)).toBe(true);
    expect(/<nav class="h-full">/.test(out)).toBe(true);
  });

  it("leaves the expanding bar's markup untouched — no height chain, no sticky toggle", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} />);

    expect(out).toBe(SINGLE_A);
    expect(out.startsWith('<div data-scope="navbar" data-state="{&quot;filters&quot;:[]}"><nav><details')).toBe(true);
    expect(classOf(out, "navbar-toggle")).toBe(
      "md:hidden flex items-center justify-end p-3 list-none cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring",
    );
  });

  it("keeps the panel and its sections vertical at every breakpoint", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' />);
    expect(panelClass(out)).toBe("hidden group-open:flex flex-col gap-4 p-2");
    expect(classOf(out, "navbar-section")).toBe("flex flex-col gap-1");
  });

  it("emits the rail placement class string for each of the four placements", async () => {
    const placements: NavPlacement[] = ["top", "bottom", "left", "right"];
    const classes = await Promise.all(
      placements.map(async (placement) =>
        rootClass(await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' placement={placement} />)),
      ),
    );
    expect(classes).toEqual([
      "group z-40 bg-background/95 backdrop-blur sticky top-0 inset-x-0",
      "group z-40 bg-background/95 backdrop-blur sticky bottom-0 inset-x-0",
      "group z-40 bg-background/95 backdrop-blur sticky top-0 left-0 max-h-dvh overflow-y-auto",
      "group z-40 bg-background/95 backdrop-blur sticky top-0 right-0 max-h-dvh overflow-y-auto",
    ]);
  });
});

describe("Navbar — drawer mode", () => {
  const A: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };

  const panelClass = (html: string) => /<div data-slot="navbar-backdrop"[^>]*><\/div><div class="([^"]*)"/.exec(html)?.[1]?.split(" ") ?? [];
  const classOf = (html: string, slot: string) => new RegExp(`data-slot="${slot}"[^>]*? class="([^"]*)"`).exec(html)?.[1] ?? "";

  it("renders the whole off-canvas shape for the ordinary bar", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />);
    expect(out).toBe(DRAWER_TOP_A);
  });

  it("renders the trailing-edge shape for a right-placed rail", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' placement='right' collapsedAs='drawer' />);
    expect(out).toBe(DRAWER_RAIL_RIGHT_A);
  });

  it("leaves the inline default byte-identical, which is what scoping every drawer class to max-md buys", async () => {
    expect(await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='inline' />)).toBe(SINGLE_A);
    expect(await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' collapsedAs='inline' />)).toBe(RAIL_LEFT_A);
    expect(await render(<Navbar config={A} resolveHref={id} icon={icon} />)).toBe(SINGLE_A);
  });

  it("stamps the drawer attribute the client scope finds the bar by, and only in drawer mode", async () => {
    const attr = (html: string) => / data-navbar-drawer(?=[\s>])/.test(html);
    expect(attr(await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />))).toBe(true);
    expect(attr(await render(<Navbar config={A} resolveHref={id} icon={icon} />))).toBe(false);
  });

  it("renders the backdrop between the toggle and the panel, as a non-focusable div carrying the close action", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />);
    expect(/<\/summary><div data-slot="navbar-backdrop" data-on-click="closeNav" aria-hidden="true"/.test(out)).toBe(true);
    expect(out.includes("<button")).toBe(false);
  });

  it("renders no backdrop at all in the inline default", async () => {
    expect((await render(<Navbar config={A} resolveHref={id} icon={icon} />)).includes("navbar-backdrop")).toBe(false);
  });

  it("drops the bar's own backdrop-filter below md, which would otherwise contain the fixed panel", async () => {
    const bar = (html: string) => (/<details data-slot="navbar" class="([^"]*)"/.exec(html)?.[1] ?? "").split(" ");
    expect(bar(await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />))).toEqual([
      "group",
      "z-40",
      "bg-background/95",
      "backdrop-blur",
      "sticky",
      "left-0",
      "inset-y-0",
      "md:inset-x-0",
      "md:top-0",
      "md:bottom-auto",
      "md:right-auto",
      "max-md:bg-transparent",
      "max-md:backdrop-blur-none",
    ]);
  });

  it("releases the rail's own scroll box too, which would otherwise clip the panel that left the flow", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' collapsedAs='drawer' />);
    const bar = (/<details data-slot="navbar" class="([^"]*)"/.exec(out)?.[1] ?? "").split(" ");
    expect(bar).toContain("max-md:max-h-none");
    expect(bar).toContain("max-md:overflow-visible");
  });

  it("hides the closed panel by visibility rather than display, which is what leaves the slide transitionable", async () => {
    const panel = panelClass(await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />));
    expect(panel).toContain("max-md:invisible");
    expect(panel).toContain("max-md:group-open:visible");
    expect(panel).toContain("max-md:transition-[transform,visibility]");
    expect(panel).toContain("motion-reduce:max-md:transition-none");
    expect(panel).not.toContain("hidden");
    expect(panel).not.toContain("group-open:flex");
  });

  it("derives the edge from placement, mirroring both the offset and the transform under rtl", async () => {
    const edgeOf = async (placement: NavPlacement) =>
      panelClass(await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' placement={placement} />)).filter((token) =>
        /^max-md:(?:start-0|end-0|border-e|border-s|-?translate-x-full|rtl:-?translate-x-full)$/.test(token),
      );
    const leading = ["max-md:start-0", "max-md:border-e", "max-md:-translate-x-full", "max-md:rtl:translate-x-full"];
    const trailing = ["max-md:end-0", "max-md:border-s", "max-md:translate-x-full", "max-md:rtl:-translate-x-full"];

    expect(await edgeOf("top")).toEqual(leading);
    expect(await edgeOf("left")).toEqual(leading);
    expect(await edgeOf("right")).toEqual(trailing);
    expect(await edgeOf("bottom")).toEqual(trailing);
  });

  it("draws the panel pair for a rail, and leaves a bar its hamburger even when it opens off-canvas", async () => {
    const railDrawer = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' collapsedAs='drawer' />);
    const barDrawer = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />);
    const railInline = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' />);
    const barInline = await render(<Navbar config={A} resolveHref={id} icon={icon} />);
    const glyphs = (html: string) => [...html.matchAll(/#icon-([\w-]+)/g)].map(([, name]) => name);

    expect(glyphs(railDrawer)).toEqual(["panel-open", "panel-close"]);
    expect(glyphs(barDrawer)).toEqual(["hamburger", "close"]);
    expect(glyphs(railInline)).toEqual(["hamburger", "close"]);
    expect(glyphs(barInline)).toEqual(["hamburger", "close"]);
  });

  it("mirrors the one drawn pair rather than carrying a second: trailing flips, and rtl flips again", async () => {
    const mirrorOf = async (placement: NavPlacement) => {
      const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' collapsedAs='drawer' placement={placement} />);
      return [...out.matchAll(/<span class="(?:group-open:hidden|hidden group-open:inline) ([^"]*)"/g)].map(([, cls]) => cls);
    };

    expect(await mirrorOf("top")).toEqual(["rtl:-scale-x-100", "rtl:-scale-x-100"]);
    expect(await mirrorOf("left")).toEqual(["rtl:-scale-x-100", "rtl:-scale-x-100"]);
    expect(await mirrorOf("right")).toEqual(["-scale-x-100 rtl:scale-x-100", "-scale-x-100 rtl:scale-x-100"]);
    expect(await mirrorOf("bottom")).toEqual(["-scale-x-100 rtl:scale-x-100", "-scale-x-100 rtl:scale-x-100"]);
  });

  it("leaves a hamburger toggle's glyph spans free of any mirroring class, drawer or not", async () => {
    for (const node of [
      <Navbar config={A} resolveHref={id} icon={icon} />,
      <Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />,
      <Navbar config={A} resolveHref={id} icon={icon} collapsible='always' />,
    ]) {
      const out = await render(node);
      expect(out).toContain('<span class="group-open:hidden" aria-hidden="true">');
      expect(out).toContain('<span class="hidden group-open:inline" aria-hidden="true">');
      expect(out.includes("scale-x")).toBe(false);
    }
  });

  it("lifts the toggle above the backdrop, which is what keeps the drawer dismissable with no JavaScript", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />);
    const toggle = classOf(out, "navbar-toggle").split(" ");
    expect(toggle).toContain("max-md:relative");
    expect(toggle).toContain("max-md:z-50");
  });
});

describe("Navbar — defaultOpen", () => {
  const A: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };

  it("emits the open attribute on the underlying details", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} defaultOpen />);
    expect(out).toBe(OPEN_A);
  });

  it("emits no open attribute at all when it is not asked for", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} />);
    expect(out).toBe(SINGLE_A);
    expect(out.includes(" open")).toBe(false);
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
