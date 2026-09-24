import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkDuplicates, duplicatePairs } from "./duplicates";

function doc(gloss: string, body: string): string {
  return `---\ntitle: Rules\ndescription: "One."\n---\n\n## 0. Quick Reference\n\n- §1 One: ${gloss}\n\n## 1. One\n\n${body}\n`;
}

function repo(prefix: string, files: readonly (readonly [string, string])[]): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  for (const [path, source] of files) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source, "utf-8");
  }
  return root;
}

const config = (root: string) => ({ root, kind: "libs" as const, canonRoot: join(root, "warden/canon") });

const RULE = [
  "A comment earns its line or it is deleted.",
  "One line of TSDoc per export, the `@public` and `@internal` tags, and the rare inline why.",
  "Anything else is a second home for a fact that already has one, and it decays where it sits.",
].join(" ");

/** Long enough to clear the floor, and about something else entirely, so filler never scores against filler. */
const FILLER = [
  "A migration runs once and is never edited afterwards, because its hash is the ledger's record of what the database already did.",
  "Roll a mistake forward under a new number instead, and keep the restore path honest.",
].join(" ");

describe("checkDuplicates()", () => {
  it("warns on a section copied between the canon and this repository's own documents", () => {
    const result = checkDuplicates(
      config(
        repo("warden-dup-identical-", [
          ["warden/canon/shared/CODE_RULES.md", doc("the comment budget", RULE)],
          ["docs/CODE_RULES.md", doc("the comment budget", RULE)],
        ]),
      ),
    );

    // A warning, never a failure: the first run over an unswept corpus is evidence about the
    // threshold as much as about the corpus.
    expect(result.ok).toBe(true);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`canon:CODE_RULES.md#1` and `project:docs/CODE_RULES.md#1` overlap 1.000 — one of them should narrow the other, not restate it",
    ]);
  });

  it("leaves a specialisation that restates in its own words alone", () => {
    const result = checkDuplicates(
      config(
        repo("warden-dup-specialisation-", [
          ["warden/canon/shared/CODE_RULES.md", doc("the comment budget", RULE)],
          [
            "docs/CODE_RULES.md",
            doc(
              "the comment budget here",
              "Forge writes one TSDoc line above each exported symbol and nothing below it. Run `bun run verify --only lint` and the budget is checked for you, so a reviewer never argues about prose.",
            ),
          ],
        ]),
      ),
    );

    expect(result.findings).toEqual([]);
    expect(result.summary).toContain("0 pairs at or above 0.28");
  });

  it("refuses to report a green gate on a corpus it never read", () => {
    const result = checkDuplicates(config(repo("warden-dup-empty-", [])));

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe(
      "discovery found no document to compare — the corpus roots are wrong — refusing to report a green warden:duplicates gate that read nothing",
    );
  });

  it("counts a section shorter than one shingle out rather than treating it as empty overlap", () => {
    const result = checkDuplicates(
      config(
        repo("warden-dup-short-", [
          ["warden/canon/shared/CODE_RULES.md", doc("terse", "Delete it.")],
          ["docs/CODE_RULES.md", doc("terse", "Delete it.")],
        ]),
      ),
    );

    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("0 comparable sections, 0 pairs at or above 0.28, highest 0.000.");
  });

  // A banner is copied on purpose — two entry points of one nature get one label — and a ratio over
  // a handful of shingles cannot tell that from a rule stated twice.
  it("counts a banner too short for a ratio to mean anything out of the comparison entirely", () => {
    const banner = "**Browser-only, side-effect import.** esbuild entry points only.";
    const result = checkDuplicates(
      config(
        repo("warden-dup-floor-", [
          ["src/ui/README.md", doc("the client entries", `${banner}\n\n### One\n\n${RULE}`)],
          ["src/chrome/README.md", doc("the client entries", `${banner}\n\n### One\n\n${FILLER}`)],
        ]),
      ),
    );

    expect(result.findings).toEqual([]);
    expect(result.summary).toContain("0 pairs at or above 0.28");
  });

  it("leaves two `See also` lists citing one governing document alone", () => {
    const seeAlso = (extra: string) =>
      [
        "## See also",
        "",
        "- [`docs/SOURCE_OF_TRUTH.md`][sot] §2f — why this README, and not a `docs/` document, owns the rulings above",
        `- ${extra}`,
        "",
        "[sot]: ../../docs/SOURCE_OF_TRUTH.md#2f-the-prose-rows",
      ].join("\n");
    const result = checkDuplicates(
      config(
        repo("warden-dup-see-also-", [
          ["src/session/README.md", `${doc("sessions", RULE)}\n${seeAlso("[`src/form/README.md`][form] — binding a token to the session id")}`],
          ["src/term/README.md", `${doc("terminals", FILLER)}\n${seeAlso("[`src/cli/README.md`][cli] — the command layer")}`],
        ]),
      ),
    );

    expect(result.findings).toEqual([]);
  });

  it("excludes an organising stub, whose prose belongs to its children", () => {
    const parent = `---\ntitle: Rules\ndescription: "One."\n---\n\n## 0. Quick Reference\n\n- §1 One: budget\n- §1a Child: budget\n\n## 1. One\n\n### 1a. Child\n\n${RULE}\n`;
    const result = checkDuplicates(config(repo("warden-dup-stub-", [["warden/canon/shared/CODE_RULES.md", parent]])));

    // Three headings, one of them a `## 1.` stub with no prose of its own.
    expect(result.summary).toBe("1 comparable sections, 0 pairs at or above 0.28, highest 0.000.");
  });

  it("reports the canon-against-docs pair first, whatever order the corpus produced it in", () => {
    const other = RULE.replace("deleted", "removed");
    const result = checkDuplicates(
      config(
        repo("warden-dup-order-", [
          ["warden/canon/shared/CODE_RULES.md", doc("the comment budget", RULE)],
          ["docs/CODE_RULES.md", doc("the comment budget", other)],
          ["README.md", doc("the comment budget", RULE)],
        ]),
      ),
    );

    expect(result.findings[0]?.message).toContain("`canon:CODE_RULES.md#1` and `project:docs/CODE_RULES.md#1`");
    expect(result.findings[0]?.file).toBe("CODE_RULES.md");
  });
});

