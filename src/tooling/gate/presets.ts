import { existsSync, readdirSync } from "node:fs";
import { posix, resolve } from "node:path";

import { assetInputs } from "../assets/inputs";
import { CliError } from "../cli/errors";
import { worktreeFiles } from "../cli/worktree";
import { loadFeatures } from "../curate/config";
import {
  assetManifestStep,
  assetRootStep,
  browserSteps,
  checkStep,
  classOrderStep,
  classTokensStep,
  compatibilityStep,
  contrastStep,
  cssCoverageStep,
  cssTokensStep,
  dbSteps,
  devBoundaryStep,
  devBundleStep,
  exportsStep,
  exposureStep,
  importBoundaryStep,
  formatStep,
  jsxStep,
  lintStep,
  markdownStep,
  modernCssStep,
  sourceWatches,
  ssrBoundaryStep,
  featuresStep,
  testStep,
  typeAwareLintStep,
  typecheckStep,
  workerdStep,
} from "./builders";
import { checkImportBoundary } from "./checks/import-boundary";
import { isTestSource } from "./checks/source-scan";
import { isRecord, readWorkerConfig } from "./checks/worker-config";
import { workerMainClosure } from "./closure";
import { checkResult, fail } from "./finding";
import type { Step } from "./types";
import type { CloudflareWorkerStepOptions, LibraryStepOptions } from "./types";

/** The package whose `forge.devOnly` declaration the dev-boundary row reads — this one. */
const PACKAGE = "@y-core/forge";

const RUNTIME_TYPES = "./.types/cloudflare.d.ts";

const BINDING_TYPES = "./.types/worker-configuration.d.ts";

function besideVendor(root: string, vendorDir: string): string[] {
  const parent = posix.dirname(vendorDir);
  const full = resolve(root, parent);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => (entry.isDirectory() ? true : entry.isFile() && /\.tsx?$/.test(entry.name) && !isTestSource(entry.name)))
    .map((entry) => (parent === "." ? entry.name : `${parent}/${entry.name}`))
    .filter((path) => path !== vendorDir)
    .sort();
}

async function assetReach(cwd: string, assetConfig: string): Promise<string[]> {
  const files = worktreeFiles(cwd);
  if (files === undefined) throw new Error(`${cwd} is not inside a git work tree, so no listing meets the stylesheets' \`@source\``);
  return assetInputs(cwd, assetConfig, files);
}

async function servedAssetReach(cwd: string, workerConfig: string, assetConfig: string): Promise<string[]> {
  const read = readWorkerConfig(cwd, workerConfig, "asset reach");
  if (!("config" in read)) throw new Error(read.findings.map((finding) => finding.message).join("; "));
  return isRecord(read.config.assets) ? assetReach(cwd, assetConfig) : [];
}

async function unionReach(traces: readonly Promise<string[]>[]): Promise<string[]> {
  return [...new Set((await Promise.all(traces)).flat())].sort();
}

