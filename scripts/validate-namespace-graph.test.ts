import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { enumerationFailures } from "./validate-namespace-graph";

// `validate-namespace-graph.ts` runs only under its `import.meta.main` guard, so the import above
// performs no scan and exits no process — anything it exports is directly assertable, which is what
// the last block here does. Its `ROOT` is still derived from `import.meta.url` and can never be
// pointed at a fixture tree, so the whole-repository policy this file owns — which directories count
// as namespaces, and that the walk actually covers them — is still only observable by running it,
// and is still spawned below. The matchers it decides on are unit-tested in
// `namespace-graph-parse.test.ts`. Nothing here writes to the repository.

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

const run = spawnSync("bun", ["run", "scripts/validate-namespace-graph.ts"], { cwd: REPO_ROOT, encoding: "utf-8" });
const stdout = run.stdout ?? "";
const lines = stdout.split("\n");

/** The namespace named by each `  ok <namespace> (<shape>)` line. Asserting on the parsed names
 *  rather than whole lines keeps these cases independent of a namespace's edge count, which changes
 *  for reasons that have nothing to do with the namespace *set*. The exact-line case below pins the
 *  format itself, so a format change cannot make this parse quietly return nothing. */
const okNamespaces = lines.flatMap((line) => {
  const match = /^ {2}ok (\S+) \(.+\)$/.exec(line);
  return match === null ? [] : [match[1]];
});

describe("validate-namespace-graph — the namespace set", () => {
  it("passes against the repository as it stands", () => {
    expect(run.status).toBe(0);
  });

  it("reports each covered namespace on an `ok` line naming its shape", () => {
    // Pins the output format the cases below parse. `result` is a primitive with no forge imports,
    // so its shape is `leaf` for structural reasons rather than incidental ones.
    expect(lines).toContain("  ok result (leaf)");
  });

  it("covers namespaces spread across the exports map rather than a hardcoded few", () => {
    // Asserted per namespace rather than on the total, so adding a namespace elsewhere does not make
    // this pass or fail for an unrelated reason.
    expect(okNamespaces).toContain("app");
    expect(okNamespaces).toContain("http");
    expect(okNamespaces).toContain("validation");
    expect(okNamespaces).toContain("ui/core");
  });

  it("attributes a sub-namespace separately from its parent", () => {
    // `storage` owns no subpath of its own; `storage/db` and `storage/kv` each do. Separate lines
    // prove the longest-prefix attribution is live and that `storage` is not swallowing its children.
    expect(okNamespaces).toContain("storage/db");
    expect(okNamespaces).toContain("storage/kv");
    expect(okNamespaces).toContain("storage/r2");
    expect(okNamespaces).not.toContain("storage");
  });

  it("covers `crypto` even though it owns no export subpath", () => {
    // `crypto` is on the sealed-internal allowlist (`SEALED_INTERNAL`, mirroring the constant of the
    // same name in `validate-exports.ts`): every symbol is `@internal` and no consumer can name the
    // subpath, but it is still a namespace for layering purposes and must be walked.
    expect(okNamespaces).toContain("crypto");
  });

  it("does not treat `assets/cli` as a namespace, because it owns no export subpath", () => {
    // A directory is a namespace only when it owns a subpath. `src/assets/cli/` has a barrel and
    // looks exactly like one, which is what a naive directory walk gets wrong: its imports are
    // `assets`' edges, not the edges of a namespace the package does not have. `assets` is asserted
    // present in the same case so a format change that broke the parse cannot make the absence pass
    // vacuously — and `validation/cli`, which *does* own a subpath, shows the distinction is the
    // subpath and not the directory name.
    expect(okNamespaces).toContain("assets");
    expect(okNamespaces).toContain("validation/cli");
    expect(okNamespaces).not.toContain("assets/cli");
  });
});

// ── Check 2: the enumeration guard ────────────────────────────────────────────────────────────
// Both failing directions now live in `namespace-graph-parse.test.ts`, over synthetic markdown:
// `sectionWindow` and `findEnumerations` are exported and pure, so a moved heading and a returning
// enumeration are both reachable without touching the real document. What is left here is the
// policy this file owns — the passing direction against the document actually shipped — and the
// precondition that makes it meaningful: the guard reports an absent heading, so a green run says
// nothing unless both headings are there for it to window on.

const CLASSIFICATION_DOC = ".decisions/NAMESPACE_DESIGN.md";
const doc = readFileSync(fileURLToPath(new URL(`../${CLASSIFICATION_DOC}`, import.meta.url)), "utf-8").split("\n");

