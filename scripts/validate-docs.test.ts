import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// `validate-docs.ts` is a script, not a module: it runs at import time and exits the process, and
// its `ROOT` is derived from `import.meta.url` so it can never be pointed at a fixture tree. The
// matchers it decides on are unit-tested in `docs-parse.test.ts`; what is left to assert is the
// policy this file owns — *which* documents get scanned — and that is only observable by running
// it. Nothing here writes to the repository.

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

const run = spawnSync("bun", ["run", "scripts/validate-docs.ts"], { cwd: REPO_ROOT, encoding: "utf-8" });
const stdout = run.stdout ?? "";

describe("validate-docs — the scanned set", () => {
  it("passes against the repository as it stands", () => {
    expect(run.status).toBe(0);
  });

  it("scans the root README", () => {
    // bug-260808-38: the root README was the one markdown file with no automated check at all,
    // which is how `@y-core/forge/render` survived in the highest-traffic document in the project.
    // Asserted on the per-file `ok` line rather than the total, so adding a doc elsewhere does not
    // make this pass or fail for an unrelated reason.
    expect(stdout.split("\n")).toContain("  ok README.md");
  });

  it("still scans the governing docs and the Guide Index owner", () => {
    const lines = stdout.split("\n");

    expect(lines).toContain("  ok CLAUDE.md");
    expect(lines).toContain("  ok .decisions/NAMESPACE_DESIGN.md");
  });

  it("still scans namespace READMEs", () => {
    expect(stdout.split("\n")).toContain("  ok src/ui/README.md");
  });
});
