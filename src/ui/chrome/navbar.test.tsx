/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/render/jsx */
import { describe, expect, it } from "bun:test";

import { attrOf, attrsOf } from "../../testing/markup";
import { render } from "../../testing/render";
import type { ScopeDefinition } from "../client/types";
import { LABEL_DEFAULTS } from "../contracts/labels";
import { NAVBAR_SCOPE } from "../contracts/navbar-contract";
import { scopeAttrs } from "../contracts/scope-attrs";
import type { NavbarAction } from "../contracts/types";
import { createIcon } from "../core/icon";
import { Navbar } from "./navbar";
import type { NavDrawerEdge, NavPlacement } from "./types";
import type { NavDefinition } from "./types";

const id = (key: string) => `/route/${key}`;

const icon = createIcon("/sprite.svg", {
  "icon-chevron-down": "0 0 16 16",
  "icon-hamburger": "0 0 22 22",
  "icon-close": "0 0 22 22",
  "icon-panel-open": "0 0 24 24",
  "icon-panel-close": "0 0 24 24",
});

const SINGLE_A =
  '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}" class="z-40 sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><nav><details data-slot="navbar" data-side="top" class="group bg-background/95 backdrop-blur"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden h-(--forge-navbar-row)"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center md:h-(--forge-navbar-row)"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">A</a></div></div></details></nav></div>';

const RAIL_LEFT_A =
  '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}" class="h-full"><nav class="h-full"><details data-slot="navbar" data-side="left" class="group bg-background/95 backdrop-blur z-40 sticky top-0 left-0 max-h-dvh overflow-y-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="sticky top-0 flex cursor-pointer list-none items-center justify-start bg-background/95 p-3 focus-ring group-open:justify-end"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col gap-4 p-2 group-open:flex"><div data-slot="navbar-section" class="flex flex-col gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">A</a></div></div></details></nav></div>';

const RAIL_MENU_FILE_NEW =
  '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}" class="h-full"><nav class="h-full"><details data-slot="navbar" data-side="left" class="group bg-background/95 backdrop-blur z-40 sticky top-0 left-0 max-h-dvh overflow-y-auto"><summary data-slot="navbar-toggle" aria-label="Menu" class="sticky top-0 flex cursor-pointer list-none items-center justify-start bg-background/95 p-3 focus-ring group-open:justify-end"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col gap-4 p-2 group-open:flex"><div data-slot="navbar-section" class="flex flex-col gap-1"><details data-slot="navbar-disclosure" class=""><summary data-slot="navbar-disclosure-trigger" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground w-full list-none justify-between [&amp;::-webkit-details-marker]:hidden"><span>File</span><span aria-hidden="true" class="text-xs opacity-70 motion-safe:transition-transform [[open]&gt;summary&gt;&amp;]:rotate-180"><svg data-slot="icon" width="16" height="16" viewBox="0 0 16 16" class="" aria-hidden="true" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><use href="/sprite.svg#icon-chevron-down"></use></svg></span></summary><div data-slot="navbar-disclosure-content" class="ms-3 flex flex-col gap-1 border-s border-border ps-2"><a href="/route/new" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">New</a></div></details></div></div></details></nav></div>';

const OPEN_A =
  '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}" class="z-40 sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><nav><details data-slot="navbar" data-side="top" class="group bg-background/95 backdrop-blur" open><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden h-(--forge-navbar-row)"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center md:h-(--forge-navbar-row)"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">A</a></div></div></details></nav></div>';