/** The step table every Cloudflare Worker app in this fleet shares, in execution order. @public */
export function cloudflareWorkerSteps(options: CloudflareWorkerStepOptions = {}): readonly Step[] {
  const sources = options.sources ?? ["src/", "tests/"];
  const tests = options.tests ?? ["tests/"];
  const assetOut = options.assetOut ?? ".forge/assets.ts";
  const root = options.root ?? process.cwd();

  const steps: Step[] = [];

  if (options.wranglerTypes !== false) {
    steps.push(
      { label: "types:cf-runtime", tail: 20, cmd: ["wrangler", "types", RUNTIME_TYPES, "--no-include-env"] },
      {
        label: "types:cf-bindings",
        tail: 20,
        cmd:
          options.workerConfig === undefined
            ? ["wrangler", "types", BINDING_TYPES, "--no-include-runtime"]
            : ["wrangler", "types", BINDING_TYPES, "--no-include-runtime", "--config", options.workerConfig],
      },
    );
  }

  if (options.assetConfig !== undefined) {
    steps.push({ label: "types:assets", tail: 20, cmd: ["forge", "assets", "gen", "types", "--config", options.assetConfig, "--out", assetOut] });
    // The step that may rewrite the artifact is followed by the one that judges it, before a
    // typecheck and a test run that would otherwise pass on a manifest ahead of the built tree.
    steps.push(assetManifestStep({ root, assetConfig: options.assetConfig, assetsPath: assetOut }));
  }

  steps.push(typecheckStep(), lintStep({ sources }), formatStep({ sources }));

  // Opt-in, unlike `forgeChecks`: a library's `.tsx` compiles under a *consumer's* tsconfig, so the
  // pragma rides on each file, where an application's compiles under its own and states it once.
  if (options.jsx !== undefined) {
    steps.push(jsxStep({ root, ...options.jsx }));
  }

  // Opt-in: `markdownStep` reads the prose oxfmt is told to ignore, so an app that takes it must add
  // `"**/*.md"` to its `.oxfmtrc.json` `ignorePatterns` — otherwise two tools own the same bytes.
  if (options.markdown !== undefined) {
    steps.push(markdownStep({ root, ...options.markdown }));
  }

  // After `format`, so the cheaper rows have already had their say, and before anything minutes long:
  // a run that is going to fail a sub-second type-aware finding should not pay for a browser first.
  steps.push(typeAwareLintStep({ sources }));

  // Opt-in: the step runs `warden`, which an app that does not clone the `.claude/` trees has no
  // reason to run even though forge ships it.
  if (options.warden) {
    steps.push({
      label: "warden",
      tail: 20,
      cmd: ["warden", "sync", "--check"],
      fix: ["warden", "sync"],
      watches: [".claude/**", "CLAUDE.md", "AGENTS.md"],
    });
  }

  // Opt-in: an app using forge for routing but not `ui/*` needs no `tailwindcss` peer. `sources` is the
  // design's own default, because `classOrderStep` reads every `.tsx` including specs, whose literals conflict deliberately.
  const design = options.design;
  if (design !== undefined) {
    const designSources = design.sources ?? ["src/"];
    steps.push(
      modernCssStep({ root, sources: designSources, deferred: design.deferred ?? [] }),
      classOrderStep({ root, sources: designSources }),
      classTokensStep({ root, sources: designSources, stylesheet: design.stylesheet }),
      cssCoverageStep({ root, sources: designSources, stylesheet: design.stylesheet }),
    );
    if (design.cssDir !== undefined) {
      steps.push(cssTokensStep({ root, stylesheet: design.stylesheet, cssDir: design.cssDir }));
    }
  }

  // A suite split by the question each set answers needs a label apiece, which is what `testSets`
  // supplies; without it the single `test` row stands.
  if (options.testSets === undefined) {
    steps.push(testStep({ sources: tests }));
  } else {
    for (const set of options.testSets) steps.push(testStep({ label: set.label, sources: set.sources }));
  }

  // Opt-in, because the rule it holds is a repository's own: which directories are browser-only, and
  // which basename is allowed to cross from the server side.
  if (options.ssrBoundary !== undefined) {
    const { serverDirs, ...ssrBoundary } = options.ssrBoundary;
    steps.push(ssrBoundaryStep({ root, ...ssrBoundary }));
    if (serverDirs !== undefined) {
      steps.push({ ...importBoundaryStep({ root, guarded: serverDirs, sources: ssrBoundary.clientDirs }), label: "validate-client-boundary" });
    }
  }

  // Opt-in for the same reason: which trees are one-way, and which files may cross into them, is a
  // repository's own rule.
  const importBoundary = options.importBoundary;
  if (importBoundary !== undefined && options.features !== undefined) {
    steps.push(
      checkStep(
        "validate-import-boundary",
        async () => {
          try {
            return checkImportBoundary({ root, ...importBoundary, features: await loadFeatures({ root }) });
          } catch (error) {
            if (!(error instanceof CliError)) throw error;
            return checkResult([fail(error.message)], "");
          }
        },
        { watches: sourceWatches([...(importBoundary.sources ?? ["src"]), ...importBoundary.guarded]) },
      ),
    );
  } else if (importBoundary !== undefined) {
    steps.push(importBoundaryStep({ root, ...importBoundary }));
  }

  if (options.vendorDir !== undefined) {
    const vendorDir = options.vendorDir.replace(/\/+$/, "");
    steps.push(
      checkStep(
        "validate-vendor-boundary",
        () => checkImportBoundary({ root, guarded: besideVendor(root, vendorDir), sources: [vendorDir] }),
        {},
        { watches: sourceWatches([posix.dirname(vendorDir)]) },
      ),
    );
  }

  // Opt-in: the audit refuses to report a green gate that measured nothing, so it needs the pairs a
  // repository actually draws.
  if (options.contrast !== undefined) {
    steps.push(contrastStep({ root, ...options.contrast }));
  }

  // Both halves of the coupling have to be present to compare them: the assets config names what is
  // written to the asset root, the wrangler config names what the Worker is kept out of.
  if (options.assetConfig !== undefined && options.workerConfig !== undefined) {
    steps.push(assetRootStep({ root, assetConfig: options.assetConfig, workerConfig: options.workerConfig }));
  }

  // Only the wrangler config is read here, so these rows need no assets half of the coupling. The flag
  // row is not opt-in beside it: an app free to decline it decides its own Node surface, which is the folklore.
  if (options.workerConfig !== undefined) {
    steps.push(exposureStep({ root, workerConfig: options.workerConfig, ...options.exposure }));
    steps.push(compatibilityStep({ root, workerConfig: options.workerConfig, ...options.compatibility }));
  }

  // Default-on and not opt-out: the forbidden specifiers are read from forge's own installed manifest,
  // so the check needs no configuration to know `@y-core/forge/testing` loses every write in a deployed bundle.
  const devTrees = { root, ...(options.workerConfig === undefined ? {} : { workerConfig: options.workerConfig }), packages: [PACKAGE] };
  steps.push(devBoundaryStep(devTrees));
  // Deploy tier: it runs esbuild over the whole Worker, where the row above only reads import statements.
  steps.push(devBundleStep(devTrees));

  // Last, and stated at the call site so the table can be read without opening `builders.ts`.
  // A spec reaches the app through the Worker and any assets it serves, never an import, so a change to either runs the row whole.
  const workerConfig = options.workerConfig ?? "wrangler.jsonc";
  const assetConfig = options.assetConfig;
  const workerTrace = (cwd: string): Promise<string[]> => workerMainClosure(cwd, workerConfig);
  const workerdWiden =
    assetConfig === undefined
      ? workerTrace
      : (cwd: string): Promise<string[]> => unionReach([workerTrace(cwd), servedAssetReach(cwd, workerConfig, assetConfig)]);
  if (options.db) steps.push(...dbSteps({ root }));
  if (options.browser === true) steps.push(...browserSteps({ engines: ["chromium"] }));
  else if (options.browser !== undefined && options.browser !== false) steps.push(...browserSteps({ engines: options.browser.engines }));
  if (options.workerd) steps.push(workerdStep({ widen: workerdWiden }));
  if (options.features !== undefined) {
    const assets = options.assetConfig === undefined ? {} : { assetConfig: options.assetConfig, assetOut };
    steps.push(featuresStep({ root, ...options.features, ...assets }));
  }

  return steps;
}

/** The baseline table for a library published under an `exports` map, in execution order. @public */
export function forgeChecks(options: LibraryStepOptions): readonly Step[] {
  const { root, pkg } = options;
  const derived = { root, packageName: pkg.name, exports: pkg.exports };

  return [
    typecheckStep(),
    lintStep({ sources: options.sources ?? ["src/"] }),
    formatStep({ sources: options.sources ?? ["src/"] }),
    testStep({ sources: options.tests ?? [] }),
    exportsStep({ ...derived, files: pkg.files, ...options.exports }),
    jsxStep({ root, ...options.jsx }),
    classOrderStep({ root, sources: ["src"], ...options.classOrder }),
  ];
}
