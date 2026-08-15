/** @jsxRuntime automatic */
/** @jsxImportSource @y-core/forge/jsx */

import { beforeAll, describe, expect, it } from "bun:test";
import { render } from "../../testing/render";
// biome-ignore lint/style/noRestrictedImports: the published surface is what is being asserted
import * as chrome from "../chrome/mod";
// biome-ignore lint/style/noRestrictedImports: the published surface is what is being asserted
import * as controls from "../controls/mod";
import { createIcon } from "../core/icon";
// biome-ignore lint/style/noRestrictedImports: the published surface is what is being asserted
import * as core from "../core/mod";
// biome-ignore lint/style/noRestrictedImports: the published surface is what is being asserted
import * as server from "../server/mod";
import { PAGE_ORDER, SECTIONS, SHOWCASE_PAGES, ShowcaseContent } from "./components";
import { type CoverageReport, coverageKeys, coverageReport, DEMO_COVERAGE, explainGap, explainStale } from "./coverage";
import { COVERAGE_MISSING } from "./coverage-missing";
import { showcasePaths } from "./route";

// A real sprite binding, not a null stub: a component returning `null` renders no `<use href>`, so
// no glyph marker in the manifest could ever match, and every icon-dependent axis was unmeasurable
// by construction. The seven glyphs are the set `showcase.browser.ts` already binds.
const icon = createIcon("/sprite.svg", {
  "icon-spinner": "0 0 24 24",
  "icon-chevron-down": "0 0 24 24",
  "icon-sun": "0 0 24 24",
  "icon-moon": "0 0 24 24",
  "icon-monitor": "0 0 24 24",
  "icon-hamburger": "0 0 24 24",
  "icon-close": "0 0 24 24",
  // biome-ignore lint/suspicious/noExplicitAny: the catalog's own icon union is wider than this fixture
}) as any;

function componentExports(barrel: Record<string, unknown>): string[] {
  return Object.entries(barrel)
    .filter(([name, value]) => /^[A-Z]/.test(name) && typeof value === "function")
    .map(([name]) => name)
    .sort();
}

const BARRELS = { core, controls, chrome, server } as const;

const excused = new Set(COVERAGE_MISSING.map((gap) => gap.key));

let report: CoverageReport;

beforeAll(async () => {
  // Rendered page by page and merged, never joined: a joined string would let one page's last
  // section body absorb the next page's rail, and the check would pass on markup outside the section.
  const html = await Promise.all(
    PAGE_ORDER.map((page) => render(<ShowcaseContent data={{ paths: showcasePaths("/showcase") }} icon={icon} page={page} />)),
  );
  report = coverageReport({ html, sectionIds: SECTIONS.map((section) => section.id), demos: DEMO_COVERAGE });
});

describe("ui/show demonstrates every published component", () => {
  it("serves every catalog entry from a declared page, and every page some entry", () => {
    const pages = new Set(PAGE_ORDER);
    expect(SECTIONS.filter((section) => !pages.has(section.page)).map((section) => `${section.id} → ${section.page}`)).toEqual([]);
    expect(PAGE_ORDER.filter((page) => !SECTIONS.some((section) => section.page === page))).toEqual([]);
    expect(PAGE_ORDER.filter((page) => SHOWCASE_PAGES[page] === undefined)).toEqual([]);
  });

  it("declares every barrel export in DEMO_COVERAGE", () => {
    const declared = new Set(DEMO_COVERAGE.map((demo) => `${demo.barrel}/${demo.name}`));
    const undeclared = Object.entries(BARRELS).flatMap(([barrel, module]) =>
      componentExports(module)
        .filter((name) => !declared.has(`${barrel}/${name}`))
        .map((name) => `${barrel}/${name}`),
    );
    expect(undeclared).toEqual([]);
  });

  it("leaves no gap that COVERAGE_MISSING does not excuse", () => {
    const unexcused = report.uncovered.filter((key) => !excused.has(key));
    expect(unexcused.map((key) => explainGap(key, DEMO_COVERAGE))).toEqual([]);
  });

  // `coverage-missing.ts` calls `owner` mandatory and non-empty, and nothing checked it — an excuse
  // with no task behind it is an excuse nobody ever comes back to.
  it("requires every excuse to name the task that owes it", () => {
    expect(COVERAGE_MISSING.filter((gap) => gap.owner.trim() === "").map((gap) => gap.key)).toEqual([]);
  });

  it("keeps COVERAGE_MISSING free of stale and unknown excuses", () => {
    const known = new Set(coverageKeys(DEMO_COVERAGE));
    const covered = new Set(report.covered);
    expect([...excused].filter((key) => covered.has(key)).map(explainStale)).toEqual([]);
    expect([...excused].filter((key) => !known.has(key))).toEqual([]);
  });
});