const DRAWER_TOP_A =
  '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}" class="z-40 sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><nav><details data-slot="navbar" data-side="top" class="group bg-background/95 backdrop-blur max-md:bg-transparent max-md:backdrop-blur-none" data-navbar-drawer><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden h-(--forge-navbar-row) max-md:relative max-md:z-50 max-md:h-(--forge-navbar-row)"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div data-slot="navbar-backdrop" data-on-click="closeNav" aria-hidden="true" class="hidden max-md:invisible max-md:fixed max-md:inset-0 max-md:z-30 max-md:block max-md:bg-foreground/40 max-md:opacity-0 max-md:duration-(--forge-motion-exit) max-md:ease-out max-md:group-open:visible max-md:group-open:opacity-100 max-md:group-open:duration-(--forge-motion-enter) motion-safe:max-md:transition-[opacity,visibility] motion-reduce:max-md:transition-[opacity,visibility]"></div><div class="flex-col justify-between gap-4 p-2 md:flex md:flex-row md:items-center md:h-(--forge-navbar-row) max-md:invisible max-md:fixed max-md:inset-y-0 max-md:z-40 max-md:flex max-md:w-72 max-md:max-w-[85vw] max-md:flex-col max-md:overflow-y-auto max-md:border-border max-md:bg-background max-md:p-4 max-md:shadow-xl max-md:transition-[translate,opacity,visibility] max-md:duration-(--forge-motion-exit) max-md:ease-out max-md:group-open:visible max-md:group-open:transition-[translate,opacity] max-md:group-open:duration-(--forge-motion-enter) motion-safe:max-md:group-open:translate-x-0 motion-reduce:max-md:opacity-0 motion-reduce:max-md:group-open:opacity-100 max-md:start-0 max-md:border-e motion-safe:max-md:-translate-x-full motion-safe:max-md:rtl:translate-x-full max-md:pt-(--forge-navbar-row)"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">A</a></div></div></details></nav></div>';

const DRAWER_RAIL_RIGHT_A =
  '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}" class="h-full"><nav class="h-full"><details data-slot="navbar" data-side="right" class="group bg-background/95 backdrop-blur z-40 sticky top-0 right-0 max-h-dvh overflow-y-auto max-md:bg-transparent max-md:backdrop-blur-none max-md:max-h-none max-md:overflow-visible" data-navbar-drawer><summary data-slot="navbar-toggle" aria-label="Menu" class="sticky top-0 flex cursor-pointer list-none items-center justify-start bg-background/95 p-3 focus-ring group-open:justify-end max-md:relative max-md:z-50 max-md:h-(--forge-navbar-row)"><span class="group-open:hidden -scale-x-100 rtl:scale-x-100" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-panel-open"></use></svg></span><span class="hidden group-open:inline -scale-x-100 rtl:scale-x-100" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 24 24" class="" aria-hidden="true"><use href="/sprite.svg#icon-panel-close"></use></svg></span></summary><div data-slot="navbar-backdrop" data-on-click="closeNav" aria-hidden="true" class="hidden max-md:invisible max-md:fixed max-md:inset-0 max-md:z-30 max-md:block max-md:bg-foreground/40 max-md:opacity-0 max-md:duration-(--forge-motion-exit) max-md:ease-out max-md:group-open:visible max-md:group-open:opacity-100 max-md:group-open:duration-(--forge-motion-enter) motion-safe:max-md:transition-[opacity,visibility] motion-reduce:max-md:transition-[opacity,visibility]"></div><div class="flex-col gap-4 p-2 md:hidden md:group-open:flex max-md:invisible max-md:fixed max-md:inset-y-0 max-md:z-40 max-md:flex max-md:w-72 max-md:max-w-[85vw] max-md:flex-col max-md:overflow-y-auto max-md:border-border max-md:bg-background max-md:p-4 max-md:shadow-xl max-md:transition-[translate,opacity,visibility] max-md:duration-(--forge-motion-exit) max-md:ease-out max-md:group-open:visible max-md:group-open:transition-[translate,opacity] max-md:group-open:duration-(--forge-motion-enter) motion-safe:max-md:group-open:translate-x-0 motion-reduce:max-md:opacity-0 motion-reduce:max-md:group-open:opacity-100 max-md:end-0 max-md:border-s motion-safe:max-md:translate-x-full motion-safe:max-md:rtl:-translate-x-full max-md:pt-(--forge-navbar-row)"><div data-slot="navbar-section" class="flex flex-col gap-1"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">A</a></div></div></details></nav></div>';

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
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}" class="z-40 sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><nav><details data-slot="navbar" data-side="top" class="group bg-background/95 backdrop-blur"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden h-(--forge-navbar-row)"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center md:h-(--forge-navbar-row)"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/route/l" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">Left</a></div><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/route/r" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">Right</a></div></div></details></nav></div>',
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
    expect(out).toBe(SINGLE_A);
  });

  it("puts aria-label on the landmark and leaves the disclosure unnamed", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} aria-label='Component catalog' />);
    expect(out).toBe(
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}" class="z-40 sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><nav aria-label="Component catalog"><details data-slot="navbar" data-side="top" class="group bg-background/95 backdrop-blur"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden h-(--forge-navbar-row)"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center md:h-(--forge-navbar-row)"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">A</a></div></div></details></nav></div>',
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
      ' data-slot="navbar" data-side="left" class="group bg-background/95 backdrop-blur z-40 sticky top-0 left-0 max-h-dvh overflow-y-auto" open',
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
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}" class="z-40 sticky inset-y-0 right-0 md:inset-x-0 md:top-auto md:bottom-0 md:left-auto"><nav><details data-slot="navbar" data-side="bottom" class="group bg-background/95 backdrop-blur"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden h-(--forge-navbar-row)"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center md:h-(--forge-navbar-row)"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">A</a></div></div></details></nav></div>',
    );
  });

  it("merges a custom class onto the root", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} class='my-bar' />);
    expect(out).toBe(
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}" class="z-40 sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><nav><details data-slot="navbar" data-side="top" class="group bg-background/95 backdrop-blur my-bar"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden h-(--forge-navbar-row)"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center md:h-(--forge-navbar-row)"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">A</a></div></div></details></nav></div>',
    );
  });

  it("lands a forwarded id, data-ref and class on the disclosure and leaves the sticky wrapper without them", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} id='x' data-ref='nav' class='my-bar' />);
    const wrapper = /<div data-scope="navbar"([^>]*)>/.exec(out)?.[1] ?? "";
    const details = /<details([^>]*)>/.exec(out)?.[1] ?? "";

    expect(details).toBe(' data-slot="navbar" data-side="top" class="group bg-background/95 backdrop-blur my-bar" id="x" data-ref="nav"');
    expect(wrapper).toBe(
      ' data-island-state="{&quot;filters&quot;:[]}" class="z-40 sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"',
    );
  });

  it("forwards passthrough nav attributes (id, data-ref) to the root", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} id='main-nav' data-ref='nav' />);
    expect(out).toBe(
      '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}" class="z-40 sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><nav><details data-slot="navbar" data-side="top" class="group bg-background/95 backdrop-blur" id="main-nav" data-ref="nav"><summary data-slot="navbar-toggle" aria-label="Menu" class="flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden h-(--forge-navbar-row)"><span class="group-open:hidden" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-hamburger"></use></svg></span><span class="hidden group-open:inline" aria-hidden="true"><svg data-slot="icon" width="22" height="22" viewBox="0 0 22 22" class="" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg></span></summary><div class="hidden flex-col justify-between gap-4 p-2 group-open:flex md:flex md:flex-row md:items-center md:h-(--forge-navbar-row)"><div data-slot="navbar-section" class="flex flex-col gap-1 md:flex-row md:items-center"><a href="/route/a" data-slot="navbar-link" class="inline-flex items-center gap-1 rounded-field px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer focus-ring aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground">A</a></div></div></details></nav></div>',
    );
  });
});

