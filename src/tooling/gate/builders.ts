import { checkAssetManifest } from "./checks/asset-manifest";
import { checkAssetRoot } from "./checks/asset-root";
import { hasChromium } from "./checks/browser";
import { checkBundle, hasEsbuild } from "./checks/bundle";
import { checkClassGroups } from "./checks/class-groups";
import { checkClassOrder } from "./checks/class-order";
import { checkClassTokens } from "./checks/class-tokens";
import { checkCoLocation } from "./checks/co-location";
import { checkCommentBudget } from "./checks/comment-budget";
import { checkCompatibility } from "./checks/compatibility";
import { checkContrast } from "./checks/contrast";
import { checkCssSources } from "./checks/css-sources";
import { checkCssTokens } from "./checks/css-tokens";
import { checkDesignScale } from "./checks/design-scale";
import { hasTailwind } from "./checks/design-system";
import { checkDevBoundary } from "./checks/dev-boundary";
import { checkExports } from "./checks/exports";
import { checkExposure } from "./checks/exposure";
import { checkFeatures } from "./checks/features";
import { checkIccProfile } from "./checks/icc-profile";
import { checkImportBoundary } from "./checks/import-boundary";
import { checkJsx } from "./checks/jsx";
import { checkMarkdown, fixMarkdown } from "./checks/markdown";
import { checkMenuNaming } from "./checks/menu-naming";
import { checkModernCss } from "./checks/modern-css";
import { checkNamespaceGraph } from "./checks/namespace-graph";
import { checkPackaging } from "./checks/packaging";
import { checkSsrBoundary } from "./checks/ssr-boundary";
import type { AssetManifestCheckConfig } from "./checks/types";
import type { AssetRootCheckConfig } from "./checks/types";
import type { BundleCheckConfig, IccProfileCheckConfig } from "./checks/types";
import type { ClassGroupsCheckConfig } from "./checks/types";
import type { ClassOrderCheckConfig } from "./checks/types";
import type { ClassTokensCheckConfig } from "./checks/types";
import type { CoLocationCheckConfig } from "./checks/types";
import type { CommentBudgetCheckConfig } from "./checks/types";
import type { CompatibilityCheckConfig } from "./checks/types";
import type { ContrastCheckConfig } from "./checks/types";
import type { CssSourcesCheckConfig } from "./checks/types";
import type { CssTokensCheckConfig } from "./checks/types";
import type { DesignScaleCheckConfig } from "./checks/types";
import type { DevBoundaryCheckConfig } from "./checks/types";
import type { ExportsCheckConfig } from "./checks/types";
import type { ExposureCheckConfig } from "./checks/types";
import type { ImportBoundaryCheckConfig } from "./checks/types";
import type { JsxCheckConfig } from "./checks/types";
import type { MarkdownCheckConfig } from "./checks/types";
import type { MenuNamingCheckConfig } from "./checks/types";
import type { ModernCssCheckConfig } from "./checks/types";
import type { PackagingCheckConfig } from "./checks/types";
import type { NamespaceGraphCheckConfig } from "./checks/types";
import type { SsrBoundaryCheckConfig } from "./checks/types";
import type { FeaturesCheckConfig } from "./checks/types";
import { hasWorkerd } from "./checks/workerd";
import type { CheckStep, CommandStep, GateMode, StepRequirement } from "./types";
import type { SourceStepOptions, StepOptions } from "./types";

// The key is omitted when the value is the default, so a table reads as the tiers it departs from.
function tier(value: GateMode | undefined, fallback: GateMode = "quality"): { tier: GateMode } | Record<string, never> {
  const resolved = value ?? fallback;
  return resolved === "quality" ? {} : { tier: resolved };
}

function prerequisite(
  override: StepRequirement | null | undefined,
  fallback?: StepRequirement,
): { requires: StepRequirement } | Record<string, never> {
  const resolved = override === undefined ? fallback : (override ?? undefined);
  return resolved === undefined ? {} : { requires: resolved };
}

