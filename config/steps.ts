/** The single source of truth for what forge's verification gate runs, and each check's config. */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "../package.json" with { type: "json" };
import { resolveAppRoot } from "../src/tooling/cli/mod";
import {
  browserStep,
  changelogStep,
  classGroupsStep,
  classOrderStep,
  classTokensStep,
  coLocationStep,
  contrastStep,
  cssSourcesStep,
  cssTokensStep,
  designScaleStep,
  designStep,
  FORGE_STATE_RECIPES,
  docsStep,
  type ExportsMap,
  exportsStep,
  formatStep,
  jsxStep,
  lintPluginStep,
  lintStep,
  modernCssStep,
  namespaceGraphStep,
  readmeExportsStep,
  type Step,
  buildTimeBoundaryStep,
  ssrBoundaryStep,
  testStep,
  typeAwareLintStep,
  typecheckStep,
} from "../src/tooling/gate/mod";
import { ACCEPTED_CONTRAST } from "../src/ui/contracts/theme/contrast-accepted";
import { CONTRAST_PAIRS, CRITERION } from "../src/ui/contracts/theme/contrast-pairs";
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
  lintStep({ sources: ["src/", "config/"] }),
  formatStep({ sources: ["."] }),
  typeAwareLintStep({ sources: ["src/", "config/"], tier: "standard" }),
  testStep(),
  exportsStep(
    {
      root: ROOT,
      packageName: pkg.name,
      exports: EXPORTS,
      files: pkg.files,
      // Listed subpaths reach DOM globals at import time, so only their runtime import is withheld;
      // static parsing still runs.
      browserOnly: ["./ui/chrome/client", "./ui/client", "./ui/client/htmx", "./ui/core/client", "./ui/show/client"],
      sideEffectOnly: ["./jsx/register"],
      sealedInternal: ["src/crypto/mod.ts"],
      assetDirs: [{ dir: "src/ui/assets/css", extension: ".css" }],
    },
    { tier: "standard" },
  ),
  namespaceGraphStep(
    {
      root: ROOT,
      exports: EXPORTS,
      graph: { primitives: PRIMITIVES, leaf: LEAF, edges: EDGES },
      sealedInternal: ["src/crypto/mod.ts"],
      enumerationDoc: ".decisions/implementation/NAMESPACES.md",
    },
    { tier: "standard" },
  ),
  jsxStep({ root: ROOT }, { tier: "standard" }),
  // CLAUDE.md requires co-located tests and nothing enforced it, which is how a `bind.test.ts`
  // could vanish in a refactor with no signal at all.
  coLocationStep(
    {
      root: ROOT,
      sources: ["src"],
      // A path here that names no walked module fails the check, so the list can only shrink.
      exempt: [
        // `bind-contract`'s one function is covered where it is used, by `client/bind-display.test.ts`.
        "src/ui/contracts/bind-contract.ts",
        "src/ui/contracts/alert-contract.ts",
        "src/ui/contracts/composite-contract.ts",
        "src/ui/contracts/dialog-contract.ts",
        "src/ui/contracts/island-contract.ts",
        "src/ui/contracts/navbar-contract.ts",
        "src/ui/contracts/number-field-contract.ts",
        "src/ui/contracts/overlay-contract.ts",
        "src/ui/contracts/scope-events.ts",
        "src/ui/contracts/slider-contract.ts",
        "src/ui/contracts/tabs-contract.ts",
        "src/ui/contracts/theme-toggle-contract.ts",
        "src/ui/contracts/theme/contrast-accepted.ts",
        "src/ui/contracts/theme/contrast-pairs.ts",
        "src/ui/contracts/toast-contract.ts",
        "src/ui/contracts/toggle-contract.ts",
        "src/ui/contracts/toolbar-contract.ts",
        "src/ui/contracts/turnstile-contract.ts",
        "src/ui/show/coverage-missing.ts",
        "src/ui/design/catalog-missing.ts",
        "src/ui/show/lazy-contract.ts",
        "src/ui/show/scope-contract.ts",
        "src/ui/show/toast-contract.ts",
        // Test infrastructure and a vendor side-effect import: neither has behaviour of its own.
        "src/ui/client/browser-test-helper.ts",
        "src/ui/client/test-dom.ts",
        "src/ui/client/htmx.ts",
        "src/tooling/lint/test-support.ts",
        "src/test-setup.ts",
        // Type declarations only. Each was read for a smuggled helper before being listed; one that
        // grows a function stops being exempt.
        "src/app/types.ts",
        "src/tooling/cf/account/handlers/types.ts",
        "src/tooling/cli/types.ts",
        "src/tooling/lint/types.ts",
        "src/form/types.ts",
        "src/jsx/types.ts",
        "src/security/types.ts",
        "src/storage/db/types.ts",
        "src/storage/kv/types.ts",
        "src/storage/r2/types.ts",
        // Declared data: constant tables and, for `design-scale`, a generated file.
        "src/tooling/cf/types.ts",
        "src/tooling/lint/data/design-scale.ts",
        "src/form/constants.ts",
        // Executable entry points — argv in, `process.exit` out. What they wire is tested where it lives.
        "src/tooling/assets/bin.ts",
        "src/tooling/release/bin.ts",
        "src/tooling/root/bin.ts",
      ],
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
    { root: ROOT, packageName: pkg.name, exports: EXPORTS, buildTimeDirs: ["src/tooling", "src/ui/assets/build"], sources: ["src"] },
    { tier: "standard" },
  ),
  // `.decisions/governance/` is overwrite-on-sync, so an edit made in place is reverted by the next
  // sync and the reversion looks like nobody's change. Its fixer is the sync itself.
  { label: "governance", tier: "standard", tail: 20, cmd: ["gov", "sync", "--check"], fix: ["gov", "sync"] },
  docsStep(
    {
      root: ROOT,
      packageName: pkg.name,
      exports: EXPORTS,
      extraDirs: [".claude/agents"],
      documentedNonExports: ["./auth", "./handler", "./all", "./crypto"],
      // Written by the compiler and by build configuration, never by a consumer, so a documented row
      // for any of them would advertise an import the reader must not write.
      tableExemptSubpaths: ["./jsx/jsx-runtime", "./jsx/jsx-dev-runtime", "./jsx/register"],
    },
    { tier: "standard" },
  ),
  // `validate-docs` holds the governing documents against the subpath catalog; this holds one
  // README's per-subpath tables against the barrels, and a section opts in via `> Import path:`.
  readmeExportsStep(
    {
      root: ROOT,
      readmes: ["src/ui/README.md", "src/storage/README.md", "src/testing/README.md"],
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
  // `src/ui/design` is excluded for the reason it is not `@source`-scanned either: its samples are
  // counter-examples quoting the exact patterns this check forbids.
  modernCssStep({ root: ROOT, sources: ["src/ui", "!src/ui/design"] }, { tier: "standard" }),
  // The excluded specs pin `cn`'s own resolution or this check's own detection, so their fixtures
  // are deliberately self-conflicting literals — the very input the rule forbids everywhere else.
  classOrderStep(
    {
      root: ROOT,
      sources: [
        "src",
        "!src/tooling/gate/checks/class-order.test.ts",
        "!src/tooling/gate/checks/design-parse.test.ts",
        "!src/tooling/gate/checks/source-scan.test.ts",
        "!src/ui/core/form.test.tsx",
      ],
    },
    { tier: "standard" },
  ),
  // `src/ui/design` is excluded for the same reason `modernCssStep` excludes it: its samples quote
  // the very tokens it teaches against. The check reads every literal, not only class positions.
  classTokensStep({ root: ROOT, sources: ["src/ui", "!src/ui/design"], stylesheet: "src/ui/assets/css/tailwind.css" }, { tier: "standard" }),
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
        // Not `@source`-scanned: half the corpus's samples are counter-examples quoting the exact
        // classes it forbids, so scanning would compile forge's anti-patterns into consumer stylesheets.
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
  browserStep({ tier: "full" }),
];

export default STEPS;
