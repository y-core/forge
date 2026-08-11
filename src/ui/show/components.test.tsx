/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
// The barrel is this test's subject: the property below is that every component the package
// publishes has a showcase section, so it has to read the published surface rather than a hand-kept
// list. The rule guards against circular dependencies, which a leaf test file cannot create.
// biome-ignore lint/style/noRestrictedImports: the published surface is what is being asserted
import * as core from "../core/mod";
import { SECTIONS, ShowcaseContent } from "./components";
import { showcasePaths } from "./route";

// Minimal icon compatible with ForgeIcon<…>; renders nothing.
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const StubIcon = ((_props: any) => null) as any;
StubIcon.sprite = "/icons.svg";
// biome-ignore lint/suspicious/noExplicitAny: test-only stub
const icon = StubIcon as any;

const page = () => render(<ShowcaseContent data={{ paths: showcasePaths("/showcase") }} icon={icon} />);

describe("ShowcaseContent", () => {
  it("renders the showcase page shell without throwing", async () => {
    const out = await page();
    expect(out).toContain('id="main-content"');
    expect(out).toContain("UI Component Showcase");
  });

  it("renders the table of contents as a navbar rail, one group per band", async () => {
    const out = await page();
    const groups = out.split('data-slot="navbar-group"').length - 1;
    const bands = new Set(SECTIONS.map((section) => section.group));
    // The rail is one section holding one group per band; a band that stopped rendering would take
    // its entries off the page with it while every other assertion here still passed.
    expect(groups).toBe(bands.size);
    expect(out).toContain('aria-label="Component catalog"');
  });

  it("links every catalog entry from the rail", async () => {
    const out = await page();
    const unlinked = SECTIONS.filter((section) => !out.includes(`href="#${section.id}"`)).map((section) => section.id);
    // The completeness contract, on the navigation side: a section nothing links to is one nobody
    // reaches, whatever the catalog below says.
    expect(unlinked).toEqual([]);
  });

  it("sizes the rail on the flex item, not on the navbar inside it", async () => {
    const out = await page();
    // The scope root is the flex item, so the rail's width, shrink and border live on its open tag —
    // and so does the collapsed shape, which is width, cross-axis alignment and border together: a
    // closed rail is the toggle's own box and nothing else.
    const scopeRoot = out.match(/<div data-scope="show-toc"[^>]*>/)?.[0];
    expect(scopeRoot).toBe(
      '<div data-scope="show-toc" class="w-64 shrink-0 border-r border-border has-[[data-slot~=navbar]:not([open])]:w-auto has-[[data-slot~=navbar]:not([open])]:self-start has-[[data-slot~=navbar]:not([open])]:border-r-0">',
    );

    // …and not on the navbar, which is a descendant of the box being laid out and sizes nothing.
    const navbarTag = out.match(/<[a-z]+[^>]*\sid="showcase-toc"[^>]*>/)?.[0];
    // Without this the two assertions below would pass vacuously on an empty class list.
    expect(navbarTag).toBeDefined();
    const navbarClasses = navbarTag?.match(/\sclass="([^"]*)"/)?.[1]?.split(/\s+/) ?? [];
    expect(navbarClasses.length).toBeGreaterThan(0);
    expect(navbarClasses).not.toContain("w-64");
    expect(navbarClasses).not.toContain("shrink-0");
  });

  it("includes the static catalog, HTMX demos, theme and resumable sections", async () => {
    const out = await page();
    expect(out).toContain('id="button"');
    expect(out).toContain('id="htmx-demos"');
    expect(out).toContain('id="theme"');
    expect(out).toContain('data-scope="show-filter"');
    // OOB flash sink present so demo toasts have a target.
    expect(out).toContain('id="flash-container"');
  });
});

/**
 * The showcase's completeness property, asserted rather than inspected.
 *
 * The epic's cut posture makes `ui/show` the living demo estate: a primitive with no section is one
 * nobody can look at, and one the cross-cutting corpus cannot drive. Checking that by reading the
 * file is exactly how a demo estate falls behind the library it demonstrates, so the rule is
 * mechanical — a component export is a capitalised binding whose value is a function, and its
 * section id is its own kebab-cased name. Adding a component to `core/mod.ts` without a section
 * fails here, by name.
 */

/** `ToggleGroup` → `toggle-group`, `NumberField` → `number-field`. */
function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** Component exports only — `cn`, `cva`, `fieldId` and the type-only exports are not components. */
const COMPONENT_EXPORTS = Object.entries(core)
  .filter(([name, value]) => /^[A-Z]/.test(name) && typeof value === "function")
  .map(([name]) => name)
  .sort();

describe("ui/show is the complete demo estate", () => {
  const ids = new Set(SECTIONS.map((section) => section.id));

  it("finds every component exported from core/mod.ts", () => {
    // A guard on the guard: were the filter above to stop matching, the property below would pass
    // vacuously and nothing would say so.
    expect(COMPONENT_EXPORTS.length).toBeGreaterThan(30);
    expect(COMPONENT_EXPORTS).toContain("Menu");
    expect(COMPONENT_EXPORTS).toContain("Turnstile");
    expect(COMPONENT_EXPORTS).not.toContain("createIcon");
  });

  it("gives every exported component its own catalog section", () => {
    const missing = COMPONENT_EXPORTS.filter((name) => !ids.has(kebab(name)));
    expect(missing).toEqual([]);
  });

  it("renders a section element for every catalog entry", async () => {
    const out = await page();
    const unrendered = SECTIONS.filter((section) => !out.includes(`id="${section.id}"`)).map((section) => section.id);
    // The table of contents links to `#id`; an entry with no element is a dead link.
    expect(unrendered).toEqual([]);
  });
});
