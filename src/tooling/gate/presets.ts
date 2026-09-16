import {
  assetManifestStep,
  assetRootStep,
  browserStep,
  classOrderStep,
  classTokensStep,
  contrastStep,
  cssTokensStep,
  dbSchemaStep,
  devBoundaryStep,
  exportsStep,
  exposureStep,
  formatStep,
  jsxStep,
  lintStep,
  markdownStep,
  modernCssStep,
  ssrBoundaryStep,
  testStep,
  typeAwareLintStep,
  typecheckStep,
  workerdStep,
} from "./builders";
import type { Step } from "./types";
import type { CloudflareWorkerStepOptions, LibraryStepOptions } from "./types";

/** The package whose `forge.devOnly` declaration the dev-boundary row reads — this one. */
const PACKAGE = "@y-core/forge";

const RUNTIME_TYPES = "./.types/cloudflare.d.ts";

const BINDING_TYPES = "./.types/worker-configuration.d.ts";

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
    steps.push(markdownStep({ root, ...options.markdown }, { tier: "standard" }));
  }

  // After `format`, so the fast rows have already had their say, and before anything minutes long: a
  // run that is going to fail a sub-second type-aware finding should not pay for a browser first.
  steps.push(typeAwareLintStep({ sources, tier: "standard" }));

  // Opt-in: the step runs `warden`, which an app that does not clone the `.claude/` trees has no
  // reason to run even though forge ships it.
  if (options.warden) {
    steps.push({ label: "warden", tail: 20, cmd: ["warden", "sync", "--check"], fix: ["warden", "sync"] });
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
    steps.push(ssrBoundaryStep({ root, ...options.ssrBoundary }));
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

  // Only the wrangler config is read here, so this row needs no assets half of the coupling.
  if (options.workerConfig !== undefined) {
    steps.push(exposureStep({ root, workerConfig: options.workerConfig, ...options.exposure }));
  }

  // Default-on and not opt-out: the forbidden specifiers are read from forge's own installed manifest,
  // so the check needs no configuration to know `@y-core/forge/testing` loses every write in a deployed bundle.
  steps.push(
    devBoundaryStep(
      { root, ...(options.workerConfig === undefined ? {} : { workerConfig: options.workerConfig }), packages: [PACKAGE] },
      { tier: "standard" },
    ),
  );

  // Last, and stated at the call site so the table can be read without opening `builders.ts`.
  if (options.db) steps.push(...dbSchemaStep({ root }));
  if (options.browser) steps.push(browserStep({ tier: "full" }));
  if (options.workerd) steps.push(workerdStep({ tier: "full" }));

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
