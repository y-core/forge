import { changelogStep, docsStep, exportsStep, jsxStep, lintStep, testStep, typecheckStep } from "./builders";
import type { ChangelogCheckConfig } from "./checks/changelog";
import type { DocsCheckConfig } from "./checks/docs";
import type { ExportsCheckConfig, ExportsMap } from "./checks/exports";
import type { JsxCheckConfig } from "./checks/jsx";
import type { Step } from "./steps";

const RUNTIME_TYPES = "./.types/cloudflare.d.ts";

const BINDING_TYPES = "./.types/worker-configuration.d.ts";

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
}

/** The step table every Cloudflare Worker app in this fleet shares, in execution order. @public */
export function cloudflareWorkerSteps(options: CloudflareWorkerStepOptions = {}): readonly Step[] {
  const sources = options.sources ?? ["src/", "tests/"];
  const tests = options.tests ?? ["tests/"];
  const assetOut = options.assetOut ?? ".forge/assets.ts";

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
    steps.push({ label: "types:assets", tail: 20, cmd: ["forge-assets", "types", "--config", options.assetConfig, "--out", assetOut] });
  }

  steps.push(typecheckStep(), lintStep({ sources }), testStep({ sources: tests }));

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
  /** Merged over the docs config derived from `pkg`. */
  docs?: Omit<Partial<DocsCheckConfig>, "root">;
  /** Merged over the jsx config derived from `root`. */
  jsx?: Omit<Partial<JsxCheckConfig>, "root">;
  /** Merged over the changelog config derived from `pkg`. */
  changelog?: Omit<Partial<ChangelogCheckConfig>, "root">;
}

/** The baseline table for a library published under an `exports` map, in execution order. @public */
export function forgeChecks(options: LibraryStepOptions): readonly Step[] {
  const { root, pkg } = options;
  const derived = { root, packageName: pkg.name, exports: pkg.exports };

  return [
    typecheckStep(),
    lintStep({ sources: options.sources ?? ["src/"] }),
    testStep({ sources: options.tests ?? [] }),
    exportsStep({ ...derived, files: pkg.files, ...options.exports }),
    jsxStep({ root, ...options.jsx }),
    docsStep({ ...derived, ...options.docs }),
    changelogStep({ root, packageVersion: pkg.version, ...options.changelog }),
  ];
}