describe("Navbar — collapsible", () => {
  const A: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };

  const panelClass = (html: string) => /<\/summary><div class="([^"]*)"/.exec(html)?.[1] ?? "";
  const classOf = (html: string, slot: string) => new RegExp(`data-slot="${slot}"[^>]*? class="([^"]*)"`).exec(html)?.[1] ?? "";
  const rootClass = (html: string) => /<details data-slot="navbar" data-side="[^"]*" class="([^"]*)"/.exec(html)?.[1] ?? "";
  const wrapperClass = (html: string) => /<div data-scope="navbar"[^>]* class="([^"]*)"/.exec(html)?.[1] ?? "";

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

  it("renders an unnamed rail's menu as a disclosure, minting no menu ids", async () => {
    const config: NavDefinition = { sections: [{ items: [{ label: "File", items: [{ label: "New", href: "new" }] }] }] };
    const out = await render(<Navbar config={config} resolveHref={id} icon={icon} collapsible='always' />);
    expect(out).toBe(RAIL_MENU_FILE_NEW);
  });

  it("drops md:hidden from the toggle, so the rail keeps its control at every breakpoint", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' />);
    expect(classOf(out, "navbar-toggle")).toBe(
      "sticky top-0 flex cursor-pointer list-none items-center justify-start bg-background/95 p-3 focus-ring group-open:justify-end",
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
    expect(
      out.startsWith(
        '<div data-scope="navbar" data-island-state="{&quot;filters&quot;:[]}" class="z-40 sticky inset-y-0 left-0 md:inset-x-0 md:top-0 md:right-auto md:bottom-auto"><nav><details',
      ),
    ).toBe(true);
    expect(classOf(out, "navbar-toggle")).toBe(
      "flex cursor-pointer list-none items-center justify-end p-3 focus-ring md:hidden h-(--forge-navbar-row)",
    );
  });

  it("keeps the panel and its sections vertical at every breakpoint", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' />);
    expect(panelClass(out)).toBe("hidden flex-col gap-4 p-2 group-open:flex");
    expect(classOf(out, "navbar-section")).toBe("flex flex-col gap-1");
  });

  it("emits the rail placement class string for each of the four placements", async () => {
    const placements: NavPlacement[] = ["top", "bottom", "left", "right"];
    const classes = await Promise.all(
      placements.map(async (placement) => {
        const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' placement={placement} />);
        return placement === "top" || placement === "bottom" ? wrapperClass(out) : rootClass(out);
      }),
    );
    expect(classes).toEqual([
      "z-40 sticky inset-x-0 top-0 h-full",
      "z-40 sticky inset-x-0 bottom-0 h-full",
      "group bg-background/95 backdrop-blur z-40 sticky top-0 left-0 max-h-dvh overflow-y-auto",
      "group bg-background/95 backdrop-blur z-40 sticky top-0 right-0 max-h-dvh overflow-y-auto",
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
    expect(out).toBe(DRAWER_TOP_A);
  });

  it("renders no backdrop at all in the inline default", async () => {
    expect(await render(<Navbar config={A} resolveHref={id} icon={icon} />)).toBe(SINGLE_A);
  });

  it("drops the bar's own backdrop-filter below md, which would otherwise contain the fixed panel", async () => {
    const bar = (html: string) => (/<details data-slot="navbar" data-side="[^"]*" class="([^"]*)"/.exec(html)?.[1] ?? "").split(" ");
    expect(bar(await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />))).toEqual([
      "group",
      "bg-background/95",
      "backdrop-blur",
      "max-md:bg-transparent",
      "max-md:backdrop-blur-none",
    ]);
  });

  it("releases the rail's own scroll box too, which would otherwise clip the panel that left the flow", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible='always' collapsedAs='drawer' />);
    const bar = (/<details data-slot="navbar" data-side="[^"]*" class="([^"]*)"/.exec(out)?.[1] ?? "").split(" ");
    expect(bar).toContain("max-md:max-h-none");
    expect(bar).toContain("max-md:overflow-visible");
  });

  it("hides the closed panel by visibility rather than display, and times its slide or fade on the shared motion tokens", async () => {
    const panel = panelClass(await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />));
    expect(panel).toEqual([
      "flex-col",
      "justify-between",
      "gap-4",
      "p-2",
      "md:flex",
      "md:flex-row",
      "md:items-center",
      "md:h-(--forge-navbar-row)",
      "max-md:invisible",
      "max-md:fixed",
      "max-md:inset-y-0",
      "max-md:z-40",
      "max-md:flex",
      "max-md:w-72",
      "max-md:max-w-[85vw]",
      "max-md:flex-col",
      "max-md:overflow-y-auto",
      "max-md:border-border",
      "max-md:bg-background",
      "max-md:p-4",
      "max-md:shadow-xl",
      "max-md:transition-[translate,opacity,visibility]",
      "max-md:duration-(--forge-motion-exit)",
      "max-md:ease-out",
      "max-md:group-open:visible",
      "max-md:group-open:transition-[translate,opacity]",
      "max-md:group-open:duration-(--forge-motion-enter)",
      "motion-safe:max-md:group-open:translate-x-0",
      "motion-reduce:max-md:opacity-0",
      "motion-reduce:max-md:group-open:opacity-100",
      "max-md:start-0",
      "max-md:border-e",
      "motion-safe:max-md:-translate-x-full",
      "motion-safe:max-md:rtl:translate-x-full",
      "max-md:pt-(--forge-navbar-row)",
    ]);
    expect(panel).not.toContain("motion-reduce:max-md:transition-none");
    expect(panel).toContain("motion-reduce:max-md:opacity-0");
    expect(panel).toContain("max-md:duration-(--forge-motion-exit)");
    expect(panel).toContain("max-md:group-open:duration-(--forge-motion-enter)");
  });

  it("times the backdrop on the same motion tokens, with no reduced-motion cut", async () => {
    const backdrop = classOf(await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />), "navbar-backdrop").split(" ");
    expect(backdrop).toContain("max-md:duration-(--forge-motion-exit)");
    expect(backdrop).toContain("max-md:group-open:duration-(--forge-motion-enter)");
    expect(backdrop.filter((token) => token.endsWith("transition-none"))).toEqual([]);
  });

  it("derives the edge from placement, mirroring both the offset and the transform under rtl", async () => {
    const edgeOf = async (placement: NavPlacement) =>
      panelClass(await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' placement={placement} />)).filter((token) =>
        /^(?:motion-safe:)?max-md:(?:start-0|end-0|border-e|border-s|-?translate-x-full|rtl:-?translate-x-full)$/.test(token),
      );
    const leading = ["max-md:start-0", "max-md:border-e", "motion-safe:max-md:-translate-x-full", "motion-safe:max-md:rtl:translate-x-full"];
    const trailing = ["max-md:end-0", "max-md:border-s", "motion-safe:max-md:translate-x-full", "motion-safe:max-md:rtl:-translate-x-full"];

    expect(await edgeOf("top")).toEqual(leading);
    expect(await edgeOf("left")).toEqual(leading);
    expect(await edgeOf("right")).toEqual(trailing);
    expect(await edgeOf("bottom")).toEqual(trailing);
  });

  it("lets drawerEdge override the edge placement derives, either way, mirroring both the offset and the transform under rtl", async () => {
    const edgeOf = async (placement: NavPlacement, drawerEdge: NavDrawerEdge) =>
      panelClass(
        await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' placement={placement} drawerEdge={drawerEdge} />),
      ).filter((token) => /^(?:motion-safe:)?max-md:(?:start-0|end-0|border-e|border-s|-?translate-x-full|rtl:-?translate-x-full)$/.test(token));

    expect(await edgeOf("top", "trailing")).toEqual([
      "max-md:end-0",
      "max-md:border-s",
      "motion-safe:max-md:translate-x-full",
      "motion-safe:max-md:rtl:-translate-x-full",
    ]);
    expect(await edgeOf("right", "leading")).toEqual([
      "max-md:start-0",
      "max-md:border-e",
      "motion-safe:max-md:-translate-x-full",
      "motion-safe:max-md:rtl:translate-x-full",
    ]);
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

  it("refuses drawerEdge on a rail, whose toggle stays on the edge placement names at every width", async () => {
    const out = await render(
      // @ts-expect-error — a rail's glyph pair would point away from its desktop edge
      <Navbar config={A} resolveHref={id} icon={icon} collapsible='always' collapsedAs='drawer' placement='left' drawerEdge='trailing' />,
    );

    expect(out).not.toContain("-scale-x-100 rtl:scale-x-100");
  });

  it("keeps drawerEdge off the rendered bar, which carries no attribute it would not carry without one", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' drawerEdge='trailing' />);
    const details = /<details ([^>]*)>/.exec(out)?.[1] ?? "";

    expect([...details.matchAll(/([\w-]+)(?:="[^"]*")?/g)].map(([, name]) => name)).toEqual([
      "data-slot",
      "data-side",
      "class",
      "data-navbar-drawer",
    ]);
  });

  it("leaves a hamburger toggle's glyph spans free of any mirroring class, drawer or not", async () => {
    const glyphSpans = (html: string) => [...html.matchAll(/<span class="([^"]*)" aria-hidden="true">/g)].map(([, cls]) => cls);

    for (const node of [
      <Navbar config={A} resolveHref={id} icon={icon} />,
      <Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />,
      <Navbar config={A} resolveHref={id} icon={icon} collapsible='always' />,
    ]) {
      const out = await render(node);
      expect(glyphSpans(out)).toEqual(["group-open:hidden", "hidden group-open:inline"]);
    }
  });

  it("lifts the toggle above the backdrop, which is what keeps the drawer dismissable with no JavaScript", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} collapsedAs='drawer' />);
    const toggle = classOf(out, "navbar-toggle").split(" ");
    expect(toggle).toContain("max-md:relative");
    expect(toggle).toContain("max-md:z-50");
  });

  it("clears the open panel of the toggle on the edge the toggle sits at, a side rail's being the top", async () => {
    const clearance = await Promise.all(
      (["mobile", "always"] as const).flatMap((collapsible) =>
        (["top", "bottom", "left", "right"] as const).map(async (placement) => [
          `${collapsible} ${placement}`,
          panelClass(
            await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible={collapsible} placement={placement} collapsedAs='drawer' />),
          ).filter((token) => /^max-md:p[tb]-/.test(token)),
        ]),
      ),
    );

    expect(Object.fromEntries(clearance)).toEqual({
      "mobile top": ["max-md:pt-(--forge-navbar-row)"],
      "mobile bottom": ["max-md:pb-(--forge-navbar-row)"],
      "mobile left": ["max-md:pt-(--forge-navbar-row)"],
      "mobile right": ["max-md:pb-(--forge-navbar-row)"],
      "always top": ["max-md:pt-(--forge-navbar-row)"],
      "always bottom": ["max-md:pb-(--forge-navbar-row)"],
      "always left": ["max-md:pt-(--forge-navbar-row)"],
      "always right": ["max-md:pt-(--forge-navbar-row)"],
    });
  });

  it("sizes every drawer toggle from the height token below md, and lifts it above the backdrop at every placement", async () => {
    const toggles = Object.fromEntries(
      await Promise.all(
        (["mobile", "always"] as const).flatMap((collapsible) =>
          (["top", "bottom", "left", "right"] as const).map(async (placement): Promise<[string, string[]]> => [
            `${collapsible} ${placement}`,
            classOf(
              await render(<Navbar config={A} resolveHref={id} icon={icon} collapsible={collapsible} placement={placement} collapsedAs='drawer' />),
              "navbar-toggle",
            ).split(" "),
          ]),
        ),
      ),
    );
    const rows = Object.fromEntries(
      Object.entries(toggles).map(([key, toggle]) => [
        key,
        { height: toggle.includes("max-md:h-(--forge-navbar-row)"), lifted: toggle.includes("max-md:relative") && toggle.includes("max-md:z-50") },
      ]),
    );

    expect(rows).toEqual({
      "mobile top": { height: true, lifted: true },
      "mobile bottom": { height: true, lifted: true },
      "mobile left": { height: true, lifted: true },
      "mobile right": { height: true, lifted: true },
      "always top": { height: true, lifted: true },
      "always bottom": { height: true, lifted: true },
      "always left": { height: true, lifted: true },
      "always right": { height: true, lifted: true },
    });
    expect(toggles["always left"]).not.toContain("h-(--forge-navbar-row)");
    expect(toggles["always right"]).not.toContain("h-(--forge-navbar-row)");
  });

  it("sizes no row from the raw height token, at any placement, collapsible or collapsedAs", async () => {
    const raw = await Promise.all(
      (["mobile", "always"] as const).flatMap((collapsible) =>
        (["top", "bottom", "left", "right"] as const).flatMap((placement) =>
          (["drawer", undefined] as const).map(async (collapsedAs) => {
            const out = await render(
              <Navbar config={A} resolveHref={id} icon={icon} collapsible={collapsible} placement={placement} collapsedAs={collapsedAs} />,
            );
            return [...out.matchAll(/ class="([^"]*)"/g)]
              .flatMap((match) => (match[1] ?? "").split(" "))
              .filter((token) => token.endsWith("(--forge-navbar-height)"))
              .map((token) => `${collapsible} ${placement} ${collapsedAs ?? "inline"}: ${token}`);
          }),
        ),
      ),
    );

    expect(raw.flat()).toEqual([]);
  });
});

