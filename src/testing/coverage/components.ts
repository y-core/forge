// oxlint-disable-next-line eslint/no-restricted-imports -- the expected set is read off the published barrel itself, and validate-namespace-graph forbids the reverse edge
import * as chrome from "../../ui/chrome/mod";
// oxlint-disable-next-line eslint/no-restricted-imports -- the expected set is read off the published barrel itself, and validate-namespace-graph forbids the reverse edge
import * as controls from "../../ui/controls/mod";
// oxlint-disable-next-line eslint/no-restricted-imports -- the expected set is read off the published barrel itself, and validate-namespace-graph forbids the reverse edge
import * as core from "../../ui/core/mod";
// oxlint-disable-next-line eslint/no-restricted-imports -- the expected set is read off the published barrel itself, and validate-namespace-graph forbids the reverse edge
import * as server from "../../ui/server/mod";
import type { CoverageBarrel, CoverageComponent } from "./types";

/** Every capitalised function each given barrel publishes, barrel-qualified and sorted by key. @internal */
export function barrelComponents(
  barrels: Readonly<Partial<Record<CoverageBarrel, Readonly<Record<string, unknown>>>>>,
): readonly CoverageComponent[] {
  const found = (Object.entries(barrels) as [CoverageBarrel, Readonly<Record<string, unknown>>][]).flatMap(([barrel, exports]) =>
    Object.entries(exports)
      .filter(([name, value]) => /^[A-Z]/.test(name) && typeof value === "function")
      .map(([component]): CoverageComponent => Object.freeze({ barrel, component, key: `${barrel}/${component}` as const })),
  );
  return Object.freeze(found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)));
}

/** The components the core, controls, chrome and server barrels publish — the set a coverage manifest must declare. @public */
export const COVERAGE_COMPONENTS = barrelComponents({ chrome, controls, core, server });
