import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findSubpathCitations, uncitedSubpaths } from "./docs-parse";

// `validate-docs.ts` runs only under its `import.meta.main` guard, so importing it would perform no
// scan — but its `ROOT` is derived from `import.meta.url` and can never be pointed at a fixture
// tree, so calling `main()` in-process would still walk the real repository and print to this
// runner's streams. The matchers it decides on are unit-tested in `docs-parse.test.ts`; what is left
// to assert is the policy this file owns — *which* documents get scanned — and that is read off a
// spawned run's stdout. Nothing here writes to the repository.

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

const run = spawnSync("bun", ["run", "scripts/validate-docs.ts"], { cwd: REPO_ROOT, encoding: "utf-8" });
const stdout = run.stdout ?? "";

describe("validate-docs — the scanned set", () => {
  it("passes against the repository as it stands", () => {
    expect(run.status).toBe(0);
  });

  it("scans the root README", () => {
    // The root README was the one markdown file with no automated check at all, which is how
    // `@y-core/forge/render` survived in the highest-traffic document in the project.
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

// ── checkExportCoverage ───────────────────────────────────────────────────────────────────────
// The script's `ROOT` is `import.meta.url`-derived, so it cannot be pointed at a fixture README and
// the failing direction of this check is not reachable by running it. What *is* reachable is the
// pair the check is built from — `findSubpathCitations` + `uncitedSubpaths` — driven against a
// fixture README string, plus the real repository for the passing direction.
//
// The assertions are on *which subpaths* come back uncited, not on the sentence the script prints
// about them. Wording is not behaviour: restating the message here would put a second copy of it in
// a file that cannot import the first, so the two could drift apart with nothing to notice.

const PKG = "@y-core/forge";

function uncited(source: string, published: readonly string[], exempt: ReadonlySet<string>): string[] {
  return uncitedSubpaths(published, findSubpathCitations(source, PKG, { strict: true }), exempt);
}

/** A README fixture in the shape of the real one: the citations that matter live in table cells,
 *  which is the position `strict` scanning exists for. */
function fixtureReadme(rows: readonly string[]): string {
  return ["# forge", "", "| Subpath | Purpose |", "| --- | --- |", ...rows.map((row) => `| \`${PKG}${row}\` | prose |`)].join("\n");
}

const PUBLISHED = ["./http", "./result", "./ui/client/htmx"];

describe("validate-docs — export coverage of the root README", () => {
  it("reports the published subpath that no table row cites", () => {
    const source = fixtureReadme(["/http", "/result"]);

    expect(uncited(source, PUBLISHED, new Set())).toEqual(["./ui/client/htmx"]);
  });

  it("passes once that subpath is cited", () => {
    const source = fixtureReadme(["/http", "/result", "/ui/client/htmx"]);

    expect(uncited(source, PUBLISHED, new Set())).toEqual([]);
  });

  it("passes when that subpath is instead licensed by an exemption", () => {
    const source = fixtureReadme(["/http", "/result"]);

    expect(uncited(source, PUBLISHED, new Set(["./ui/client/htmx"]))).toEqual([]);
  });

  it("reports nothing against the repository as it stands", () => {
    // The passing direction on the real front page. Asserted on the exit status rather than on the
    // failure text, because failures go to stderr and the `node:child_process` stub declares only
    // `status` and `stdout` — a coverage failure for any subpath is a non-zero exit either way.
    expect(run.status).toBe(0);
  });
});
