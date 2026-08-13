/** presets.ts — ready-made step tables.
 *
 *  A preset is a *factory*, not machinery: it returns an ordinary `Step[]` an app spreads into
 *  its own table and appends to. Nothing here is privileged — an app that outgrows a preset
 *  writes the rows out by hand and loses nothing.
 */

import type { Step } from "./steps";

const CHECK_AND_VERIFY: readonly ["check", "verify"] = ["check", "verify"];

/** Knobs on the shared Cloudflare Worker table. Every one is a path the fleet's apps genuinely
 *  disagree about; anything they agree on is baked in rather than exposed.
 *
 * @public
 */
export interface CloudflareWorkerStepOptions {
  /** Directories linted and type-checked. Defaults to `["src/", "tests/"]`. */
  sources?: readonly string[];
  /** Test paths passed to `bun test`. Defaults to `["tests/"]`. */
  tests?: readonly string[];
  /** Asset config path; omit to skip the asset-types step entirely. */
  assetConfig?: string;
  /** Extra `wrangler types` invocation for a second wrangler config. */
  workerConfig?: string;
}

/** The step table every Cloudflare Worker app in this fleet shares, in execution order:
 *  `cf:typecheck` → `types:assets` → `typecheck` → `lint` → `test`.
 *
 *  Generation leads: `wrangler types` and the asset-types emitter both write files `typecheck`
 *  then reads, so a stale generated type surfaces as a type error rather than as a silently
 *  green run over yesterday's bindings.
 *
 *  Spread it and append app-specific steps. **Every step is prerequisite-free**, so the whole
 *  preset is legal in `check` — see `.decisions/TESTING.md` §6c.
 *
 * @public
 */
export function cloudflareWorkerSteps(options: CloudflareWorkerStepOptions = {}): readonly Step[] {
  const sources = options.sources ?? ["src/", "tests/"];
  const tests = options.tests ?? ["tests/"];

  const steps: Step[] = [
    {
      label: "cf:typecheck",
      gates: CHECK_AND_VERIFY,
      tail: 20,
      cmd: options.workerConfig === undefined ? ["wrangler", "types"] : ["wrangler", "types", "--config", options.workerConfig],
    },
  ];

  if (options.assetConfig !== undefined) {
    steps.push({ label: "types:assets", gates: CHECK_AND_VERIFY, tail: 20, cmd: ["forge-assets", "types", "--config", options.assetConfig] });
  }

  steps.push(
    // First of the three judging steps, deliberately: a type failure cascades into misleading
    // lint and test failures, so fail-fast ordering encodes "fix types first" rather than
    // leaving it to the reader.
    { label: "typecheck", gates: CHECK_AND_VERIFY, tail: 20, cmd: ["tsgo", "--noEmit"] },
    { label: "lint", gates: CHECK_AND_VERIFY, tail: 20, cmd: ["biome", "check", ...sources], fix: ["biome", "check", "--write", ...sources] },
    // 120 rather than 40: console output from suites that run late fills a narrow window and
    // pushes the `(fail)` blocks out of it. The tail is a probability reduction, not the fix —
    // that is the full-log path the runner prints beneath it.
    { label: "test", gates: CHECK_AND_VERIFY, tail: 120, cmd: ["bun", "test", ...tests] },
  );

  return steps;
}
