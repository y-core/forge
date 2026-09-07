/** Pre-built steps for the checks forge ships, so a project names the ones it wants instead of
 *  writing a spawnable file per check. Labels are fixed: they are the `--only` tokens.
 */

import { type AssetManifestCheckConfig, checkAssetManifest } from "./checks/asset-manifest";
import { type AssetRootCheckConfig, checkAssetRoot } from "./checks/asset-root";
import { hasChromium } from "./checks/browser";
import { type BuildTimeBoundaryCheckConfig, checkBuildTimeBoundary } from "./checks/build-time-boundary";
import { type ChangelogCheckConfig, checkChangelog } from "./checks/changelog";
import { type ClassGroupsCheckConfig, checkClassGroups } from "./checks/class-groups";
import { checkClassOrder, type ClassOrderCheckConfig } from "./checks/class-order";
import { checkClassTokens, type ClassTokensCheckConfig } from "./checks/class-tokens";
import { type CoLocationCheckConfig, checkCoLocation } from "./checks/co-location";
import { type ContrastCheckConfig, checkContrast } from "./checks/contrast";
import { type CssSourcesCheckConfig, checkCssSources } from "./checks/css-sources";
import { type CssTokensCheckConfig, checkCssTokens } from "./checks/css-tokens";
import { checkDesign, type DesignCheckConfig } from "./checks/design";
import { checkDesignScale, type DesignScaleCheckConfig } from "./checks/design-scale";
import { hasTailwind } from "./checks/design-system";
import { checkDocs, type DocsCheckConfig } from "./checks/docs";
import { checkExports, type ExportsCheckConfig } from "./checks/exports";
import { checkJsx, type JsxCheckConfig } from "./checks/jsx";
import { checkLintPlugin, hasEsbuild, type LintPluginCheckConfig } from "./checks/lint-plugin";
import { checkModernCss, type ModernCssCheckConfig } from "./checks/modern-css";
import { checkNamespaceGraph, type NamespaceGraphCheckConfig } from "./checks/namespace-graph";
import { checkReadmeExports, type ReadmeExportsCheckConfig } from "./checks/readme-exports";
import { checkSsrBoundary, type SsrBoundaryCheckConfig } from "./checks/ssr-boundary";
import type { CheckStep, CommandStep, GateMode, StepRequirement } from "./steps";

/** Overrides every pre-built step accepts; each builder documents the default it applies. @public */
export interface StepOptions {
  /** The lowest mode the step runs in. */
  tier?: GateMode;
  /** Replaces the step's default dependency; `null` drops it, so a project that vendors one is not gated on probing it. */
  requires?: StepRequirement | null;
}

/** Sources a tool step is pointed at. @public */
export interface SourceStepOptions extends StepOptions {
  /** Paths passed to the tool, relative to the runner's `cwd`. */
  sources?: readonly string[];
}

// The key is omitted when the value is the default, so a table reads as the tiers it departs from.
function tier(value: GateMode | undefined, fallback: GateMode = "fast"): { tier: GateMode } | Record<string, never> {
  const resolved = value ?? fallback;
  return resolved === "fast" ? {} : { tier: resolved };
}

function prerequisite(
  override: StepRequirement | null | undefined,
  fallback?: StepRequirement,
): { requires: StepRequirement } | Record<string, never> {
  const resolved = override === undefined ? fallback : (override ?? undefined);
  return resolved === undefined ? {} : { requires: resolved };
}

function checkStep(
  label: string,
  run: CheckStep["run"],
  options: StepOptions,
  defaults: { tier?: GateMode; requires?: StepRequirement } = {},
): CheckStep {
  return { label, run, ...tier(options.tier, defaults.tier), ...prerequisite(options.requires, defaults.requires) };
}

/** `tsc --noEmit`. Belongs first in a table: a type failure cascades into misleading lint and test failures. @public */
export function typecheckStep(options: StepOptions = {}): CommandStep {
  return { label: "typecheck", tail: 20, cmd: ["tsc", "--noEmit"], ...tier(options.tier) };
}

