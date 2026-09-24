/** The single source of truth for what forge's verification gate runs, and each check's config. */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "../package.json" with { type: "json" };
import { resolveAppRoot } from "../src/tooling/cli/mod";
import {
  browserStep,
  chromiumBundleStep,
  classGroupsStep,
  classOrderStep,
  classTokensStep,
  coLocationStep,
  commentBudgetStep,
  contrastStep,
  cssSourcesStep,
  cssTokensStep,
  dbSchemaStep,
  designScaleStep,
  devBoundaryStep,
  exportsStep,
  formatStep,
  iccProfileStep,
  importBoundaryStep,
  jsxStep,
  menuNamingStep,
  lintPluginStep,
  lintStep,
  markdownStep,
  modernCssStep,
  namespaceGraphStep,
  packagingStep,
  ssrBoundaryStep,
  testStep,
  typeAwareLintStep,
  typecheckStep,
  workerdStep,
} from "../src/tooling/gate/builders";
import { FORGE_STATE_RECIPES } from "../src/tooling/gate/checks/class-groups";
import type { ExportsMap } from "../src/tooling/gate/checks/types";
import type { Step } from "../src/tooling/gate/types";
import { ACCEPTED_CONTRAST } from "../src/ui/contracts/theme/contrast-accepted";
import { CONTRAST_PAIRS, CRITERION } from "../src/ui/contracts/theme/contrast-pairs";
import { changelogStep, designStep, docsStep, duplicatesStep, wardenQueriesStep, wardenStep } from "../warden/src/steps";
import { BROWSER_ONLY, CN_FIXTURE_SPECS, CO_LOCATION_EXEMPT, DESIGN_CORPUS_EXCLUDED, LICENCE_HEADERS, SEALED_INTERNAL } from "./exemptions";
import MARKDOWN from "./markdown";
import { EDGES, LEAF, PRIMITIVES } from "./namespaces";

