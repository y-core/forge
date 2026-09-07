import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { openDatabase } from "../index/db";
import { checkGoldenQueries } from "./queries";

function doc(gloss: string, body: string): string {
  return `---\ntitle: Rules\ndescription: "One."\n---\n\n## 0. Quick Reference\n\n- §1 One: ${gloss}\n\n## 1. One\n\n${body}\n`;
}

function repo(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [path, source] of [
    ["docs/A.md", doc("honeypots", "A honeypot field is never rendered visibly.")],
    ["warden/canon/libs/CODE_RULES.md", doc("the comment budget", "The comment budget is a ceiling on prose.")],
    ["warden/canon/shared/AGENT_GUIDE.md", doc("section numbering", "A section is numbered so it can be cited.")],
  ] as const) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source, "utf-8");
  }
  return root;
}

// `negative: []` by default so each case states its own; the shipped set is written against the
// real corpus and would be measuring nothing against this three-document fixture.
const config = (root: string) => ({ root, kind: "libs" as const, indexPath: ":memory:", canonRoot: join(root, "warden/canon"), negative: [] });

const COVERING = [
  { query: "comment budget ceiling", expect: "canon:CODE_RULES.md#1" },
  { query: "section numbering cited", expect: "canon:AGENT_GUIDE.md#1" },
];

describe("checkGoldenQueries()", () => {
  it("passes when every query finds its answer and every canon document is reached", () => {
    const result = checkGoldenQueries({ ...config(repo("warden-golden-ok-")), queries: COVERING });

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("2 golden queries, 2 documents reached top-1, floor margin 1.000 answered / 0.000 refused.");
  });

  it("fails a negative query the corpus answered anyway — what stops the floor being deleted", () => {
    const result = checkGoldenQueries({
      ...config(repo("warden-golden-negative-")),
      queries: COVERING,
      negative: ["comment budget ceiling"],
      coverage: false,
    });

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toContain("the corpus does not answer this and retrieval offered");
  });

  it("passes a negative query the floor refuses, and reports the margin it had left", () => {
    const result = checkGoldenQueries({
      ...config(repo("warden-golden-refused-")),
      queries: COVERING,
      negative: ["kubernetes ingress controller"],
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("floor margin 1.000 answered /");
  });

  it("prints the query, the expected id and the actual top hits when a query misses", () => {
    const result = checkGoldenQueries({
      ...config(repo("warden-golden-miss-")),
      queries: [{ query: "comment budget ceiling", expect: "canon:CODE_RULES.md#9" }],
      coverage: false,
    });

    const [finding] = result.findings;

    expect(finding?.message).toContain('"comment budget ceiling"');
    expect(finding?.message).toContain("canon:CODE_RULES.md#9");
    expect(finding?.message).toContain("1. canon:CODE_RULES.md#1");
  });

  it("fails an `absent` id that comes back — a corpus quoting its own anti-patterns is the hazard", () => {
    const result = checkGoldenQueries({
      ...config(repo("warden-golden-absent-")),
      queries: [{ query: "comment budget ceiling", expect: "canon:CODE_RULES.md#1", absent: ["canon:CODE_RULES.md#1"] }],
      coverage: false,
    });

    expect(result.findings.map((finding) => finding.message)).toContain(
      '"comment budget ceiling" — `canon:CODE_RULES.md#1` must not be returned, and was',
    );
  });

  it("names a canon document no query reaches, so the set cannot decay into a stale fixture", () => {
    const result = checkGoldenQueries({ ...config(repo("warden-golden-coverage-")), queries: [COVERING[0] as (typeof COVERING)[number]] });

    expect(result.findings.map((finding) => finding.message)).toContain(
      "`canon:AGENT_GUIDE.md` is top-1 for no golden query — add one, or retrieval has stopped serving it",
    );
  });

  it("can be run with coverage off, for a repository still building its set", () => {
    expect(
      checkGoldenQueries({ ...config(repo("warden-golden-nocov-")), queries: [COVERING[0] as (typeof COVERING)[number]], coverage: false }).ok,
    ).toBe(true);
  });

  it("says the set is unmeasured rather than passing on an empty one", () => {
    expect(checkGoldenQueries({ ...config(repo("warden-golden-empty-")), queries: [] }).findings[0]?.message).toContain("the golden set is empty");
  });

  it("leaves a fresh index alone, so the gate does not build the same database twice", () => {
    const root = repo("warden-golden-fresh-");
    const indexPath = join(root, "gate.sqlite");
    const settings = { ...config(root), indexPath, queries: COVERING };

    expect(checkGoldenQueries(settings).ok).toBe(true);
    const db = openDatabase(indexPath);
    db.run("UPDATE chunk SET title = 'sentinel'");
    db.close();

    expect(checkGoldenQueries(settings).ok).toBe(true);
    const after = openDatabase(indexPath);
    const titles = after.query<{ title: string }>("SELECT DISTINCT title FROM chunk").all();
    after.close();

    expect(titles).toEqual([{ title: "sentinel" }]);
  });

  it("is deterministic — the same corpus twice gives the same verdict", () => {
    const root = repo("warden-golden-determinism-");

    expect(checkGoldenQueries({ ...config(root), queries: COVERING }).findings).toEqual(
      checkGoldenQueries({ ...config(root), queries: COVERING }).findings,
    );
  });
});
