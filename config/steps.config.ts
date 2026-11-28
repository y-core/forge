/** The single source of truth for what forge's verification gate runs, and each check's config. */

import { fileURLToPath } from "node:url";

import pkg from "../package.json" with { type: "json" };
import {
  browserStep,
  bundleShadowStep,
  bundleStep,
  classGroupsStep,
  classOrderStep,
  classTokensStep,
  coLocationStep,
  commentBudgetStep,
  configFileStep,
  contrastStep,
  crossEngineStep,
  crossEngineTagsStep,
  cssSourcesStep,
  cssTokensStep,
  dbSteps,
  designScaleStep,
  devBoundaryStep,
  exportsStep,
  fadedTextStep,
  formatStep,
  iccProfileStep,
  importBoundaryStep,
  jsxStep,
  menuNamingStep,
  noBuildStep,
  lintStep,
  markdownStep,
  modernCssStep,
  namespaceGraphStep,
  nodeExportsStep,
  packagingStep,
  ssrBoundaryStep,
  stubGlobalsStep,
  testStep,
  typeAwareLintStep,
  typecheckStep,
  workerdStep,
} from "../src/tooling/gate/builders";
import { BUNDLE_FIXER, nodeBundles } from "../src/tooling/gate/checks/bundle";
import { FORGE_STATE_RECIPES } from "../src/tooling/gate/checks/class-groups";
import { resolveSources } from "../src/tooling/gate/checks/source-scan";
import type { ExportsMap, NodeManifest } from "../src/tooling/gate/checks/types";
import { declaredSteps, defineSteps, tier } from "../src/tooling/gate/tiers";
import type { StepTiers } from "../src/tooling/gate/types";
import { ACCEPTED_CONTRAST } from "../src/ui/contracts/theme/contrast-accepted";
import { CONTRAST_PAIRS, CRITERION } from "../src/ui/contracts/theme/contrast-pairs";
import {
  changelogStep,
  designStep,
  docFencesStep,
  docsStep,
  duplicatesStep,
  patternStep,
  ratchetStep,
  rulesStep,
  wardenQueriesStep,
  wardenStep,
} from "../warden/src/steps";
import {
  BROWSER_ONLY,
  CN_FIXTURE_SPECS,
  CO_LOCATION_EXEMPT,
  DESIGN_CORPUS_EXCLUDED,
  LICENCE_HEADERS,
  SEALED_INTERNAL,
  TOOLING_CROSSINGS,
} from "./exemptions";
import MARKDOWN from "./markdown";
import { EDGE_MODULES, EDGES, LEAF, PRIMITIVES } from "./namespaces";
import { COMMENT_BUDGET_SOURCES, CSS_DIR, ROOT } from "./paths";
import { RULES_CHECK } from "./rules-check";

const EXPORTS = pkg.exports as ExportsMap;

/** Each surface a node process imports, derived from `forge.node` and prebuilt because node refuses to strip types under `node_modules`. */
const BUNDLES = nodeBundles(ROOT, pkg as NodeManifest);

const CORPUS_WATCHES = ["**/*.md", "warden/**"];

const STYLESHEET = `${CSS_DIR}/tailwind.css`;

const CONSUMER_TSCONFIG = "tests/fixtures/workers-consumer/tsconfig.json";

// `validate-design` owns `src/ui/README.md`, whose `ts` fences the design corpus keeps uncompiled (UI_DESIGN_GUIDANCE.md §4c).
const README_FENCES_OWNED_ELSEWHERE = ["src/ui/README.md"];

// Each reaches a forge source that does not compile under the Workers consumer's options: a Node or Bun module.
const README_FENCES_BLOCKED = [
  "src/config/README.md",
  "src/testing/README.md",
  "src/tooling/assets/README.md",
  "src/tooling/cf/README.md",
  "src/tooling/cli/README.md",
  "src/tooling/curate/README.md",
  "src/tooling/db/README.md",
  "src/tooling/gate/README.md",
  "src/tooling/lint/README.md",
  "src/tooling/release/README.md",
  "src/tooling/term/README.md",
];

// These are Worker imports as well as node imports, so their fences stay typed.
const WORKER_NODE_SUBPATHS = new Set(["./result", "./storage/db", "./validation"]);
const NODE_ONLY_SUBPATHS = pkg.forge.node.filter((subpath) => !WORKER_NODE_SUBPATHS.has(subpath));

const README_FENCES = resolveSources(
  ROOT,
  ["README.md", "src", ...[...README_FENCES_OWNED_ELSEWHERE, ...README_FENCES_BLOCKED].map((path) => `!${path}`)],
  (name) => name === "README.md",
);

const DOC_FENCES = resolveSources(ROOT, ["docs"], (name) => name.endsWith(".md"));

const GRAPH = { primitives: PRIMITIVES, leaf: LEAF, edges: EDGES, modules: EDGE_MODULES };

const DB = dbSteps({
  root: "tests/fixtures/db-schema",
  forge: ["bun", "run", "src/tooling/root/bin.ts"],
  exercises: ["tooling/db", "auth"],
  graph: GRAPH,
});

