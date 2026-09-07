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
} from "./builders";
import type { ClassOrderCheckConfig } from "./checks/class-order";
import type { ExportsCheckConfig, ExportsMap } from "./checks/exports";
import type { JsxCheckConfig } from "./checks/jsx";
import type { DeferredFinding } from "./checks/modern-css-deferred";
import type { Step } from "./steps";

const RUNTIME_TYPES = "./.types/cloudflare.d.ts";

const BINDING_TYPES = "./.types/worker-configuration.d.ts";

/** The design rows a Worker app opts into, and the paths they read. @public */
export interface CloudflareWorkerDesignOptions {
  /** The stylesheet the design system compiles from. Three of the four rows need it. */
  stylesheet: string;
  /** Directory of stylesheets the token check reads; omit to skip `validate-css-tokens`. */
  cssDir?: string;
  /** Sources the class rules scan. Defaults to `["src/"]` — deliberately not the table's `sources`. */
  sources?: readonly string[];
  /** Platform-CSS findings this app defers. Defaults to `[]`, never forge's own list. */
  deferred?: readonly DeferredFinding[];
}

/** Options for the shared Cloudflare Worker step table. @public */
export interface CloudflareWorkerStepOptions {
  /** Directories linted and type-checked. Defaults to `["src/", "tests/"]`. */
  sources?: readonly string[];
  /** Test paths passed to `bun test`. Defaults to `["tests/"]`. */
  tests?: readonly string[];
  /** Asset config path; omit to skip the asset-types step entirely. */
  assetConfig?: string;
  /** Where the asset-types emitter writes. Defaults to `.forge/assets.ts`. */
  assetOut?: string;
  /** Whether to emit the two `wrangler types` steps. Defaults to `true`. */
  wranglerTypes?: boolean;
  /** `--config` for the bindings invocation; the runtime invocation takes none. */
  workerConfig?: string;
  /** Whether to check the synced `.claude/` trees against the installed corpus. Defaults to `false`. */
  warden?: boolean;
  /** Application root, needed by the asset-root and design checks. Defaults to `process.cwd()`. */
  root?: string;
  /** Whether to emit the `full`-tier `test:browser` step. Defaults to `false`. */
  browser?: boolean;
  /** Omit to emit no design rows, so an app that does not use `ui/*` needs no `tailwindcss` peer. */
  design?: CloudflareWorkerDesignOptions;
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

  return steps;
}

/** The fields `forgeChecks` reads from the consuming package's `package.json`. @public */
export interface GatePackage {
  name: string;
  version: string;
  exports: ExportsMap;
  files: readonly string[];
}

/** Options for the shared library step table. @public */
export interface LibraryStepOptions {
  /** Repository root. Every check resolves and reports its paths against it. */
  root: string;
  /** The consuming package's `package.json`, read for its name, version, `exports`, and `files`. */
  pkg: GatePackage;
  /** Directories linted. Defaults to `["src/"]`. */
  sources?: readonly string[];
  /** Test paths passed to `bun test`. Defaults to the whole project. */
  tests?: readonly string[];
  /** Merged over the exports config derived from `pkg`. */
  exports?: Omit<Partial<ExportsCheckConfig>, "root">;
  /** Merged over the jsx config derived from `root`. */
  jsx?: Omit<Partial<JsxCheckConfig>, "root">;
  /** Merged over the class-order config derived from `root`; `sources` defaults to `["src"]`. */
  classOrder?: Omit<Partial<ClassOrderCheckConfig>, "root">;
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
