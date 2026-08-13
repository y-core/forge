/** steps.ts — the verification gate's step table.
 *
 *  This file is the single source of truth for what forge's gate runs; `package.json` holds only
 *  the two verbs that invoke it, and the runner behind them is `@y-core/forge/pkg`'s
 *  `createGateCommand`. The `Step` vocabulary and the pure `selectSteps` resolver live there too,
 *  so what remains here is data — see `steps.test.ts` for the invariants asserted over it.
 */

import type { Gate, Step } from "../../src/pkg/mod";

const CHECK_AND_VERIFY: readonly Gate[] = ["check", "verify"];

/** The gate's steps, in execution order.
 *
 *  `typecheck` runs first deliberately: a type failure cascades into misleading lint and test
 *  failures, so fail-fast ordering encodes `.decisions/TESTING.md` §6b's "fix types first" rule
 *  rather than leaving it to the reader.
 */
export const STEPS: readonly Step[] = [
  { label: "typecheck", gates: CHECK_AND_VERIFY, tail: 20, cmd: ["tsgo", "--noEmit"] },
  {
    label: "lint",
    gates: CHECK_AND_VERIFY,
    tail: 20,
    cmd: ["biome", "check", "src/", "scripts/"],
    fix: ["biome", "check", "--write", "src/", "scripts/"],
  },
  // 120, matching `test:browser`: at 40, console output from suites that run late (`storage/kv`,
  // `storage/db`, `assets/build`, `validation/cli`) filled the window and pushed the `(fail)`
  // blocks out of it. The tail is a probability reduction, not the fix — that is the full log
  // path printed beneath it.
  { label: "test", gates: CHECK_AND_VERIFY, tail: 120, cmd: ["bun", "test"] },
  { label: "validate-exports", gates: CHECK_AND_VERIFY, tail: 30, cmd: ["bun", "run", "scripts/validate-exports.ts"] },
  { label: "validate-namespace-graph", gates: CHECK_AND_VERIFY, tail: 30, cmd: ["bun", "run", "scripts/validate-namespace-graph.ts"] },
  { label: "validate-jsx", gates: CHECK_AND_VERIFY, tail: 30, cmd: ["bun", "run", "scripts/validate-jsx.ts"] },
  { label: "validate-docs", gates: CHECK_AND_VERIFY, tail: 30, cmd: ["bun", "run", "scripts/validate-docs.ts"] },
  // `verify` only, matching `test:browser`: the invariants are release-shaped, and requiring a
  // written `[Unreleased]` entry on every inner `check` loop would fail every WIP commit.
  { label: "validate-changelog", gates: ["verify"], tail: 30, cmd: ["bun", "run", "scripts/validate-changelog.ts"] },
  { label: "validate-design", gates: CHECK_AND_VERIFY, tail: 30, cmd: ["bun", "run", "scripts/validate-design.ts"] },
  { label: "validate-contrast", gates: CHECK_AND_VERIFY, tail: 30, cmd: ["bun", "run", "scripts/validate-contrast.ts"] },
  { label: "validate-css-sources", gates: CHECK_AND_VERIFY, tail: 30, cmd: ["bun", "run", "scripts/validate-css-sources.ts"] },
  {
    // The prerequisite is the downloaded browser, not the `playwright` CLI: the CLI is a
    // devDependency and so is always present, which would make `playwright --version` pass
    // vacuously and let every spec fail inside `browserType.launch()` instead.
    label: "test:browser",
    gates: ["verify"],
    tail: 120,
    cmd: ["playwright", "test"],
    requires: { tool: "chromium", probe: ["bun", "run", "scripts/probe-browser.ts"], hint: "bun run test:install" },
  },
];