describe("Navbar — a horizontal bar sizes its row from the height token", () => {
  const A: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };
  const placements: NavPlacement[] = ["top", "bottom", "left", "right"];

  const tokensOf = (cls: string) => cls.split(" ");
  const panelClass = (html: string) => /<\/summary><div class="([^"]*)"/.exec(html)?.[1] ?? "";
  const classOf = (html: string, slot: string) => new RegExp(`data-slot="${slot}"[^>]*? class="([^"]*)"`).exec(html)?.[1] ?? "";

  it("stamps its placement on the disclosure as data-side, for each of the four placements", async () => {
    const sides = await Promise.all(
      placements.map(async (placement) =>
        attrOf(await render(<Navbar config={A} resolveHref={id} icon={icon} placement={placement} />), "data-side", 'data-slot="navbar"'),
      ),
    );

    expect(sides).toEqual(["top", "bottom", "left", "right"]);
  });

  it("gives every phone bar's toggle the token's height, and only a top or bottom bar's desktop panel", async () => {
    const rows = await Promise.all(
      placements.map(async (placement) => {
        const out = await render(<Navbar config={A} resolveHref={id} icon={icon} placement={placement} collapsible='mobile' />);
        return {
          placement,
          toggle: tokensOf(classOf(out, "navbar-toggle")).includes("h-(--forge-navbar-row)"),
          panel: tokensOf(panelClass(out)).includes("md:h-(--forge-navbar-row)"),
        };
      }),
    );

    expect(rows).toEqual([
      { placement: "top", toggle: true, panel: true },
      { placement: "bottom", toggle: true, panel: true },
      { placement: "left", toggle: true, panel: false },
      { placement: "right", toggle: true, panel: false },
    ]);
  });

  it("names the block edge a left or right phone bar pins to as data-narrow-edge, and no edge on a top or bottom bar or a rail", async () => {
    const edges = await Promise.all(
      placements.flatMap((placement) =>
        Object.entries({
          "mobile inline": <Navbar config={A} resolveHref={id} icon={icon} placement={placement} collapsible='mobile' />,
          "mobile drawer": <Navbar config={A} resolveHref={id} icon={icon} placement={placement} collapsible='mobile' collapsedAs='drawer' />,
          "always inline": <Navbar config={A} resolveHref={id} icon={icon} placement={placement} collapsible='always' />,
          "always drawer": <Navbar config={A} resolveHref={id} icon={icon} placement={placement} collapsible='always' collapsedAs='drawer' />,
        }).map(async ([mode, node]) => [`${mode} ${placement}`, attrsOf(await render(node), 'data-slot="navbar"')["data-narrow-edge"] ?? null]),
      ),
    );

    expect(Object.fromEntries(edges)).toEqual({
      "mobile inline top": null,
      "mobile inline bottom": null,
      "mobile inline left": "top",
      "mobile inline right": "bottom",
      "mobile drawer top": null,
      "mobile drawer bottom": null,
      "mobile drawer left": "top",
      "mobile drawer right": "bottom",
      "always inline top": null,
      "always inline bottom": null,
      "always inline left": null,
      "always inline right": null,
      "always drawer top": null,
      "always drawer bottom": null,
      "always drawer left": null,
      "always drawer right": null,
    });
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
  });
});