describe("validate-namespace-graph — the enumeration guard", () => {
  it("windows on a §3a heading that is actually present", () => {
    // Without this the case below passes vacuously on a document whose catalog section was renamed —
    // which is the exact failure `sectionWindow` returning `null` exists to report.
    expect(doc.filter((line) => /^### 3a\. /.test(line)).length).toBe(1);
  });

  it("windows on a §4a heading that is actually present", () => {
    expect(doc.filter((line) => /^### 4a\. /.test(line)).length).toBe(1);
  });

  it("carries neither enumeration in the sections the guard windows on", () => {
    // Both passing directions on the real document: §3a's catalog table header carries no `Category`
    // or `Classification` column, and §4a carries no `| Namespace | Composes |` table. Read off the
    // document rather than off the run's stderr, because failures go to stderr and the
    // `node:child_process` stub declares only `status` and `stdout`; the exit status asserted above
    // is what ties this to the guard actually agreeing.
    expect(doc.filter((line) => /^\|.*\|\s*(?:Category|Classification)\s*\|/.test(line))).toEqual([]);
    expect(doc.filter((line) => /^\|\s*Namespace\s*\|\s*Composes\s*\|/.test(line))).toEqual([]);
  });
});

// ── enumerationFailures: the message a finding kind produces ──────────────────────────────────
// The one thing the spawned cases above cannot reach. A failing direction only exists against a
// document that carries an enumeration, and the real one never will — while the *messages* are the
// half of the guard a reader acts on, and until this module was importable no test asserted any of
// them. `findEnumerations` is covered separately over the same synthetic shapes; what is asserted
// here is strictly the mapping from its four kinds to what the gate prints, so a message swapped
// between two arms fails even though every kind is still detected.
//
// Restated verbatim on purpose. A second copy that cannot drift silently is the point: this is the
// assertion that the wording, and the line number carried into the subject, are what they are.

/** Both guarded sections, each optionally carrying the enumeration it forbids. Ordered as the real
 *  document is — §3a's catalog, then §4a inside the following `## 4.` — because `sectionWindow` runs
 *  a window to the next `## `, so the shape decides which lines each check sees. */
function fixtureDoc(opts: { catalog: boolean; classification: boolean; column: boolean; composes: boolean }): string[] {
  return [
    ...(opts.catalog ? ["### 3a. Subpath Catalog", ...(opts.column ? ["| Subpath | Classification |"] : [])] : ["### 3z. Something Else"]),
    "",
    "## 4. Composition",
    ...(opts.classification ? ["### 4a. Leaf vs Integration", ...(opts.composes ? ["| Namespace | Composes |"] : [])] : ["### 4z. Something Else"]),
  ];
}

describe("validate-namespace-graph — enumerationFailures", () => {
  it("reports nothing for a document carrying neither enumeration", () => {
    expect(enumerationFailures(fixtureDoc({ catalog: true, classification: true, column: false, composes: false }))).toEqual([]);
  });

  it("names the returned `Namespace | Composes` table at its own line, and says to cite EDGES instead", () => {
    // Line 5: `### 3a.`, blank, `## 4.`, `### 4a.`, then the table.
    expect(enumerationFailures(fixtureDoc({ catalog: true, classification: true, column: false, composes: true }))).toEqual([
      {
        subject: ".decisions/NAMESPACE_DESIGN.md:5",
        message:
          "the `| Namespace | Composes |` table is back — `scripts/namespace-graph.ts` is authoritative for the graph and the document enumerates nothing; delete the table and cite `EDGES` instead",
      },
    ]);
  });

  it("names the returned classification column at its own line, and says which file owns each half", () => {
    expect(enumerationFailures(fixtureDoc({ catalog: true, classification: true, column: true, composes: false }))).toEqual([
      {
        subject: ".decisions/NAMESPACE_DESIGN.md:2",
        message:
          "the catalog's classification column is back — `scripts/namespace-graph.ts` is authoritative for leaf/integration and `package.json` `sideEffects` for side-effect status; the document enumerates neither, so delete the column and cite them instead",
      },
    ]);
  });

  it("reports a moved §4a heading against the document rather than a line", () => {
    // The absent-heading arms carry no line, so their subject is the bare path — the distinction the
    // subject encodes, and the one a message-only assertion would miss.
    expect(enumerationFailures(fixtureDoc({ catalog: true, classification: false, column: false, composes: false }))).toEqual([
      {
        subject: ".decisions/NAMESPACE_DESIGN.md",
        message: "no `### 4a.` heading — the classification section moved, and the guard below no longer covers it",
      },
    ]);
  });

  it("reports a moved §3a heading against the document rather than a line", () => {
    expect(enumerationFailures(fixtureDoc({ catalog: false, classification: true, column: false, composes: false }))).toEqual([
      {
        subject: ".decisions/NAMESPACE_DESIGN.md",
        message: "no `### 3a.` heading — the catalog section moved, and the guard below no longer covers it",
      },
    ]);
  });

  it("reports both enumerations in one pass, classification before catalog", () => {
    // The two checks are independent, and the order is the order the entry point prints in.
    const failures = enumerationFailures(fixtureDoc({ catalog: true, classification: true, column: true, composes: true }));

    expect(failures.map((failure) => failure.subject)).toEqual([".decisions/NAMESPACE_DESIGN.md:6", ".decisions/NAMESPACE_DESIGN.md:2"]);
  });
});
