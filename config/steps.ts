/** The single source of truth for what forge's verification gate runs, and each check's config.
 *
 *  Loaded by `forge-verify` through its default export. Every step is a pre-built builder from the
 *  `pkg` namespace; a step with no `fullOnly` runs in every mode.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };
import { resolveAppRoot } from "../src/cli/mod";
import {
  browserStep,
  changelogStep,
  coLocationStep,
  contrastStep,
  cssSourcesStep,
  designStep,
  docsStep,
  type ExportsMap,
  exportsStep,
  jsxStep,
  lintStep,
  modernCssStep,
  namespaceGraphStep,
  type Step,
  ssrBoundaryStep,
  testStep,
  typecheckStep,
} from "../src/pkg/mod";
import { ACCEPTED_CONTRAST } from "../src/ui/contracts/theme/contrast-accepted";
import { CONTRAST_PAIRS, CRITERION } from "../src/ui/contracts/theme/contrast-pairs";
import { EDGES, LEAF, PRIMITIVES } from "./namespaces";

// Derived from this file's location, never `process.cwd()`, so the table resolves the same paths
// whichever directory `forge-verify` was invoked from. forge cannot use `resolveAppRoot`'s derived
// branch: it has no `node_modules/@y-core/forge` above its own source.
/** Repository root. */
export const ROOT = resolveAppRoot(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const EXPORTS = pkg.exports as ExportsMap;

// `typecheck` runs first because a type failure cascades into misleading lint and test failures.
/** The gate's steps, in execution order. */
export const STEPS: readonly Step[] = [
  typecheckStep(),
  lintStep({ sources: ["src/", "config/"] }),
  testStep(),
  exportsStep({
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
  }),
  namespaceGraphStep({
    root: ROOT,
    exports: EXPORTS,
    graph: { primitives: PRIMITIVES, leaf: LEAF, edges: EDGES },
    sealedInternal: ["src/crypto/mod.ts"],
    enumerationDoc: ".decisions/implementation/NAMESPACES.md",
  }),
  jsxStep({ root: ROOT }),
  // CLAUDE.md requires co-located tests and nothing enforced it, which is how a `bind.test.ts`
  // could vanish in a refactor with no signal at all.
  coLocationStep({
    root: ROOT,
    sources: ["src/ui"],
    // Every exemption is a module that declares data and no behaviour: a test could only restate
    // the constant it names. Anything with a function in it is not on this list.
    exempt: [
      // `bind-contract`'s one function is covered where it is used, by `client/bind-display.test.ts`.
      "src/ui/contracts/bind-contract.ts",
      "src/ui/contracts/composite-contract.ts",
      "src/ui/contracts/dialog-contract.ts",
      "src/ui/contracts/navbar-contract.ts",
      "src/ui/contracts/number-field-contract.ts",
      "src/ui/contracts/overlay-contract.ts",
      "src/ui/contracts/scope-events.ts",
      "src/ui/contracts/slider-contract.ts",
      "src/ui/contracts/tabs-contract.ts",
      "src/ui/contracts/theme/contrast-accepted.ts",
      "src/ui/contracts/theme/contrast-pairs.ts",
      "src/ui/contracts/toggle-contract.ts",
      "src/ui/contracts/toolbar-contract.ts",
      "src/ui/contracts/turnstile-contract.ts",
      "src/ui/show/coverage-missing.ts",
      "src/ui/show/lazy-contract.ts",
      // Test infrastructure and a vendor side-effect import: neither has behaviour of its own.
      "src/ui/client/browser-test-helper.ts",
      "src/ui/client/test-dom.ts",
      "src/ui/client/htmx.ts",
    ],
  }),
  // Runs in every mode, and deliberately: `namespaces.ts` declares `ui/core → ui/client` once for
  // the whole namespace — an edge `core/client.ts` genuinely needs — and that one declaration would
  // otherwise license every component in it to import browser code that throws inside a Worker.
  ssrBoundaryStep({
    root: ROOT,
    clientDir: "src/ui/client",
    sources: ["src/ui"],
    // The registration entry points, and nothing else: each exists to pull the client runtime in.
    entryPoints: ["client.ts"],
  }),
  docsStep({
    root: ROOT,
    packageName: pkg.name,
    exports: EXPORTS,
    extraDirs: [".claude/agents"],
    documentedNonExports: ["./auth", "./handler", "./all", "./crypto"],
    // Written by the compiler and by build configuration, never by a consumer, so a documented row
    // for any of them would advertise an import the reader must not write.
    tableExemptSubpaths: ["./jsx/jsx-runtime", "./jsx/jsx-dev-runtime", "./jsx/register"],
  }),
  // `fullOnly` is stated here rather than inherited from the builder's default: this file calls
  // itself the single source of truth for which steps run in which mode, so a reader must be able
  // to answer that from this table alone.
  changelogStep({ root: ROOT, packageVersion: pkg.version }, { fullOnly: true }),
  designStep({ root: ROOT, packageName: pkg.name, exports: EXPORTS, designDir: "src/ui/design", cssDir: "src/ui/assets/css" }),
  // `src/ui/design` is excluded for the reason it is not `@source`-scanned either: half the corpus's
  // samples are counter-examples quoting the exact patterns this check forbids, so scanning it would
  // flag its own documentation.
  modernCssStep({ root: ROOT, sources: ["src/ui", "!src/ui/design"] }),
  contrastStep({
    root: ROOT,
    cssDir: "src/ui/assets/css",
    tokenFiles: ["src/ui/assets/css/theme-neutral.css", "src/ui/assets/css/theme-colors.css", "src/ui/assets/css/theme-base.css"],
    mappingFile: "src/ui/assets/css/theme-base.css",
    pairs: CONTRAST_PAIRS,
    criteria: CRITERION,
    palettePath: fileURLToPath(import.meta.resolve("tailwindcss/theme.css")),
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
      // Not `@source`-scanned: half the corpus's samples are counter-examples quoting the exact
      // classes it forbids, so scanning would compile forge's anti-patterns into consumer stylesheets.
      ["design", "design corpus — markdown only, and its samples deliberately quote forbidden classes"],
      ["server", "SSR helpers that delegate to core/ components for all markup"],
    ]),
    consumerScanned: new Map([["show", '@source "../../node_modules/@y-core/forge/src/ui/show";']]),
  }),
  browserStep({ fullOnly: true }),
];

export default STEPS;
