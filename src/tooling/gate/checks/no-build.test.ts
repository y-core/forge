import { describe, expect, it } from "bun:test";

import { typecheckStep } from "../builders";
import type { CommandStep } from "../types";
import { checkNoBuild } from "./no-build";

const row = (label: string, cmd: readonly [string, ...string[]]): CommandStep => ({ label, cmd, tail: 20 });

describe("checkNoBuild()", () => {
  it("passes a table whose rows check the source and build nothing", () => {
    expect(checkNoBuild([typecheckStep(), row("lint", ["oxlint", "src"])])).toEqual({
      ok: true,
      findings: [],
      summary: "2 rows, none of them a build",
    });
  });

  it("fails a row a builder returns as well as one written out, whatever argument names the build", () => {
    const built: CommandStep = { ...typecheckStep(), cmd: ["tsc", "-p", "tsconfig.build.json"] };
    const result = checkNoBuild([built, row("bundle", ["bun", "x", "esbuild", "src/mod.ts"]), row("assets", ["bun", "run", "build:assets"])]);

    expect(result.findings.map((finding) => [finding.message, finding.rule])).toEqual([
      ["row `typecheck` runs `tsc` — the library is consumed as raw TypeScript, so no gate step builds it", "forge-gate-no-build-step"],
      ["row `bundle` runs `esbuild` — the library is consumed as raw TypeScript, so no gate step builds it", "forge-gate-no-build-step"],
      ["row `assets` runs `build:assets` — the library is consumed as raw TypeScript, so no gate step builds it", "forge-gate-no-build-step"],
    ]);
  });

  it("reads a check row as building nothing, since it runs no command", () => {
    expect(checkNoBuild([{ label: "validate-x", run: () => ({ ok: true, findings: [], summary: "" }) }]).ok).toBe(true);
  });
});
