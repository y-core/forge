import { existsSync, readdirSync } from "node:fs";
import { posix, resolve } from "node:path";

import { CliError } from "../cli/errors";
import { loadFeatures } from "../curate/config";
import {
  assetManifestStep,
  assetRootStep,
  browserStep,
  checkStep,
  classOrderStep,
  classTokensStep,
  compatibilityStep,
  configFileStep,
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
  testStep,
  typeAwareLintStep,
  typecheckStep,
  workerdStep,
} from "./builders";
import { checkImportBoundary } from "./checks/import-boundary";
import { isTestSource } from "./checks/source-scan";
import { checkResult, fail } from "./finding";
import { tier } from "./tiers";
import type { Step, StepTiers } from "./types";
import type { CloudflareWorkerStepOptions, LibraryStepOptions } from "./types";

/** The package whose `forge.devOnly` declaration the dev-boundary row reads — this one. */
const PACKAGE = "@y-core/forge";
const RELAX_ALIAS = "#app/relax";

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

/** The step table every Cloudflare Worker app in this fleet shares, by tier. @public */
export function cloudflareWorkerSteps(options: CloudflareWorkerStepOptions = {}): StepTiers {
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

  // Opt-in: `markdownStep` reads the prose `bun fmt` is told to ignore, so an app that takes it must add
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
  if (options.importBoundary !== undefined) {
    const { features, ...importBoundary } = options.importBoundary;
    steps.push(
      features === true
        ? checkStep(
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
          )
        : importBoundaryStep({ root, ...importBoundary }),
    );
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
  steps.push(devBoundaryStep({ ...devTrees, relaxAlias: RELAX_ALIAS }));
  if (options.configFiles !== false) steps.push(configFileStep({ root }));

  // A suite split by the question each set answers needs a label apiece, which is what `testSets`
  // supplies; without it the single `test` row stands.
  const testRows =
    options.testSets === undefined
      ? [testStep({ sources: tests })]
      : options.testSets.map((set) => testStep({ label: set.label, sources: set.sources }));

  const db = options.db ? dbSteps({ root }) : undefined;
  return {
    static: [...steps, ...(db?.static ?? [])],
    unit: [tier("static"), ...testRows],
    runtime: [tier("unit"), ...(db?.runtime ?? [])],
    // Scheduled tier: it runs esbuild over the whole Worker, where the dev-boundary row only reads import statements.
    scheduled: [
      tier("runtime"),
      devBundleStep(devTrees),
      ...(options.browser === true ? [browserStep()] : []),
      ...(options.workerd ? [workerdStep()] : []),
    ],
  };
}

/** The baseline table for a library published under an `exports` map, by tier. @public */
export function forgeChecks(options: LibraryStepOptions): StepTiers {
  const { root, pkg } = options;
  const derived = { root, packageName: pkg.name, exports: pkg.exports };

  return {
    static: [
      typecheckStep(),
      lintStep({ sources: options.sources ?? ["src/"] }),
      formatStep({ sources: options.sources ?? ["src/"] }),
      exportsStep({ ...derived, files: pkg.files, ...options.exports }),
      jsxStep({ root, ...options.jsx }),
      classOrderStep({ root, sources: ["src"], ...options.classOrder }),
      ...(options.configFiles === false ? [] : [configFileStep({ root })]),
    ],
    unit: [tier("static"), testStep({ sources: options.tests ?? [] })],
    runtime: [tier("unit")],
    scheduled: [tier("runtime")],
  };
}
