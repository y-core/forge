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
  contrastStep,
  cssSourcesStep,
  designStep,
  docsStep,
  type ExportsMap,
  exportsStep,
  jsxStep,
  lintStep,
  namespaceGraphStep,
  type Step,
  testStep,
  typecheckStep,
} from "../src/pkg/mod";
import { ACCEPTED_CONTRAST } from "../src/ui/contracts/contrast-accepted";
import { CONTRAST_PAIRS, CRITERION } from "../src/ui/contracts/contrast-pairs";
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
    enumerationDoc: ".decisions/NAMESPACE_DESIGN.md",
  }),
  jsxStep({ root: ROOT }),
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
  changelogStep({ root: ROOT, packageVersion: pkg.version }),
  designStep({ root: ROOT, packageName: pkg.name, exports: EXPORTS, designDir: "src/ui/design", cssDir: "src/ui/assets/css" }),
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
  browserStep(),
];

export default STEPS;
