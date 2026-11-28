/** The gate's exemptions — every escape a check offers, each with the reason it exists. */

/** Barrels intentionally absent from the exports map. */
export const SEALED_INTERNAL: readonly string[] = ["src/crypto/primitives/mod.ts"];

/** The design corpus, excluded from every check that judges class literals. */
export const DESIGN_CORPUS_EXCLUDED = "!src/ui/design";

/** Specs whose fixtures must stay self-conflicting, excluded from the class-order check. */
export const CN_FIXTURE_SPECS: readonly string[] = [
  "!src/tooling/gate/checks/class-order.test.ts",
  "!src/tooling/gate/checks/design-parse.test.ts",
  "!src/tooling/gate/checks/source-scan.test.ts",
  "!src/ui/core/form.test.tsx",
];

/** Sources outside `src/tooling` allowed to import it at value, each off every Worker path: `testing/d1` and `testing/d1/bun` load the host config and split migrations as `forge db` does, and `testing/harness` arms a build as `forge cf dev` does. */
export const TOOLING_CROSSINGS: readonly string[] = ["src/testing/d1/bun.ts", "src/testing/d1/migrations.ts", "src/testing/harness.ts"];

/** Subpaths withheld from the runtime import beyond the ones the `client` segment derives. */
export const BROWSER_ONLY: readonly string[] = [];

/** Modules whose leading `//` run is an upstream licence notice, each mapped to the attribution it carries. */
export const LICENCE_HEADERS: ReadonlyMap<string, string> = new Map([
  ["src/tooling/cli/tokenize.ts", "@visulima/command-line-args (MIT), itself after args-tokens (MIT)"],
  ["src/tooling/term/capability.ts", "@visulima/is-ansi-color-supported (MIT), itself after chalk/supports-color (MIT)"],
  ["src/tooling/term/codes.ts", "@visulima/colorize (MIT), itself after ansis (ISC), plus color-convert (MIT)"],
  ["src/tooling/term/color.ts", "@visulima/colorize (MIT), itself after ansis (ISC)"],
  ["src/render/markdown/entities.ts", "character-entities 2.0.2 (MIT)"],
  ["src/render/pdf/icc.ts", "sRGB2014.icc — International Color Consortium, redistributable without restriction"],
]);

/** Modules exempt from needing a co-located test, each mapped to why. */
export const CO_LOCATION_EXEMPT: ReadonlyMap<string, string> = new Map([
  ["src/ui/design/rules.ts", "declared register entries — `validate-rules` holds each one to its marker, and sweeps its rg examples"],
  ["src/ui/contracts/alert-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/announcer-contract.ts", "declared contract constants — the markup and the controller that use them are tested"],
  ["src/ui/contracts/composite-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/dialog-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/htmx-contract.ts", "declared contract constants — the extension and the browser spec that use them are tested"],
  ["src/ui/contracts/island-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/navbar-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/number-field-contract.ts", "declared contract constants — the markup that uses them is tested"],
  ["src/ui/contracts/otp-input-contract.ts", "declared contract constants — the markup and the controller that use them are tested"],
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
  ["src/test-setup.ts", "the preload that every spec runs under; it has no behaviour to assert"],
  ["src/tooling/lint/data/design-scale.ts", "generated from the stylesheet, and `designScaleStep` holds it against the source"],
  ["src/form/constants.ts", "declared data — the parsers that read the constants are tested"],
  ["src/render/markdown/trusted-types.ts", "a declared policy name — the viewport's writes through it are tested in `html.browser.ts`"],
  ["src/auth/config.ts", "the declared algorithm list — the ceremony builders and the capability probe that read it are tested"],
  ["warden/src/cli/flags.ts", "declared flag tables — the command tree that shares them is dispatched in `commands.test.ts`"],
  ["warden/src/rules/canon/shared/CODE_RULES.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/libs/TESTING.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/apps/APP_ARCHITECTURE.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/apps/CODE_REVIEW.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/apps/BOUNDARIES.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/apps/CONFIG_BASELINE.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/apps/ERROR_HANDLING.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/apps/FORGE_CONSUMPTION.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/apps/TESTING.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/apps/WORKERS_PLATFORM.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/libs/BOUNDARIES.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/libs/ERROR_HANDLING.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/libs/LIBRARY_ARCHITECTURE.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/libs/NAMESPACE_DESIGN.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/shared/AGENT_GUIDE.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/rules/canon/shared/AGENT_WORKFLOW.ts", "declared register entries — `validate-rules` holds each to its marker and detectors"],
  ["warden/src/sdk/query-runner.ts", "the child-process entry `runQuery` spawns — every query test in `query.test.ts` runs through it"],
  [
    "warden/claude/skills/shared/handoff/scripts/handoff.ts",
    "a two-line entry point — `handoffScript` is tested in `warden/src/workflow/script.test.ts`",
  ],
  [
    "warden/claude/skills/shared/merge/scripts/merge.ts",
    "a two-line entry point — `mergeScript` is tested in `warden/src/workflow/script.test.ts`",
  ],
  [
    "src/render/markdown/editor/client/theme.ts",
    "a declared CodeMirror theme — the classes it styles are drawn and asserted by `decorations.test.ts` and `mount.browser.ts`",
  ],
  [
    "src/testing/node.d.ts",
    "a declaration file — `typecheck:workers-consumer-node` holds it against `snapshot.ts`, `d1.ts` and `harness.ts`, and `typecheck:testing-stubs-consumer` against the apps' calls",
  ],
  ["src/testing/bun.d.ts", "a declaration file — `typecheck:testing-stubs-consumer` holds it against the apps' `bun:test` and `bun:sqlite` calls"],
]);
