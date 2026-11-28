import { checkResult, fail } from "../finding";
import type { CheckResult, Step } from "../types";

const BUILDS = /^(esbuild|tsc|tsup|rollup|vite|webpack)$|^build(:|$)/;

/** Fails every row whose command runs a bundler, the compiler's emit, or a `build` script, read from the resolved rows rather than the table's text. @public */
export function checkNoBuild(steps: readonly Step[]): CheckResult {
  const findings = steps.flatMap((step) => {
    const tool = step.cmd?.find((arg) => BUILDS.test(arg));
    return tool === undefined
      ? []
      : [
          fail(`row \`${step.label}\` runs \`${tool}\` — the library is consumed as raw TypeScript, so no gate step builds it`, {
            rule: "forge-gate-no-build-step",
          }),
        ];
  });
  return checkResult(findings, `${steps.length} rows, none of them a build`);
}