/** Wraps a check function as a step, applying the tier and prerequisite an option table overrides. @public */
export function checkStep(
  label: string,
  run: CheckStep["run"],
  options: StepOptions,
  defaults: { tier?: GateMode; requires?: StepRequirement; fix?: CheckStep["fix"] } = {},
): CheckStep {
  return {
    label,
    run,
    ...(defaults.fix === undefined ? {} : { fix: defaults.fix }),
    ...tier(options.tier, defaults.tier),
    ...prerequisite(options.requires, defaults.requires),
  };
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

/** `oxlint --type-aware` over `sources` (default `src/`), the slowest row of the `quality` tier at a few seconds. @public */
export function typeAwareLintStep(options: SourceStepOptions = {}): CommandStep {
  const sources = options.sources ?? ["src/"];
  return {
    label: "lint:types",
    tail: 40,
    // The unused-directive check rides here, not on `lint`: this run is a superset, so it is the only
    // one that can tell a stale directive from one that only a type-aware rule redeems.
    cmd: ["oxlint", "--type-aware", "--deny-warnings", "--report-unused-disable-directives-severity", "error", ...sources],
    ...tier(options.tier),
  };
}

/** `bun test` over `sources`, or the whole project when none are named; defaults to `standard`, the tier that runs the code rather than judging it. @public */
export function testStep(options: SourceStepOptions & { label?: string } = {}): CommandStep {
  // `label` is a parameter because a suite split by the question each set answers needs one row per
  // set, and `selectSteps` refuses a duplicate label.
  return { label: options.label ?? "test", tail: 120, cmd: ["bun", "test", ...(options.sources ?? [])], ...tier(options.tier, "standard") };
}

/** `playwright test` under node, defaulting to the `full` tier: it needs a downloaded browser. @public */
export function browserStep(options: { hint?: string } & StepOptions = {}): CommandStep {
  return {
    label: "test:browser",
    // Defaults to `full` — it needs a downloaded browser — but the caller may state it, so the
    // step table can be read for which steps run in which mode without opening this file.
    ...tier(options.tier, "full"),
    tail: 120,
    // The installed binary off `binDir`, never `bunx`, which falls back to installing from the registry.
    // Its shebang is node: under bun a dev server playwright spawns binds where a sandboxed browser cannot reach it.
    cmd: ["playwright", "test"],
    // The probe targets the browser, not the `playwright` CLI: the CLI is a devDependency and always
    // present, so probing it would pass vacuously and let every spec fail at launch.
    ...prerequisite(options.requires, {
      tool: "chromium",
      probe: hasChromium,
      // Unreachable wherever `CHROME_PATH` names a browser: it addresses a machine that has none.
      hint: options.hint ?? "run `bunx playwright install chromium`",
    }),
  };
}

/** `bun test` over `sources` (default `tests/workerd/`), `parallel` files at once (default 2), defaulting to the `full` tier: it needs the workerd runtime installed. @public */
export function workerdStep(options: { hint?: string; parallel?: number } & SourceStepOptions = {}): CommandStep {
  const sources = options.sources ?? ["tests/workerd/"];
  return {
    label: "test:workerd",
    // Defaults to `full` — it needs the workerd runtime installed — but the caller may state it, so
    // the step table can be read for which steps run in which mode without opening this file.
    ...tier(options.tier, "full"),
    tail: 120,
    cmd: ["bun", "test", `--parallel=${options.parallel ?? 2}`, ...sources],
    // The probe targets the runtime, not the test runner: `bun` is always present, so probing it
    // would pass vacuously and let every spec fail at server start.
    ...prerequisite(options.requires, {
      tool: "workerd",
      probe: hasWorkerd,
      hint: options.hint ?? "run `bun install` — `wrangler` brings the workerd runtime with it",
    }),
  };
}

/** Curates the demonstrator into a temporary tree and runs the skeleton's `standard` gate there, always in the `full` tier. @public */
export function featuresStep(config: FeaturesCheckConfig, options: Omit<StepOptions, "tier"> = {}): CheckStep {
  return checkStep("validate-features", () => checkFeatures(config), { ...options, tier: "full" });
}

/** The two `forge db schema check` rows: digests in `quality`, the replay in `full`. `forge` is the command that runs the CLI, `["forge"]` by default. @public */
export function dbSchemaStep(options: { root?: string; forge?: readonly [string, ...string[]]; hint?: string } = {}): [CommandStep, CommandStep] {
  const forge = options.forge ?? ["forge"];
  const root = options.root === undefined ? [] : ["--root", options.root];
  return [
    { label: "db:schema:digests", tail: 40, cmd: [...forge, "db", "schema", "check", ...root] },
    {
      label: "db:schema",
      tier: "full",
      tail: 60,
      cmd: [...forge, "db", "schema", "check", "--replay", ...root],
      requires: { tool: "workerd", probe: hasWorkerd, hint: options.hint ?? "run `bun install` — `wrangler` brings the workerd runtime with it" },
    },
  ];
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

/** Fails on any Worker config key whose default runs toward exposure being unstated, in the top level and every `env.*` block; requiring a *value* rather than statedness is opt-in via `require`. @public */
export function exposureStep(config: ExposureCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-exposure", () => checkExposure(config), options);
}

/** Fails a Worker config whose `compatibility_flags` omits or contradicts the runtime posture, in the top level and every `env.*` block that states a set of its own. @public */
export function compatibilityStep(config: CompatibilityCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-compatibility", () => checkCompatibility(config), options);
}

/** Checks every path the emitted assets manifest maps to exists under the served asset directory. @public */
export function assetManifestStep(config: AssetManifestCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-asset-manifest", (gateMode) => checkAssetManifest(config, gateMode), options);
}

/** Checks every source module has a test beside it, so deleting one is loud rather than silent. @public */
export function coLocationStep(config: CoLocationCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-co-location", () => checkCoLocation(config), options);
}

/** Checks every comment against the budget, so prose the code already states cannot accumulate unseen. @public */
export function commentBudgetStep(config: CommentBudgetCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-comment-budget", () => checkCommentBudget(config), options);
}

/** Checks that the published tarball carries no module only a test imports. @public */
export function packagingStep(config: PackagingCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-packaging", () => checkPackaging(config), options);
}

/** Checks that no server-rendered file imports the browser-only runtime. @public */
export function ssrBoundaryStep(config: SsrBoundaryCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-ssr-boundary", () => checkSsrBoundary(config), options);
}

/** Checks that nothing outside a guarded tree, save a named crossing, imports it at value. @public */
export function importBoundaryStep(config: ImportBoundaryCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-import-boundary", () => checkImportBoundary(config), options);
}

/** Checks that no deployable module names a development entry or a dev-only module. @public */
export function devBoundaryStep(config: DevBoundaryCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-dev-boundary", () => checkDevBoundary(config), options);
}

/** Checks markdown against the house conventions, with a fixer for the mechanical rules. @public */
export function markdownStep(config: MarkdownCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-markdown", () => checkMarkdown(config), options, { fix: () => fixMarkdown(config) });
}

/** Checks every shipped `.tsx` file carries the runtime pragmas. @public */
export function jsxStep(config: JsxCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-jsx", () => checkJsx(config), options);
}

/** Checks every `triggered` menu popup is paired with the trigger it takes its name from. @public */
export function menuNamingStep(config: MenuNamingCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-menu-naming", () => checkMenuNaming(config), options);
}

/** The dependency every design-system step shares — `tailwindcss` is an optional peer. */
const tailwindRequired = (): StepRequirement => ({ tool: "tailwindcss", probe: hasTailwind, hint: "run `bun add -d tailwindcss`" });

/** The dependency every bundle-drift step shares — `esbuild` is an optional peer. */
const esbuildRequired = (): StepRequirement => ({ tool: "esbuild", probe: hasEsbuild, hint: "run `bun add -d esbuild`" });

/** Measures every audited foreground/background pair against its contrast criterion. @public */
export function contrastStep(config: ContrastCheckConfig, options: StepOptions = {}): CheckStep {
  // The dependency rides on the palette: a project pointing `palettePath` elsewhere is not gated on tailwind.
  const defaults = config.palettePath === undefined ? {} : { requires: tailwindRequired() };
  return checkStep("validate-contrast", () => checkContrast(config), options, defaults);
}

/** Regenerates `cn`'s conflict table from the design system and fails on any drift from the committed copy. @public */
export function classGroupsStep(config: ClassGroupsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-class-groups", () => checkClassGroups(config), options, { requires: tailwindRequired() });
}

/** Regenerates the design-scale data forge's oxlint plugin reads and fails on any drift from the committed copy. @public */
export function designScaleStep(config: DesignScaleCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-design-scale", () => checkDesignScale(config), options, { requires: tailwindRequired() });
}

/** Re-encodes the committed ICC module from the profile beside it and fails on any drift. @public */
export function iccProfileStep(config: IccProfileCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-icc-profile", () => checkIccProfile(config), options);
}

/** Rebuilds the committed oxlint-plugin bundle and fails on any drift from its TypeScript source. @public */
export function lintPluginStep(config: BundleCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-lint-plugin", () => checkBundle(config), options, { requires: esbuildRequired() });
}

/** Rebuilds the committed chromium-resolution bundle and fails on any drift from its TypeScript source. @public */
export function chromiumBundleStep(config: BundleCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-chromium-bundle", () => checkBundle(config), options, { requires: esbuildRequired() });
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