/** `oxlint` over `sources` (default `src/`), with `--fix` as its fixer. @public */
export function lintStep(options: SourceStepOptions = {}): CommandStep {
  const sources = options.sources ?? ["src/"];
  return {
    label: "lint",
    tail: 20,
    // oxlint exits 0 on `warn`, so without this a green gate would not mean a clean tree.
    cmd: ["oxlint", "--deny-warnings", ...sources],
    fix: ["oxlint", "--fix", ...sources],
    ...tier(options.tier),
  };
}

/** `oxfmt --check` over `sources` (default `src/`), with a bare `oxfmt` run as its fixer. Ordered after `lintStep` so the formatter owns the final byte layout. @public */
export function formatStep(options: SourceStepOptions = {}): CommandStep {
  const sources = options.sources ?? ["src/"];
  return { label: "format", tail: 20, cmd: ["oxfmt", "--check", ...sources], fix: ["oxfmt", ...sources], ...tier(options.tier) };
}

/** `oxlint --type-aware` over `sources` (default `src/`); defaults to `standard`: it builds its own TypeScript program, so it is too slow for the inner loop. @public */
export function typeAwareLintStep(options: SourceStepOptions = {}): CommandStep {
  const sources = options.sources ?? ["src/"];
  return {
    label: "lint:types",
    tail: 40,
    // The unused-directive check rides here, not on `lint`: this run is a superset, so it is the only
    // one that can tell a stale directive from one that only a type-aware rule redeems.
    cmd: ["oxlint", "--type-aware", "--deny-warnings", "--report-unused-disable-directives-severity", "error", ...sources],
    ...tier(options.tier, "standard"),
  };
}

/** `bun test` over `sources`, or the whole project when none are named. @public */
export function testStep(options: SourceStepOptions = {}): CommandStep {
  return { label: "test", tail: 120, cmd: ["bun", "test", ...(options.sources ?? [])], ...tier(options.tier) };
}

/** `playwright test` under bun, defaulting to the `full` tier: it needs a downloaded browser. @public */
export function browserStep(options: { hint?: string } & StepOptions = {}): CommandStep {
  return {
    label: "test:browser",
    // Defaults to `full` — it needs a downloaded browser — but the caller may state it, so the
    // step table can be read for which steps run in which mode without opening this file.
    ...tier(options.tier, "full"),
    tail: 120,
    // Under bun, not node: forge ships raw TypeScript, and node refuses to strip types from a file
    // under `node_modules` — so a consumer's `playwright.config.ts` importing any forge subpath
    // dies at config load with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.
    cmd: ["bunx", "--bun", "playwright", "test"],
    // The probe targets the browser, not the `playwright` CLI: the CLI is a devDependency and always
    // present, so probing it would pass vacuously and let every spec fail at launch. The remedy names
    // both routes because the reader is, by definition, outside a devbox container — every image there
    // bakes Chromium, so the probe cannot fail in one. A direct command, not a package script, so
    // nothing has to be defined for it to work.
    ...prerequisite(options.requires, {
      tool: "chromium",
      probe: hasChromium,
      hint: options.hint ?? "run `bunx playwright install chromium`, or use a devbox container — `devctl up`",
    }),
  };
}

/** Audits the `exports` map against what is on disk and what is published. @public */
export function exportsStep(config: ExportsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-exports", () => checkExports(config), options);
}

/** Diffs the observed cross-namespace imports against the declared graph. @public */
export function namespaceGraphStep(config: NamespaceGraphCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-namespace-graph", () => checkNamespaceGraph(config), options);
}

/** Diffs the files the assets pipeline writes to the asset root against the `run_worker_first` exclusions. @public */
export function assetRootStep(config: AssetRootCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-asset-root", () => checkAssetRoot(config), options);
}

/** Checks every path the emitted assets manifest maps to exists under the served asset directory. @public */
export function assetManifestStep(config: AssetManifestCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-asset-manifest", (gateMode) => checkAssetManifest(config, gateMode), options);
}

/** Checks every source module has a test beside it, so deleting one is loud rather than silent. @public */
export function coLocationStep(config: CoLocationCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-co-location", () => checkCoLocation(config), options);
}

/** Checks that no server-rendered file imports the browser-only runtime. Runs in every mode: the
 *  namespace graph declares this edge once for a whole namespace, so only a file-granular check can
 *  tell the one registration entry point apart from a component that would throw in a Worker. @public */