const TIERS: StepTiers = {
  static: [
    typecheckStep(),
    {
      label: "typecheck:workers-consumer",
      tail: 20,
      cmd: ["bun", "check", "--no-script", "--no-pretty", "-p", "tests/fixtures/workers-consumer/tsconfig.json"],
    },
    {
      label: "typecheck:workers-consumer-node",
      tail: 20,
      cmd: ["bun", "check", "--no-script", "--no-pretty", "-p", "tests/fixtures/workers-consumer/tsconfig.node.json"],
    },
    {
      label: "typecheck:testing-stubs-consumer",
      tail: 20,
      cmd: ["bun", "check", "--no-script", "--no-pretty", "-p", "tests/fixtures/testing-stubs-consumer/tsconfig.json"],
    },
    {
      label: "typecheck:service-worker-consumer",
      tail: 20,
      cmd: ["bun", "check", "--no-script", "--no-pretty", "-p", "tests/fixtures/service-worker-consumer/tsconfig.json"],
    },
    { label: "typecheck:tests", tail: 20, cmd: ["bun", "check", "--no-script", "--no-pretty", "-p", "tests/tsconfig.json"] },
    lintStep({ sources: ["src/", "config/", "warden/"] }),
    formatStep({ sources: ["."] }),
    // `bun fmt` ignores `**/*.md`, so this step is what holds markdown to a house layout.
    markdownStep({ root: ROOT, ...MARKDOWN }),
    typeAwareLintStep({ sources: ["src/", "config/", "warden/"] }),
    exportsStep({
      root: ROOT,
      packageName: pkg.name,
      exports: EXPORTS,
      files: pkg.files,
      browserOnly: BROWSER_ONLY,
      sideEffectOnly: ["./render/jsx/register"],
      sealedInternal: SEALED_INTERNAL,
      assetDirs: [{ dir: CSS_DIR, extension: ".css" }],
    }),
    namespaceGraphStep({
      root: ROOT,
      packageName: pkg.name,
      exports: EXPORTS,
      graph: GRAPH,
      sealedInternal: SEALED_INTERNAL,
      enumerationDoc: "docs/NAMESPACES.md",
    }),
    jsxStep({ root: ROOT }),
    menuNamingStep({ root: ROOT }),
    crossEngineTagsStep({ root: ROOT }),
    coLocationStep({ root: ROOT, sources: ["src", "warden"], exempt: CO_LOCATION_EXEMPT }),
    configFileStep({ root: ROOT, markdown: true, nodeSubpaths: pkg.forge.node }),
    commentBudgetStep({ root: ROOT, sources: COMMENT_BUDGET_SOURCES, licences: LICENCE_HEADERS, coverTracked: true }),
    noBuildStep({ steps: () => declaredSteps(TIERS) }),
    packagingStep({
      root: ROOT,
      sources: ["src"],
      files: pkg.files,
      exports: EXPORTS,
      entries: Object.values(pkg.bin),
      required: ["README.md", "CHANGELOG.md"],
      scripts: pkg.scripts,
      packageManager: pkg.packageManager,
      engines: pkg.engines,
    }),
    ssrBoundaryStep({
      root: ROOT,
      clientDirs: [
        "src/ui/client",
        "src/auth/client",
        "src/render/markdown/editor/client",
        "src/render/markdown/editor/textarea/client",
        "src/assets/client",
      ],
      sources: ["src/ui", "src/auth", "src/render/markdown", "src/assets"],
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
      crossings: TOOLING_CROSSINGS,
    }),
    devBoundaryStep({ root: ROOT, sources: ["src"], workerConfig: null, devOnlyDirs: ["src/relax", "src/testing"] }),
    stubGlobalsStep({
      root: ROOT,
      stubs: [".types"],
      shared: ["Buffer", "ExecutionContext", "ImportMeta", "SubtleCrypto", "process"],
      sources: ["src", "warden/src", "!src/tooling/dev"],
    }),
    {
      label: "warden",
      tail: 20,
      cmd: ["bun", "warden/src/bin.ts", "sync", "--check"],
      fix: ["bun", "warden/src/bin.ts", "sync"],
      watches: [".claude/**", "warden/**", "CLAUDE.md", "AGENTS.md"],
    },
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
      requiredFrontmatter: [
        { dir: "docs", key: "audience", values: ["consumer", "internal"] },
        { dir: "src", fileName: "README.md", key: "audience", values: ["consumer", "internal"] },
      ],
      documentedNonExports: ["./crypto/primitives"],
      unboundSubpaths: ["./render/jsx/jsx-runtime", "./render/jsx/jsx-dev-runtime"],
    }),
    docFencesStep({
      root: ROOT,
      packageName: pkg.name,
      exports: EXPORTS,
      fencedDocs: [...README_FENCES, ...DOC_FENCES],
      tsconfig: CONSUMER_TSCONFIG,
      langs: ["ts", "tsx"],
      untypedSubpaths: NODE_ONLY_SUBPATHS,
    }),
    changelogStep({ root: ROOT, packageVersion: pkg.version }),
    designStep({
      root: ROOT,
      packageName: pkg.name,
      exports: EXPORTS,
      designDir: "src/ui/design",
      cssDir: CSS_DIR,
      floor: "floor.md",
      fencedDocs: ["src/ui/README.md"],
      tsconfig: CONSUMER_TSCONFIG,
    }),
    rulesStep(
      { ...RULES_CHECK, stepLabels: () => declaredSteps(TIERS).map((step) => step.label) },
      { watches: [...CORPUS_WATCHES, "config/rules.config.ts", "src/ui/design/rules.ts", "src/tooling/lint/**", ...RULES_CHECK.oxlintConfigs] },
    ),
    modernCssStep({ root: ROOT, sources: ["src/ui", DESIGN_CORPUS_EXCLUDED] }),
    classOrderStep({ root: ROOT, sources: ["src", ...CN_FIXTURE_SPECS] }),
    classTokensStep({ root: ROOT, sources: ["src/ui", DESIGN_CORPUS_EXCLUDED], stylesheet: STYLESHEET }),
    classGroupsStep({
      root: ROOT,
      stylesheet: STYLESHEET,
      table: "src/ui/core/utils/class-groups.ts",
      fixer: "bun run gen:class-groups",
      stateRecipes: FORGE_STATE_RECIPES,
    }),
    designScaleStep({ root: ROOT, stylesheet: STYLESHEET, table: "src/tooling/lint/data/design-scale.ts", fixer: "bun run gen:design-scale" }),
    iccProfileStep({ root: ROOT, profile: "src/render/pdf/sRGB2014.icc", module: "src/render/pdf/icc.ts" }),
    nodeExportsStep({ exports: EXPORTS, node: pkg.forge.node, fixer: BUNDLE_FIXER }),
    ...BUNDLES.map(({ label, entry, bundle, watches }) => bundleStep(label, { root: ROOT, entry, bundle, fixer: BUNDLE_FIXER }, { watches })),
    bundleShadowStep({ root: ROOT, sources: ["src"] }),
    contrastStep(
      {
        root: ROOT,
        cssDir: CSS_DIR,
        tokenFiles: [`${CSS_DIR}/theme-neutral.css`, `${CSS_DIR}/theme-colors.css`, `${CSS_DIR}/theme-base.css`],
        mappingFile: `${CSS_DIR}/theme-base.css`,
        pairs: CONTRAST_PAIRS,
        criteria: CRITERION,
        // Deferred: resolving at import time would throw before the runner exists to report the step skipped.
        palettePath: () => fileURLToPath(import.meta.resolve("tailwindcss/theme.css")),
        accepted: ACCEPTED_CONTRAST,
      },
      { watches: [`${CSS_DIR}/**`, "src/ui/contracts/theme/**"] },
    ),
    fadedTextStep({ root: ROOT, sources: ["src/ui", DESIGN_CORPUS_EXCLUDED], pairs: CONTRAST_PAIRS }),
    cssSourcesStep({
      root: ROOT,
      uiDir: "src/ui",
      cssDir: CSS_DIR,
      sourceDir: "src",
      readme: "src/ui/README.md",
      packageName: pkg.name,
      exports: EXPORTS,
      classFree: new Map([
        ["assets", "sprite and glyph data — no markup, no class strings"],
        ["client", "mount controllers; the markup they operate on is the consumer's"],
        ["design", "design corpus — markdown and its rule register, whose samples deliberately quote forbidden classes"],
        ["server", "SSR helpers that delegate to core/ components for all markup"],
      ]),
      quotedClasses: new Map([["src/ui/design/rules.ts", "register entries whose patterns and examples quote the classes a rule forbids"]]),
    }),
    cssTokensStep({ root: ROOT, stylesheet: STYLESHEET, cssDir: CSS_DIR }),
    wardenStep({ root: ROOT, kind: "libs", catalogue: "warden/CATALOGUE.md", canonHome: true }, { watches: CORPUS_WATCHES }),
    wardenQueriesStep({ root: ROOT, kind: "libs" }, { watches: CORPUS_WATCHES }),
    duplicatesStep({ root: ROOT, kind: "libs" }, { watches: CORPUS_WATCHES }),
    patternStep({ root: ROOT, kind: "libs", trees: ["shared", "libs", "apps"] }),
    ratchetStep(
      { root: ROOT, kind: "libs", trees: ["shared", "libs", "apps"], baseline: "config/rules-baseline.json" },
      // `config/rules*` reaches the baseline without naming it, so a first `--fix` runs while the file is still absent.
      { watches: [...CORPUS_WATCHES, "config/rules*", "src/ui/design/rules.ts"] },
    ),
    ...DB.static,
  ],
  unit: [tier("static"), testStep({ sources: ["src/", "warden/src/"], leavesNoTemp: true })],
  runtime: [tier("unit"), ...DB.runtime],
  scheduled: [tier("runtime"), browserStep(), workerdStep({ leavesNoTemp: true }), crossEngineStep()],
};

export default defineSteps({
  inputs: ["src/tooling/gate/**", "src/tooling/cli/**", "src/tooling/term/**", "src/tooling/lint/**", "src/result/**", "warden/src/**"],
  tiers: TIERS,
});
