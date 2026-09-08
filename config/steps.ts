/** The single source of truth for what forge's verification gate runs, and each check's config. */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "../package.json" with { type: "json" };
import { resolveAppRoot } from "../src/tooling/cli/mod";
import {
  browserStep,
  classGroupsStep,
  classOrderStep,
  classTokensStep,
  coLocationStep,
  contrastStep,
  cssSourcesStep,
  cssTokensStep,
  designScaleStep,
  FORGE_STATE_RECIPES,
  type ExportsMap,
  exportsStep,
  formatStep,
  jsxStep,
  lintPluginStep,
  lintStep,
  markdownStep,
  modernCssStep,
  namespaceGraphStep,
  type Step,
  buildTimeBoundaryStep,
  ssrBoundaryStep,
  testStep,
  typeAwareLintStep,
  workerdStep,
  typecheckStep,
} from "../src/tooling/gate/mod";
import { ACCEPTED_CONTRAST } from "../src/ui/contracts/theme/contrast-accepted";
import { CONTRAST_PAIRS, CRITERION } from "../src/ui/contracts/theme/contrast-pairs";
import { changelogStep, designStep, docsStep, duplicatesStep, readmeExportsStep, wardenQueriesStep, wardenStep } from "../warden/src/steps";
import { BROWSER_ONLY, CN_FIXTURE_SPECS, CO_LOCATION_EXEMPT, DESIGN_CORPUS_EXCLUDED, SEALED_INTERNAL } from "./exemptions";
import MARKDOWN from "./markdown";
import { EDGES, LEAF, PRIMITIVES } from "./namespaces";

