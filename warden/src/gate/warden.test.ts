import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { openDatabase } from "../index/db";
import { checkWarden } from "./warden";

const DOC =
  '---\ntitle: Rules\ndescription: "Six rules."\n---\n\n## 0. Quick Reference\n\n- §1 One: the comment budget\n\n## 1. One\n\nThe comment budget is a ceiling.\n';

const CATALOGUE = `# Catalogue

Every document of the fleet canon, with the sentence its own frontmatter uses to describe it. This
is the map an agent is handed before it asks anything: pick a document here, then reach its sections
with \`knowledge_outline\`, \`knowledge_search\` or \`warden outline <path>\`.

Generated — run \`warden catalogue --write\` after adding, removing or re-describing a document.

## Libraries

- \`CODE_RULES.md\` — Rules: Six rules.

## Shared — every repository, whatever its kind

- \`AGENT_GUIDE.md\` — Rules: Six rules.
`;

function repo(prefix: string, options: { catalogue?: string; docA?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [path, source] of [
    ["docs/A.md", options.docA ?? DOC],
    ["warden/canon/libs/CODE_RULES.md", DOC],
    ["warden/canon/shared/AGENT_GUIDE.md", DOC],
    ...(options.catalogue === undefined ? [] : [["warden/CATALOGUE.md", options.catalogue] as const]),
  ] as const) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source, "utf-8");
  }
  return root;
}

const run = (root: string) =>
  checkWarden({ root, kind: "libs", indexPath: ":memory:", canonRoot: join(root, "warden/canon"), catalogue: "warden/CATALOGUE.md" });

describe("checkWarden()", () => {
  it("passes a corpus whose catalogue is in step", () => {
    const result = run(repo("warden-gate-ok-", { catalogue: CATALOGUE }));

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("3 documents");
  });

  // A misconfigured corpus root discovers nothing, and nothing is indistinguishable from a feature
  // switched off: every check still passes and the documents it was added to reach are just absent.
  it("counts the documents per corpus, which is what a silently empty corpus shows up in", () => {
    expect(run(repo("warden-gate-counts-", { catalogue: CATALOGUE })).summary).toContain("3 documents (2 canon, 1 project)");
  });

  // A gate may only fail a repository for a file that repository can edit. A dependency document
  // lives under `node_modules`, is named by a path that does not exist in the consumer's tree, and
  // is read-only in every practical sense — so a finding against one is a build nobody can fix.
  it("indexes the installed library without holding it to this repository's own checks", () => {
    const library = repo("warden-gate-library-");
    writeFileSync(
      join(library, "docs/CONSUMER.md"),
      '---\ntitle: Consumer\ndescription: "One."\naudience: consumer\n---\n\n## 1. Ungl\u00f6ssed\n\nSee `ABSENT.md` \u00a71.\n',
      "utf-8",
    );
    writeFileSync(join(library, "package.json"), '{ "name": "@y-core/forge" }', "utf-8");

    const root = repo("warden-gate-scoped-", { catalogue: CATALOGUE });
    const result = checkWarden({ root, kind: "libs", indexPath: ":memory:", canonRoot: join(root, "warden/canon"), dependencyRoot: library });

    expect(result.summary).toContain("4 documents (2 canon, 1 project, 1 dependency)");
    expect(result.findings.filter((finding) => finding.level !== "warn")).toEqual([]);
    expect(result.findings.map((finding) => finding.file)).not.toContain("forge/CONSUMER.md");
  });

  it("reports on a document with two `## 1.` headings instead of dying inside the build", () => {
    const duplicated =
      '---\ntitle: Rules\ndescription: "Six rules."\n---\n\n## 0. Quick Reference\n\n- §1 One: the comment budget\n\n## 1. One\n\nBody.\n\n## 1. One Again\n\nBody.\n';
    const result = run(repo("warden-gate-duplicate-", { catalogue: CATALOGUE, docA: duplicated }));

    // The id is disambiguated rather than colliding, so `validate-docs` is left to name the
    // duplicate and the gate still gets to run every other check.
    expect(result.summary).toContain("3 documents");
    expect(result.findings.map((finding) => finding.message).join("\n")).not.toContain("the index could not be built");
  });

  it("fails on catalogue drift, naming the command that fixes it", () => {
    const result = run(repo("warden-gate-drift-", { catalogue: `${CATALOGUE}\n- \`GHOST.md\` — Ghost: nothing.\n` }));

    expect(result.findings.map((finding) => finding.message)).toContain("is out of step with the corpus — run `warden catalogue --write`");
  });

  it("fails when a configured catalogue does not exist at all", () => {
    expect(run(repo("warden-gate-absent-")).findings.map((finding) => finding.message)).toContain(
      "does not exist — run `warden catalogue --write`",
    );
  });

  // The rendered catalogue is canon-scoped, so only the canon's home repository has one to commit.
  it("skips the catalogue assertion entirely when no catalogue is configured", () => {
    const root = repo("warden-gate-uncatalogued-");
    const result = checkWarden({ root, kind: "libs", indexPath: ":memory:", canonRoot: join(root, "warden/canon") });

    expect(result.ok).toBe(true);
    expect(result.findings.map((finding) => finding.message).join("\n")).not.toContain("warden catalogue --write");
  });

  it("fails a section with no Quick Reference line — retrieval loses its best signal for it", () => {
    const missing =
      '---\ntitle: Rules\ndescription: "Six rules."\n---\n\n## 0. Quick Reference\n\n- §1 One: the first\n\n## 1. One\n\nBody.\n\n## 2. Two\n\nBody.\n';
    const messages = run(repo("warden-gate-gloss-", { catalogue: CATALOGUE, docA: missing })).findings.map((finding) => finding.message);

    expect(messages.some((message) => message.includes("has no Quick Reference line"))).toBe(true);
  });

  it("says it measured nothing rather than passing when discovery finds no document", () => {
    const empty = mkdtempSync(join(tmpdir(), "warden-gate-empty-"));

    expect(run(empty).findings.map((finding) => finding.message)).toContain(
      "discovery found no document to index — the corpus roots are wrong — refusing to report a green warden gate that read nothing",
    );
  });

  it("builds into the database it was given, never a developer's working one", () => {
    const root = repo("warden-gate-isolated-", { catalogue: CATALOGUE });
    const path = join(root, "gate.sqlite");

    checkWarden({ root, kind: "libs", indexPath: path, canonRoot: join(root, "warden/canon") });

    const db = openDatabase(path);
    expect(db.query<{ c: number }>("SELECT count(*) AS c FROM source").get()?.c).toBe(3);
    db.close();
  });
});
