/** The gate's exemptions — every escape a check offers, each with the reason it exists. */

// `src/crypto/mod.ts` is a barrel of `@internal` symbols only: the namespace is reached through the
// namespaces that wrap it, never imported by a consumer, so it is deliberately unpublished.
/** Barrels intentionally absent from the exports map. */
export const SEALED_INTERNAL: readonly string[] = ["src/crypto/mod.ts"];

// Not `@source`-scanned either, and for the same reason: half the corpus's samples are
// counter-examples quoting the exact tokens and classes it teaches against, so a check that reads
// every literal would report the corpus for teaching.
/** The design corpus, excluded from every check that judges class literals. */
export const DESIGN_CORPUS_EXCLUDED = "!src/ui/design";

// Each pins `cn`'s own resolution or the class-order check's own detection, so its fixtures are
// deliberately self-conflicting literals — the very input the rule forbids everywhere else.
/** Specs whose fixtures must stay self-conflicting, excluded from the class-order check. */
export const CN_FIXTURE_SPECS: readonly string[] = [
  "!src/tooling/gate/checks/class-order.test.ts",
  "!src/tooling/gate/checks/design-parse.test.ts",
  "!src/tooling/gate/checks/source-scan.test.ts",
  "!src/ui/core/form.test.tsx",
];

// Empty, and expected to stay so: a subpath under a `client` segment is derived browser-only, and
// the check fails an entry that only restates the convention. This is for one that is browser-only
// under another name.
/** Subpaths withheld from the runtime import beyond the ones the `client` segment derives. */
export const BROWSER_ONLY: readonly string[] = [];

// A `types.ts` and a `bin.ts` need no entry: the co-location check derives both from the filename
// and re-checks the claim, failing either one that grows a callable export.
/** Modules exempt from needing a co-located test, each mapped to why. */
export const CO_LOCATION_EXEMPT: ReadonlyMap<string, string> = new Map([
  ["src/ui/contracts/bind-contract.ts", "its one function is covered where it is used, by `client/bind-display.test.ts`"],
  ["src/ui/contracts/alert-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/composite-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/dialog-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/island-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/navbar-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/number-field-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/overlay-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/scope-events.ts", "declared event names — the controllers that dispatch them are tested"],
  ["src/ui/contracts/slider-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/tabs-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/theme-toggle-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/theme/contrast-accepted.ts", "a declared table of accepted pairs, read by the contrast check"],
  ["src/ui/contracts/theme/contrast-pairs.ts", "a declared table of pairs and criteria, read by the contrast check"],
  ["src/ui/contracts/toast-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/toggle-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/toolbar-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/turnstile-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/show/coverage-missing.ts", "a declared list, held against the tree by the design checks"],
  ["src/ui/design/catalog-missing.ts", "a declared list, held against the tree by the design checks"],
  ["src/ui/show/lazy-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/show/scope-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/show/toast-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/client/browser-test-helper.ts", "test infrastructure — it is the thing the browser specs test with"],
  ["src/ui/client/test-dom.ts", "test infrastructure — it is the thing the unit specs test with"],
  ["src/ui/client/htmx.ts", "a vendor side-effect import with no forge surface of its own"],
  ["src/tooling/lint/test-support.ts", "test infrastructure — it is the thing the lint-rule specs test with"],
  ["src/test-setup.ts", "the preload that every spec runs under; it has no behaviour to assert"],
  ["src/tooling/lint/data/design-scale.ts", "generated from the stylesheet, and `designScaleStep` holds it against the source"],
  ["src/form/constants.ts", "declared data — the parsers that read the constants are tested"],
  ["src/auth/config.ts", "the declared algorithm list — the ceremony builders and the capability probe that read it are tested"],
  ["src/auth/web/resolve.golden.ts", "the recorded render of every auth page — test data, and `resolve.test.tsx` is what reads it"],
  ["src/testing/workerd.ts", "test infrastructure — `tests/workerd/`'s specs are what exercise it, in the `full` tier"],
]);
