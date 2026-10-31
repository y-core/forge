/** The single source of truth for what forge's verification gate runs, and each check's config. */

import { fileURLToPath } from "node:url";

import pkg from "../package.json" with { type: "json" };
import {
  browserStep,
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
import { FORGE_STATE_RECIPES } from "../src/tooling/gate/checks/class-groups";
import type { ExportsMap } from "../src/tooling/gate/checks/types";
import { defineSteps, tier } from "../src/tooling/gate/tiers";
import { ACCEPTED_CONTRAST } from "../src/ui/contracts/theme/contrast-accepted";
import { CONTRAST_PAIRS, CRITERION } from "../src/ui/contracts/theme/contrast-pairs";
import { changelogStep, designStep, docsStep, duplicatesStep, wardenQueriesStep, wardenStep } from "../warden/src/steps";
import { BUNDLE_FIXER, BUNDLES } from "./bundles";
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

const EXPORTS = pkg.exports as ExportsMap;

const CORPUS_WATCHES = ["**/*.md", "warden/**"];

const STYLESHEET = `${CSS_DIR}/tailwind.css`;

const GRAPH = { primitives: PRIMITIVES, leaf: LEAF, edges: EDGES, modules: EDGE_MODULES };

const DB = dbSteps({
  root: "tests/fixtures/db-schema",
  forge: ["bun", "run", "src/tooling/root/bin.ts"],
  exercises: ["tooling/db", "auth"],
  graph: GRAPH,
});

export default defineSteps({
  inputs: ["src/tooling/gate/**", "src/tooling/cli/**", "src/tooling/term/**", "src/tooling/lint/**", "src/result/**", "warden/src/**"],
  tiers: {
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
        label: "typecheck:service-worker-consumer",
        tail: 20,
        cmd: ["bun", "check", "--no-script", "--no-pretty", "-p", "tests/fixtures/service-worker-consumer/tsconfig.json"],
      },
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
      configFileStep({ root: ROOT }),
      commentBudgetStep({ root: ROOT, sources: COMMENT_BUDGET_SOURCES, licences: LICENCE_HEADERS }),
      packagingStep({
        root: ROOT,
        sources: ["src"],
        files: pkg.files,
        exports: EXPORTS,
        entries: Object.values(pkg.bin),
        required: ["README.md", "CHANGELOG.md"],
      }),
      ssrBoundaryStep({
        root: ROOT,
        clientDirs: ["src/ui/client", "src/auth/client", "src/render/markdown/editor/client", "src/render/markdown/editor/textarea/client"],
        sources: ["src/ui", "src/auth", "src/render/markdown"],
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
        shared: ["Bun", "Buffer", "ExecutionContext", "ImportMeta", "SubtleCrypto", "process"],
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
      changelogStep({ root: ROOT, packageVersion: pkg.version }),
      designStep({
        root: ROOT,
        packageName: pkg.name,
        exports: EXPORTS,
        designDir: "src/ui/design",
        cssDir: CSS_DIR,
        oxlintConfig: ".oxlintrc.json",
        fencedDocs: ["src/ui/README.md"],
        tsconfig: "tests/fixtures/workers-consumer/tsconfig.json",
      }),
      modernCssStep({ root: ROOT, sources: ["src/ui", DESIGN_CORPUS_EXCLUDED] }),
      classOrderStep({ root: ROOT, sources: ["src", ...CN_FIXTURE_SPECS] }),
      classTokensStep({ root: ROOT, sources: ["src/ui", DESIGN_CORPUS_EXCLUDED], stylesheet: STYLESHEET }),
      classGroupsStep({ root: ROOT, stylesheet: STYLESHEET, table: "src/ui/core/utils/class-groups.ts", stateRecipes: FORGE_STATE_RECIPES }),
      designScaleStep({ root: ROOT, stylesheet: STYLESHEET, table: "src/tooling/lint/data/design-scale.ts" }),
      iccProfileStep({ root: ROOT, profile: "src/render/pdf/sRGB2014.icc", module: "src/render/pdf/icc.ts" }),
      nodeExportsStep({ exports: EXPORTS, node: pkg.forge.node, fixer: BUNDLE_FIXER }),
      ...BUNDLES.map(({ label, entry, bundle, watches }) => bundleStep(label, { root: ROOT, entry, bundle, fixer: BUNDLE_FIXER }, { watches })),
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
          ["design", "design corpus — markdown only, and its samples deliberately quote forbidden classes"],
          ["server", "SSR helpers that delegate to core/ components for all markup"],
        ]),
      }),
      cssTokensStep({ root: ROOT, stylesheet: STYLESHEET, cssDir: CSS_DIR }),
      wardenStep({ root: ROOT, kind: "libs", catalogue: "warden/CATALOGUE.md", canonHome: true }, { watches: CORPUS_WATCHES }),
      wardenQueriesStep({ root: ROOT, kind: "libs" }, { watches: CORPUS_WATCHES }),
      duplicatesStep({ root: ROOT, kind: "libs" }, { watches: CORPUS_WATCHES }),
      ...DB.static,
    ],
    unit: [tier("static"), testStep({ sources: ["src/", "config/", "warden/src/"], leavesNoTemp: true })],
    runtime: [tier("unit"), ...DB.runtime],
    scheduled: [tier("runtime"), browserStep(), workerdStep({ leavesNoTemp: true }), crossEngineStep()],
  },
});