describe("Navbar — the scope name is the contract", () => {
  const A: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };

  it("stamps the constant the client scope registers, not a literal beside it", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} />);
    expect(/<div data-scope="([^"]*)"/.exec(out)?.[1]).toBe(NAVBAR_SCOPE);
  });
});

describe("Navbar — the scope's action is typed", () => {
  it("refuses a misspelt action in the markup and in the handler table the client registers", () => {
    // @ts-expect-error — "closeNva" is not a NavbarAction
    const attrs = scopeAttrs<NavbarAction>({ onClick: "closeNva" });
    // @ts-expect-error — the scope's handler table is keyed by NavbarAction
    const on: ScopeDefinition<NavbarAction>["on"] = { closeNva: () => {} };

    expect({ attrs, handlers: Object.keys(on ?? {}) }).toEqual({ attrs: { "data-on-click": "closeNva" }, handlers: ["closeNva"] });
  });
});

describe("Navbar — toggleLabel", () => {
  const A: NavDefinition = { sections: [{ items: [{ label: "A", href: "a" }] }] };

  it("names the collapse toggle from the prop, replacing the English forge falls back to", async () => {
    const given = await render(<Navbar config={A} resolveHref={id} icon={icon} toggleLabel='Menú' />);
    const shipped = await render(<Navbar config={A} resolveHref={id} icon={icon} />);

    expect(attrOf(given, "aria-label", 'data-slot="navbar-toggle"')).toBe("Menú");
    expect(attrOf(shipped, "aria-label", 'data-slot="navbar-toggle"')).toBe(LABEL_DEFAULTS.navbarToggle);
  });

  it("keeps the prop off the disclosure, which is not what it names", async () => {
    const out = await render(<Navbar config={A} resolveHref={id} icon={icon} toggleLabel='Menú' />);

    expect(attrOf(out, "togglelabel", 'data-slot="navbar"')).toBe("");
  });
});