export function ssrBoundaryStep(config: SsrBoundaryCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-ssr-boundary", () => checkSsrBoundary(config), options);
}

/** Checks that nothing a consumer can import at runtime reaches a build-time directory. @public */
export function buildTimeBoundaryStep(config: BuildTimeBoundaryCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-build-time-boundary", () => checkBuildTimeBoundary(config), options);
}

/** Checks every shipped `.tsx` file carries the runtime pragmas. @public */
export function jsxStep(config: JsxCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-jsx", () => checkJsx(config), options);
}

/** Checks the governing documents against the subpaths they are required to cite. @public */
export function docsStep(config: DocsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-docs", () => checkDocs(config), options);
}

/** Checks a README's per-subpath export tables against the barrels they document. @public */
export function readmeExportsStep(config: ReadmeExportsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-readme-exports", () => checkReadmeExports(config), options);
}

/** Checks the changelog's headings against the current package version. Defaults to the `full` tier:
 *  requiring a written `[Unreleased]` entry on every inner loop would fail every WIP commit. @public */
export function changelogStep(config: ChangelogCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-changelog", () => checkChangelog(config), options, { tier: "full" });
}

/** Checks the design corpus against the tree it governs. @public */
export function designStep(config: DesignCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-design", () => checkDesign(config), options);
}

/** The dependency every design-system step shares — `tailwindcss` is an optional peer, skipped below
 *  the `full` tier and failed by it. */
const tailwindRequired = (): StepRequirement => ({ tool: "tailwindcss", probe: hasTailwind, hint: "run `bun add -d tailwindcss`" });

/** Measures every audited foreground/background pair against its contrast criterion. @public */
export function contrastStep(config: ContrastCheckConfig, options: StepOptions = {}): CheckStep {
  // The dependency rides on the palette: a project pointing `palettePath` elsewhere is not gated on tailwind.
  const defaults = config.palettePath === undefined ? {} : { requires: tailwindRequired() };
  return checkStep("validate-contrast", () => checkContrast(config), options, defaults);
}

/** Regenerates `cn`'s conflict table from the design system and fails on any drift from the committed
 *  copy. @public */
export function classGroupsStep(config: ClassGroupsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-class-groups", () => checkClassGroups(config), options, { requires: tailwindRequired() });
}

/** Regenerates the design-scale data forge's oxlint plugin reads and fails on any drift from the
 *  committed copy. Separate from `classGroupsStep`: the two files drift independently, and a reader
 *  has to be told which one did. @public */
export function designScaleStep(config: DesignScaleCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-design-scale", () => checkDesignScale(config), options, { requires: tailwindRequired() });
}

/** Rebuilds the committed oxlint-plugin bundle and fails on any drift from its TypeScript source.
 *  A consumer loads that bundle rather than the source, because node refuses to strip types under
 *  `node_modules`. @public */
export function lintPluginStep(config: LintPluginCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-lint-plugin", () => checkLintPlugin(config), options, {
    requires: { tool: "esbuild", probe: hasEsbuild, hint: "run `bun add -d esbuild`" },
  });
}

/** Checks every class literal is a fixed point of `cn`, so sorting one cannot change what it renders. @public */
export function classOrderStep(config: ClassOrderCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-class-order", () => checkClassOrder(config), options);
}

/** Checks every class token resolves to CSS, so a misspelled utility fails rather than rendering nothing. @public */
export function classTokensStep(config: ClassTokensCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-class-tokens", () => checkClassTokens(config), options, { requires: tailwindRequired() });
}

/** Checks stylesheets and class literals for patterns the platform now expresses directly. @public */
export function modernCssStep(config: ModernCssCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-modern-css", () => checkModernCss(config), options);
}

/** Checks every class-bearing directory is reached by an `@source` directive. @public */
export function cssSourcesStep(config: CssSourcesCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-css-sources", () => checkCssSources(config), options);
}

/** Checks no `@theme` token is declared in a namespace the utility vocabulary overloads. @public */
export function cssTokensStep(config: CssTokensCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-css-tokens", () => checkCssTokens(config), options, { requires: tailwindRequired() });
}
