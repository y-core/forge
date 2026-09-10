import {
  assetManifestStep,
  assetRootStep,
  browserStep,
  classOrderStep,
  classTokensStep,
  cssTokensStep,
  exportsStep,
  formatStep,
  jsxStep,
  lintStep,
  modernCssStep,
  testStep,
  typecheckStep,
  workerdStep,
} from "./builders";
import type { Step } from "./types";
import type { CloudflareWorkerStepOptions, LibraryStepOptions } from "./types";

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

  // Opt-in: the step runs `warden`, which an app that does not clone the `.claude/` trees has no
  // reason to run even though forge ships it.
  if (options.warden) {
    steps.push({ label: "warden", tail: 20, cmd: ["warden", "sync", "--check"], fix: ["warden", "sync"] });
  }

  // Opt-in: an app that uses forge for routing but not `ui/*` gets no rows and needs no
  // `tailwindcss` peer. `sources` is the design default rather than the table's, because
  // `classOrderStep` reads every `.tsx` including specs, whose literals are deliberately conflicting.
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

  steps.push(testStep({ sources: tests }));

  // Both halves of the coupling have to be present to compare them: the assets config names what is
  // written to the asset root, the wrangler config names what the Worker is kept out of.
  if (options.assetConfig !== undefined && options.workerConfig !== undefined) {
    steps.push(assetRootStep({ root, assetConfig: options.assetConfig, workerConfig: options.workerConfig }));
  }

  // Last, and stated at the call site so the table can be read without opening `builders.ts`.
  if (options.browser) steps.push(browserStep({ tier: "full" }));
  if (options.workerd) steps.push(workerdStep({ tier: "full" }));

  return steps;
}

/** The baseline table for a library published under an `exports` map, in execution order.
 *  The documentation and changelog rows are warden's — add `docsStep` and `changelogStep` from
 *  `@y-core/forge/warden` to this table; they cannot be emitted here without `src` importing warden. @public */
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
