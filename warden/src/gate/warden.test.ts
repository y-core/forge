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

## Applications

- \`WORKERS_PLATFORM.md\` — Rules: Six rules.

## Shared — every repository, whatever its kind

- \`AGENT_GUIDE.md\` — Rules: Six rules.
- \`CODE_RULES.md\` — Rules: Six rules.
`;

function repo(prefix: string, options: { catalogue?: string; docA?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [path, source] of [
    ["docs/A.md", options.docA ?? DOC],
    ["warden/canon/shared/CODE_RULES.md", DOC],
    ["warden/canon/shared/AGENT_GUIDE.md", DOC],
    // The apps tree is not indexed in a libs repository, and the committed catalogue carries it
    // anyway — that is the whole reason the file is rendered off disk rather than out of the index.
    ["warden/canon/apps/WORKERS_PLATFORM.md", DOC],
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

  it("holds the catalogue to every tree on disk, including the one this repository does not index", () => {
    const withoutApps = CATALOGUE.replace("## Applications\n\n- `WORKERS_PLATFORM.md` — Rules: Six rules.\n\n", "");

    expect(run(repo("warden-gate-apps-", { catalogue: withoutApps })).ok).toBe(false);
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

  // A README has slugged headings rather than numbered ones, an export table nothing indexes, and a
  // name the consumer may carry too — none of which is this repository's to answer for.
  it("holds no finding against a namespace README of the installed library", () => {
    const library = repo("warden-gate-readme-library-");
    writeFileSync(join(library, "package.json"), '{ "name": "@y-core/forge" }', "utf-8");
    mkdirSync(join(library, "src/ui"), { recursive: true });
    writeFileSync(
      join(library, "src/ui/README.md"),
      '---\ntitle: UI\ndescription: "One."\naudience: consumer\n---\n\n# UI\n\n## Button\n\nThe variants.\n\n### Exports\n\n| `Button` | a button |\n',
      "utf-8",
    );

    const root = repo("warden-gate-readme-", { catalogue: CATALOGUE });
    const result = checkWarden({ root, kind: "libs", indexPath: ":memory:", canonRoot: join(root, "warden/canon"), dependencyRoot: library });

    expect(result.summary).toContain("4 documents (2 canon, 1 project, 1 dependency)");
    expect(result.findings.map((finding) => finding.message).join("\n")).not.toContain("README.md");
    expect(result.findings.filter((finding) => finding.level !== "warn")).toEqual([]);
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

describe("checkWarden() — the filename rule", () => {
  // The fixture repository's own document is `docs/A.md`, so a canon `A.md` is the collision.
  function colliding(prefix: string, options: { canonHome?: boolean } = {}): ReturnType<typeof checkWarden> {
    const root = repo(prefix);
    mkdirSync(join(root, "warden/canon/libs"), { recursive: true });
    writeFileSync(join(root, "warden/canon/libs/A.md"), DOC, "utf-8");
    return checkWarden({
      root,
      kind: "libs",
      indexPath: ":memory:",
      canonRoot: join(root, "warden/canon"),
      ...(options.canonHome === undefined ? {} : { canonHome: options.canonHome }),
    });
  }

  it("fails the repository's own document, and names the canon one it collides with", () => {
    const findings = colliding("warden-gate-collide-").findings;
    const collision = findings.find((finding) => finding.message.includes("is already the name of"));

    expect(collision?.file).toBe("docs/A.md");
    expect(collision?.message).toBe(
      "`A.md` is already the name of canon/libs/A.md — rename this document, or delete it where it restates that one",
    );
  });

  // The specialising side renames, never the canon: a finding against the canon document would ask
  // every other repository's citation to move.
  it("never fails the canon document for a collision with a repository's own", () => {
    const files = colliding("warden-gate-collide-side-").findings.map((finding) => finding.file);

    expect(files).not.toContain("warden/canon/libs/A.md");
  });

  it("passes a corpus whose names are all distinct", () => {
    expect(run(repo("warden-gate-distinct-", { catalogue: CATALOGUE })).ok).toBe(true);
  });

  // A repository takes one kind or the other, so the two are never in one index.
  it("exempts a libs/apps canon pair even in the canon's home, where both trees are read", () => {
    const root = repo("warden-gate-crosskind-");
    mkdirSync(join(root, "warden/canon/libs"), { recursive: true });
    writeFileSync(join(root, "warden/canon/libs/WORKERS_PLATFORM.md"), DOC, "utf-8");
    const result = checkWarden({ root, kind: "libs", indexPath: ":memory:", canonRoot: join(root, "warden/canon"), canonHome: true });

    expect(result.findings.filter((finding) => finding.message.includes("is already the name of"))).toEqual([]);
  });

  // Without the flag the `canon/apps` tree is invisible here, and in an app neither side is a
  // `project` document — so the pair would be caught nowhere at all.
  it("reaches the canon tree this repository is not subject to, but only in the canon's home", () => {
    const root = repo("warden-gate-apps-index-");
    writeFileSync(join(root, "docs/WORKERS_PLATFORM.md"), DOC, "utf-8");
    const config = { root, kind: "libs" as const, indexPath: ":memory:", canonRoot: join(root, "warden/canon") };
    const named = (result: ReturnType<typeof checkWarden>) => result.findings.filter((f) => f.message.includes("is already the name of")).length;

    expect(named(checkWarden(config))).toBe(0);
    expect(named(checkWarden({ ...config, canonHome: true }))).toBe(1);
  });

  // Every namespace has one, and a citation of a README always carries its path.
  it("ignores a README, which is addressed by path rather than by name", () => {
    const root = repo("warden-gate-readme-");
    mkdirSync(join(root, "src/one"), { recursive: true });
    mkdirSync(join(root, "src/two"), { recursive: true });
    writeFileSync(join(root, "src/one/README.md"), DOC, "utf-8");
    writeFileSync(join(root, "src/two/README.md"), DOC, "utf-8");
    const result = checkWarden({ root, kind: "libs", indexPath: ":memory:", canonRoot: join(root, "warden/canon") });

    expect(result.findings.filter((finding) => finding.message.includes("is already the name of"))).toEqual([]);
  });
});
