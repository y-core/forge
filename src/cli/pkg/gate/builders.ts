/** Pre-built steps for the checks forge ships, so a project names the ones it wants instead of
 *  writing a spawnable file per check. Labels are fixed: they are the `--only` tokens.
 */

import { hasChromium } from "./checks/browser";
import { type ChangelogCheckConfig, checkChangelog } from "./checks/changelog";
import { type CoLocationCheckConfig, checkCoLocation } from "./checks/co-location";
import { type ContrastCheckConfig, checkContrast } from "./checks/contrast";
import { type CssSourcesCheckConfig, checkCssSources } from "./checks/css-sources";
import { checkDesign, type DesignCheckConfig } from "./checks/design";
import { checkDocs, type DocsCheckConfig } from "./checks/docs";
import { checkExports, type ExportsCheckConfig } from "./checks/exports";
import { checkJsx, type JsxCheckConfig } from "./checks/jsx";
import { checkModernCss, type ModernCssCheckConfig } from "./checks/modern-css";
import { checkNamespaceGraph, type NamespaceGraphCheckConfig } from "./checks/namespace-graph";
import { checkSsrBoundary, type SsrBoundaryCheckConfig } from "./checks/ssr-boundary";
import type { CheckStep, CommandStep } from "./steps";

/** Overrides every pre-built step accepts; each builder documents the default it applies. @public */
export interface StepOptions {
  /** Restricts the step to `--full` runs. */
  fullOnly?: boolean;
}

/** Sources a tool step is pointed at. @public */
export interface SourceStepOptions extends StepOptions {
  /** Paths passed to the tool, relative to the runner's `cwd`. */
  sources?: readonly string[];
}

function mode(fullOnly: boolean | undefined, fallback = false): { fullOnly: true } | Record<string, never> {
  return (fullOnly ?? fallback) ? { fullOnly: true } : {};
}

function checkStep(label: string, run: CheckStep["run"], options: StepOptions, fullByDefault = false): CheckStep {
  return { label, run, ...mode(options.fullOnly, fullByDefault) };
}

/** `tsgo --noEmit`. Belongs first in a table: a type failure cascades into misleading lint and test failures. @public */
export function typecheckStep(options: StepOptions = {}): CommandStep {
  return { label: "typecheck", tail: 20, cmd: ["tsgo", "--noEmit"], ...mode(options.fullOnly) };
}

/** `biome check` over `sources` (default `src/`), with `--write` as its fixer. @public */
export function lintStep(options: SourceStepOptions = {}): CommandStep {
  const sources = options.sources ?? ["src/"];
  return {
    label: "lint",
    tail: 20,
    // Biome exits 0 on `warn`, so without this a green gate would not mean a clean tree.
    cmd: ["biome", "check", "--error-on-warnings", ...sources],
    fix: ["biome", "check", "--write", ...sources],
    ...mode(options.fullOnly),
  };
}

/** `bun test` over `sources`, or the whole project when none are named. @public */
export function testStep(options: SourceStepOptions = {}): CommandStep {
  return { label: "test", tail: 120, cmd: ["bun", "test", ...(options.sources ?? [])], ...mode(options.fullOnly) };
}

/** `playwright test`, always `--full`: it needs a downloaded browser. @public */
export function browserStep(options: { hint?: string } & StepOptions = {}): CommandStep {
  return {
    label: "test:browser",
    // Defaults to `--full` — it needs a downloaded browser — but the caller may state it, so the
    // step table can be read for which steps run in which mode without opening this file.
    ...mode(options.fullOnly, true),
    tail: 120,
    cmd: ["playwright", "test"],
    // The prerequisite probed is the downloaded browser, not the `playwright` CLI: the CLI is a
    // devDependency and always present, so probing it would pass vacuously and let every spec fail
    // inside `browserType.launch()` instead.
    requires: { tool: "chromium", probe: hasChromium, hint: options.hint ?? "bun run test:install" },
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

/** Checks every shipped `.tsx` file carries the runtime pragmas and clobbers no slot. @public */
export function jsxStep(config: JsxCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-jsx", () => checkJsx(config), options);
}

/** Checks the governing documents against the subpaths they are required to cite. @public */
export function docsStep(config: DocsCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-docs", () => checkDocs(config), options);
}

/** Checks the changelog's headings against the current package version. Defaults to `--full`:
 *  requiring a written `[Unreleased]` entry on every inner loop would fail every WIP commit. @public */
export function changelogStep(config: ChangelogCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-changelog", () => checkChangelog(config), options, true);
}

/** Checks the design corpus against the tree it governs. @public */
export function designStep(config: DesignCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-design", () => checkDesign(config), options);
}

/** Measures every audited foreground/background pair against its contrast criterion. @public */
export function contrastStep(config: ContrastCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-contrast", () => checkContrast(config), options);
}

/** Checks stylesheets and class literals for patterns the platform now expresses directly. @public */
export function modernCssStep(config: ModernCssCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-modern-css", () => checkModernCss(config), options);
}

/** Checks every class-bearing directory is reached by an `@source` directive. @public */
export function cssSourcesStep(config: CssSourcesCheckConfig, options: StepOptions = {}): CheckStep {
  return checkStep("validate-css-sources", () => checkCssSources(config), options);
}