// Derived from this file's location, never `process.cwd()`: the paths must resolve the same whichever directory the gate ran from.
/** Repository root. */
export const ROOT = resolveAppRoot(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const EXPORTS = pkg.exports as ExportsMap;

const GEN = "bun run gen:bundles";

/** The gate's steps, in execution order. */
export const STEPS: readonly Step[] = [
  typecheckStep(),
  { label: "typecheck:workers-consumer", tail: 20, cmd: ["tsc", "--noEmit", "-p", "tests/fixtures/workers-consumer/tsconfig.json"] },
  lintStep({ sources: ["src/", "config/", "warden/"] }),
  formatStep({ sources: ["."] }),
  // oxfmt ignores `**/*.md`, so this step is what holds markdown to a house layout.
  markdownStep({ root: ROOT, ...MARKDOWN }),
  typeAwareLintStep({ sources: ["src/", "config/", "warden/"] }),
  testStep({ sources: ["src/", "config/", "warden/src/"] }),
  exportsStep({
    root: ROOT,
    packageName: pkg.name,
    exports: EXPORTS,
    files: pkg.files,
    browserOnly: BROWSER_ONLY,
    sideEffectOnly: ["./jsx/register"],
    sealedInternal: SEALED_INTERNAL,
    assetDirs: [{ dir: "src/ui/assets/css", extension: ".css" }],
  }),
  namespaceGraphStep({
    root: ROOT,
    exports: EXPORTS,
    graph: { primitives: PRIMITIVES, leaf: LEAF, edges: EDGES },
    sealedInternal: SEALED_INTERNAL,
    enumerationDoc: "docs/NAMESPACES.md",
  }),
  jsxStep({ root: ROOT }),
  menuNamingStep({ root: ROOT }),
  coLocationStep({ root: ROOT, sources: ["src", "warden"], exempt: CO_LOCATION_EXEMPT }),
  commentBudgetStep({ root: ROOT, sources: ["src", "config", "warden/src"], licences: LICENCE_HEADERS }),
  packagingStep({ root: ROOT, sources: ["src"], files: pkg.files, exports: EXPORTS, entries: Object.values(pkg.bin) }),
  ssrBoundaryStep({
    root: ROOT,
    clientDirs: ["src/ui/client", "src/auth/client"],
    sources: ["src/ui", "src/auth"],
    entryPoints: ["client.ts"],
    packageName: pkg.name,
    exports: EXPORTS,
  }),
  importBoundaryStep({
    root: ROOT,
    packageName: pkg.name,
    exports: EXPORTS,
    guarded: ["src/tooling", "src/ui/assets/build", "warden"],
    sources: ["src"],
  }),
  devBoundaryStep({ root: ROOT, sources: ["src"], workerConfig: null, devOnlyDirs: ["src/dev", "src/testing"] }),
  { label: "warden", tail: 20, cmd: ["bun", "warden/src/bin.ts", "sync", "--check"], fix: ["bun", "warden/src/bin.ts", "sync"] },
  docsStep({
    root: ROOT,
    packageName: pkg.name,
    exports: EXPORTS,
    decisionsDir: "docs",
    kind: "libs",
    extraDirs: [
      { dir: "warden/claude/agents/shared", kind: "shared" },
      { dir: "warden/claude/agents/libs", kind: "libs" },
      { dir: "warden/claude/agents/apps", kind: "apps" },
      { dir: "warden/claude/skills", kind: "shared" },
      { dir: "warden/canon/shared", kind: "shared", numbered: true },
      { dir: "warden/canon/libs", kind: "libs", numbered: true },
      { dir: "warden/canon/apps", kind: "apps", numbered: true },
      { dir: "warden/README.md", kind: "libs" },
      { dir: "src/ui/design", numbered: true },
    ],
    citableDirs: ["warden/canon/shared", "warden/canon/libs", "warden/canon/apps"],
    agreementDirs: ["warden/canon", "src/ui/design"],
    requiredFrontmatter: [{ dir: "docs", key: "audience", values: ["consumer", "internal"] }],
    documentedNonExports: ["./handler", "./all", "./crypto"],
    tableExemptSubpaths: ["./jsx/jsx-runtime", "./jsx/jsx-dev-runtime", "./jsx/register"],
    catalogs: [
      { doc: "README.md", exempt: ["./jsx/jsx-runtime", "./jsx/jsx-dev-runtime", "./jsx/register"] },
      { doc: "docs/NAMESPACES.md", exempt: ["./warden", "./warden/checks", "./warden/knowledge", "./warden/mcp", "./warden/steps"] },
    ],
    listedOnlySubpaths: ["./jsx/jsx-runtime", "./jsx/jsx-dev-runtime"],
  }),
  changelogStep({ root: ROOT, packageVersion: pkg.version }, { tier: "full" }),
  designStep({
    root: ROOT,
    packageName: pkg.name,
    exports: EXPORTS,
    designDir: "src/ui/design",
    cssDir: "src/ui/assets/css",
    oxlintConfig: ".oxlintrc.json",
  }),
  modernCssStep({ root: ROOT, sources: ["src/ui", DESIGN_CORPUS_EXCLUDED] }),
  classOrderStep({ root: ROOT, sources: ["src", ...CN_FIXTURE_SPECS] }),
  classTokensStep({ root: ROOT, sources: ["src/ui", DESIGN_CORPUS_EXCLUDED], stylesheet: "src/ui/assets/css/tailwind.css" }),
  classGroupsStep({
    root: ROOT,
    stylesheet: "src/ui/assets/css/tailwind.css",
    table: "src/ui/core/utils/class-groups.ts",
    stateRecipes: FORGE_STATE_RECIPES,
  }),
  designScaleStep({ root: ROOT, stylesheet: "src/ui/assets/css/tailwind.css", table: "src/tooling/lint/data/design-scale.ts" }),
  // node refuses to strip types under `node_modules`, so a consumer loads a prebuilt copy of each surface a node process imports.
  iccProfileStep({ root: ROOT, profile: "src/output/pdf/sRGB2014.icc", module: "src/output/pdf/icc.ts" }),
  lintPluginStep({ root: ROOT, entry: "src/tooling/lint/mod.ts", bundle: "src/tooling/lint/plugin.mjs", fixer: GEN }),
  chromiumBundleStep({ root: ROOT, entry: "src/tooling/gate/checks/chromium.ts", bundle: "src/tooling/gate/chromium.mjs", fixer: GEN }),
  contrastStep({
    root: ROOT,
    cssDir: "src/ui/assets/css",
    tokenFiles: ["src/ui/assets/css/theme-neutral.css", "src/ui/assets/css/theme-colors.css", "src/ui/assets/css/theme-base.css"],
    mappingFile: "src/ui/assets/css/theme-base.css",
    pairs: CONTRAST_PAIRS,
    criteria: CRITERION,
    // Deferred: resolving at import time would throw before the runner exists to report the step skipped.
    palettePath: () => fileURLToPath(import.meta.resolve("tailwindcss/theme.css")),
    accepted: ACCEPTED_CONTRAST,
  }),
  cssSourcesStep({
    root: ROOT,
    uiDir: "src/ui",
    cssDir: "src/ui/assets/css",
    sourceDir: "src",
    readme: "src/ui/README.md",
    classFree: new Map([
      ["assets", "sprite and glyph data — no markup, no class strings"],
      ["client", "mount controllers; the markup they operate on is the consumer's"],
      ["design", "design corpus — markdown only, and its samples deliberately quote forbidden classes"],
      ["server", "SSR helpers that delegate to core/ components for all markup"],
    ]),
  }),
  cssTokensStep({ root: ROOT, stylesheet: "src/ui/assets/css/tailwind.css", cssDir: "src/ui/assets/css" }),
  wardenStep({ root: ROOT, kind: "libs", catalogue: "warden/CATALOGUE.md", canonHome: true }),
  wardenQueriesStep({ root: ROOT, kind: "libs" }),
  duplicatesStep({ root: ROOT, kind: "libs" }),
  browserStep({ tier: "full" }),
  workerdStep({ tier: "full" }),
  ...dbSchemaStep({ root: "tests/fixtures/db-schema", forge: ["bun", "run", "src/tooling/root/bin.ts"] }),
];

export default STEPS;