describe("duplicatePairs()", () => {
  it("carries the class the check sorts by, which a summary line cannot say", () => {
    const other = RULE.replace("deleted", "removed");
    const pairs = duplicatePairs(
      config(
        repo("warden-dup-pairs-", [
          ["warden/canon/shared/CODE_RULES.md", doc("the comment budget", RULE)],
          ["docs/CODE_RULES.md", doc("the comment budget", other)],
          ["README.md", doc("the comment budget", RULE)],
        ]),
      ),
    );

    expect(pairs.map((pair) => [pair.klass, pair.a, pair.b])).toEqual([
      [0, "canon:CODE_RULES.md#1", "project:docs/CODE_RULES.md#1"],
      [1, "canon:CODE_RULES.md#1", "project:README.md#1"],
      [1, "project:README.md#1", "project:docs/CODE_RULES.md#1"],
    ]);
  });

  // A library README is a README, so the README class would otherwise claim the pair and fill the
  // reporting cap with advisory pairs — which is the one thing the dependency class exists to stop.
  it("sorts a pair against the installed library's README behind a README of this repository", () => {
    const other = RULE.replace("deleted", "removed");
    const library = repo("warden-dup-library-", [
      ["package.json", '{"name": "@y-core/forge"}'],
      ["docs/CODE_RULES.md", `${doc("the comment budget", other).replace("description:", "audience: consumer\ndescription:")}`],
      ["src/ui/README.md", `${doc("the comment budget", RULE).replace("description:", "audience: consumer\ndescription:")}`],
    ]);
    const root = repo("warden-dup-consumer-", [
      ["warden/canon/shared/CODE_RULES.md", doc("the comment budget", other)],
      ["docs/CODE_RULES.md", doc("the comment budget", RULE)],
      ["README.md", doc("the comment budget", RULE)],
    ]);
    const pairs = duplicatePairs({ ...config(root), dependencyRoot: library });

    const involving = (id: string) => pairs.filter((pair) => pair.a.includes(id) || pair.b.includes(id));

    expect(involving("dependency:forge/src/ui/README.md").map((pair) => pair.klass)).toEqual(
      involving("dependency:forge/src/ui/README.md").map(() => 3),
    );
    expect(involving("project:README.md").map((pair) => pair.klass)).toContain(1);
    expect(pairs.map((pair) => pair.klass)).toEqual([...pairs.map((pair) => pair.klass)].sort((left, right) => left - right));
  });

  it("reports nothing where the check reports nothing", () => {
    expect(duplicatePairs(config(repo("warden-dup-pairs-none-", [["warden/canon/shared/CODE_RULES.md", doc("the budget", RULE)]])))).toEqual([]);
  });
});