// Derived from this file's location, never `process.cwd()`: the table must resolve the same paths
// whichever directory `forge verify` ran from, and forge has no `node_modules/@y-core/forge` above it.
/** Repository root. */
export const ROOT = resolveAppRoot(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const EXPORTS = pkg.exports as ExportsMap;

// `typecheck` runs first because a type failure cascades into misleading lint and test failures.
/** The gate's steps, in execution order. */
export const STEPS: readonly Step[] = [
  typecheckStep(),
  {
    label: "typecheck:workers-consumer",
    tier: "standard",
    tail: 20,
    cmd: ["tsc", "--noEmit", "-p", "tests/fixtures/workers-consumer/tsconfig.json"],
  },
  lintStep({ sources: ["src/", "config/", "warden/"] }),
  formatStep({ sources: ["."] }),
  // Beside the formatter, and before `validate-docs`: oxfmt ignores `**/*.md`, so this is what holds
  // markdown to a house layout, and `docs` then reads already-normalized bytes.
  markdownStep({ root: ROOT, ...MARKDOWN }, { tier: "standard" }),
  typeAwareLintStep({ sources: ["src/", "config/", "warden/"], tier: "standard" }),
  // Scoped to `src/`: `tests/workerd/` is the `full`-tier `test:workerd` step's, and each of its
  // specs starts a real Workers runtime.
  testStep({ sources: ["src/"] }),
  exportsStep(
    {
      root: ROOT,
      packageName: pkg.name,
      exports: EXPORTS,
      files: pkg.files,
      // A subpath under a `client` segment is derived browser-only, so only its static parsing runs.
      browserOnly: BROWSER_ONLY,
      sideEffectOnly: ["./jsx/register"],
      sealedInternal: SEALED_INTERNAL,
      assetDirs: [{ dir: "src/ui/assets/css", extension: ".css" }],
    },
    { tier: "standard" },
  ),
  namespaceGraphStep(
    {
      root: ROOT,
      exports: EXPORTS,
      graph: { primitives: PRIMITIVES, leaf: LEAF, edges: EDGES },
      sealedInternal: SEALED_INTERNAL,
      enumerationDoc: "docs/NAMESPACES.md",
    },
    { tier: "standard" },
  ),
  jsxStep({ root: ROOT }, { tier: "standard" }),
  // CLAUDE.md requires co-located tests and nothing enforced it, which is how a `bind.test.ts`
  // could vanish in a refactor with no signal at all.
  coLocationStep(
    {
      root: ROOT,
      sources: ["src", "warden"],
      // An entry naming no walked module fails the check, so the map can only shrink.
      exempt: CO_LOCATION_EXEMPT,
    },
    { tier: "standard" },
  ),
  // `namespaces.ts` declares `ui/core → ui/client` once for the whole namespace,
  // which alone would license every component in it to import browser code that throws in a Worker.
  ssrBoundaryStep(
    {
      root: ROOT,
      clientDir: "src/ui/client",
      sources: ["src/ui"],
      // The registration entry points, and nothing else: each exists to pull the client runtime in.
      entryPoints: ["client.ts"],
    },
    { tier: "standard" },
  ),
  // Membership in `src/tooling/` *is* the build-time exemption ([`NAMESPACES.md`] §4a), so the rule
  // that makes it true is checked rather than asserted: no published runtime subpath may reach one
  // of these directories, and no runtime source may name one even before a barrel exports it.
  buildTimeBoundaryStep(
    { root: ROOT, packageName: pkg.name, exports: EXPORTS, buildTimeDirs: ["src/tooling", "src/ui/assets/build", "warden"], sources: ["src"] },
    { tier: "standard" },
  ),
  // `.claude/agents/` and `.claude/commands/` are overwrite-on-sync, so an edit made in place is
  // reverted by the next sync and the reversion looks like nobody's change. The fixer is the sync.
  { label: "warden", tier: "standard", tail: 20, cmd: ["bun", "warden/src/bin.ts", "sync", "--check"], fix: ["bun", "warden/src/bin.ts", "sync"] },
  docsStep(
    {
      root: ROOT,
      packageName: pkg.name,
      exports: EXPORTS,
      decisionsDir: "docs",
      kind: "libs",
      // The source, not `.claude/agents/` — a fix applied to the synced copy is reverted by the
      // next sync, and the reversion looks like nobody's change.
      // Each kind-scoped, because a bare `CODE_RULES.md` names a different file to each reader and
      // the citing file's own tree is the only thing that says which.
      extraDirs: [
        { dir: "warden/claude/agents/libs", kind: "libs" },
        { dir: "warden/claude/agents/apps", kind: "apps" },
        { dir: "warden/canon/shared", kind: "shared", numbered: true },
        { dir: "warden/canon/libs", kind: "libs", numbered: true },
        { dir: "warden/canon/apps", kind: "apps", numbered: true },
        { dir: "warden/README.md", kind: "libs" },
        // Numbered like the canon and for the same reason: warden indexes it, and a section with no
        // `## 0. Quick Reference` line has no gloss — the heaviest column it can be ranked on, and
        // the line a search result prints under every hit.
        { dir: "src/ui/design", numbered: true },
      ],
      // Forge is the canon's home, so a citation into it resolves on disk. Without this root those
      // citations would land outside `docs/` and be skipped in silence rather than checked.
      citableDirs: ["warden/canon/shared", "warden/canon/libs", "warden/canon/apps"],
      // All three trees, `apps` included: forge houses the canon, so a stale gloss here ships to
      // every consumer of it, and no consumer has the files to catch it.
      agreementDirs: ["warden/canon", "src/ui/design"],
      // What decides whether a document is served into a consuming repository at all. Declared in
      // frontmatter rather than derived, because the alternatives do not work: `governs` measures
      // what a document talks about and not who should read it, and `NAMESPACES.md` mints three
      // subpath edges — one from a sentence saying a subpath does *not* exist — while
      // `UI_CLASS_COMPOSITION.md` and `STATE_ATTRIBUTES.md` mint none. Required here so a new
      // document fails closed rather than defaulting into a consumer's index.
      requiredFrontmatter: [{ dir: "docs", key: "audience", values: ["consumer", "internal"] }],
      documentedNonExports: ["./auth", "./handler", "./all", "./crypto"],
      // Written by the compiler and by build configuration, never by a consumer, so a documented row
      // for any of them would advertise an import the reader must not write.
      tableExemptSubpaths: ["./jsx/jsx-runtime", "./jsx/jsx-dev-runtime", "./jsx/register"],
      // Two catalogs, two scopes: the front page covers every published subpath, `NAMESPACES.md`
      // §3a covers the runtime namespaces and says in its own lead why warden's five are elsewhere.
      catalogs: [
        { doc: "README.md", exempt: ["./jsx/jsx-runtime", "./jsx/jsx-dev-runtime", "./jsx/register"] },
        { doc: "docs/NAMESPACES.md", exempt: ["./warden", "./warden/checks", "./warden/knowledge", "./warden/mcp", "./warden/steps"] },
      ],
      listedOnlySubpaths: [],
    },
    { tier: "standard" },
  ),
  // `validate-docs` holds the governing documents against the subpath catalog; this holds one
  // README's per-subpath tables against the barrels, and a section opts in via `> Import path:`.
  readmeExportsStep(
    {
      root: ROOT,
      // Four are side-effect imports whose section documents registered scopes rather than symbols,
      // and `./ui/client/htmx` re-exports the vendored library itself, which has no forge surface.
      exempt: ["./ui/core/client", "./ui/client/htmx", "./ui/chrome/client", "./ui/show/client"],
    },
    { tier: "standard" },
  ),
  changelogStep({ root: ROOT, packageVersion: pkg.version }, { tier: "full" }),
  designStep(
    {
      root: ROOT,
      packageName: pkg.name,
      exports: EXPORTS,
      designDir: "src/ui/design",
      cssDir: "src/ui/assets/css",
      oxlintConfig: ".oxlintrc.json",
    },
    { tier: "standard" },
  ),
  modernCssStep({ root: ROOT, sources: ["src/ui", DESIGN_CORPUS_EXCLUDED] }, { tier: "standard" }),
  classOrderStep({ root: ROOT, sources: ["src", ...CN_FIXTURE_SPECS] }, { tier: "standard" }),
  classTokensStep({ root: ROOT, sources: ["src/ui", DESIGN_CORPUS_EXCLUDED], stylesheet: "src/ui/assets/css/tailwind.css" }, { tier: "standard" }),
  // `tailwindcss` is an optional peer: a standard run on a machine without it reports the step
  // skipped, one with it gets the drift check, and a full run fails either way.
  classGroupsStep(
    {
      root: ROOT,
      stylesheet: "src/ui/assets/css/tailwind.css",
      table: "src/ui/core/utils/class-groups.ts",
      // The recipes that paint nothing in the base state; the other four are paint and belong in the
      // Tailwind slots they compile to, which is what lets a caller's `rounded-lg` beat `field-chrome`.
      stateRecipes: FORGE_STATE_RECIPES,
    },
    { tier: "standard" },
  ),
  // A second step rather than a second assertion inside the first: the two generated files drift for
  // different reasons, and a reader has to be told which one to regenerate.
  designScaleStep(
    { root: ROOT, stylesheet: "src/ui/assets/css/tailwind.css", table: "src/tooling/lint/data/design-scale.ts" },
    { tier: "standard" },
  ),
  // The bundle a consumer's oxlint loads, held against the source forge's own `.oxlintrc.json` names:
  // node refuses to strip types under `node_modules`, so the two copies exist and one can drift.
  lintPluginStep({ root: ROOT, entry: "src/tooling/lint/mod.ts", bundle: "src/tooling/lint/plugin.mjs" }, { tier: "standard" }),
  contrastStep(
    {
      root: ROOT,
      cssDir: "src/ui/assets/css",
      tokenFiles: ["src/ui/assets/css/theme-neutral.css", "src/ui/assets/css/theme-colors.css", "src/ui/assets/css/theme-base.css"],
      mappingFile: "src/ui/assets/css/theme-base.css",
      pairs: CONTRAST_PAIRS,
      criteria: CRITERION,
      // Deferred: resolving here would throw while this module is imported, before the runner exists to
      // report the step skipped. `import.meta.resolve` is called from this file so it finds this project's copy.
      palettePath: () => fileURLToPath(import.meta.resolve("tailwindcss/theme.css")),
      accepted: ACCEPTED_CONTRAST,
    },
    { tier: "standard" },
  ),
  cssSourcesStep(
    {
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
      consumerScanned: new Map([["show", '@source "../../node_modules/@y-core/forge/src/ui/show";']]),
    },
    { tier: "standard" },
  ),
  // Beside `cssSourcesStep` rather than beside the two generator steps it shares a compile with: this
  // one judges what the stylesheets declare, not whether a generated file has drifted.
  cssTokensStep({ root: ROOT, stylesheet: "src/ui/assets/css/tailwind.css", cssDir: "src/ui/assets/css" }, { tier: "standard" }),
  // Two steps rather than one: an index that will not build and a query that stopped finding its
  // answer fail for different reasons, and a reader has to be told which to fix.
  wardenStep({ root: ROOT, kind: "libs" }, { tier: "standard" }),
  wardenQueriesStep({ root: ROOT, kind: "libs" }, { tier: "standard" }),
  duplicatesStep({ root: ROOT, kind: "libs" }, { tier: "standard" }),
  browserStep({ tier: "full" }),
  workerdStep({ tier: "full" }),
];

export default STEPS;
