/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
// biome-ignore lint/style/noRestrictedImports: the published surface is what is being asserted
import * as core from "../core/mod";
import { SECTIONS, ShowcaseContent } from "./components";
import { showcasePaths } from "./route";

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
    expect(groups).toBe(bands.size);
    expect(out).toContain('aria-label="Component catalog"');
  });

  it("links every catalog entry from the rail", async () => {
    const out = await page();
    const unlinked = SECTIONS.filter((section) => !out.includes(`href="#${section.id}"`)).map((section) => section.id);
    expect(unlinked).toEqual([]);
  });

  it("sizes the rail on the flex item, not on the navbar inside it", async () => {
    const out = await page();
    const scopeRoot = out.match(/<div data-scope="show-toc"[^>]*>/)?.[0];
    expect(scopeRoot).toBe(
      '<div data-scope="show-toc" class="w-64 shrink-0 border-r border-border has-[[data-slot~=navbar]:not([open])]:w-auto has-[[data-slot~=navbar]:not([open])]:self-start has-[[data-slot~=navbar]:not([open])]:border-r-0">',
    );

    const navbarTag = out.match(/<[a-z]+[^>]*\sid="showcase-toc"[^>]*>/)?.[0];
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
    expect(out).toContain('id="flash-container"');
  });
});

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

const COMPONENT_EXPORTS = Object.entries(core)
  .filter(([name, value]) => /^[A-Z]/.test(name) && typeof value === "function")
  .map(([name]) => name)
  .sort();

describe("ui/show is the complete demo estate", () => {
  const ids = new Set(SECTIONS.map((section) => section.id));

  it("finds every component exported from core/mod.ts", () => {
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
    expect(unrendered).toEqual([]);
  });
});
