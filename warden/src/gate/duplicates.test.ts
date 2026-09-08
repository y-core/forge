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

describe("checkDuplicates()", () => {
  it("warns on a section copied between the canon and this repository's own documents", () => {
    const result = checkDuplicates(
      config(
        repo("warden-dup-identical-", [
          ["warden/canon/libs/CODE_RULES.md", doc("the comment budget", RULE)],
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
          ["warden/canon/libs/CODE_RULES.md", doc("the comment budget", RULE)],
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
          ["warden/canon/libs/CODE_RULES.md", doc("terse", "Delete it.")],
          ["docs/CODE_RULES.md", doc("terse", "Delete it.")],
        ]),
      ),
    );

    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("0 searchable chunks, 0 pairs at or above 0.28, highest 0.000.");
  });

  it("excludes an organising stub, whose prose belongs to its children", () => {
    const parent = `---\ntitle: Rules\ndescription: "One."\n---\n\n## 0. Quick Reference\n\n- §1 One: budget\n- §1a Child: budget\n\n## 1. One\n\n### 1a. Child\n\n${RULE}\n`;
    const result = checkDuplicates(config(repo("warden-dup-stub-", [["warden/canon/libs/CODE_RULES.md", parent]])));

    // Three headings, one of them a `## 1.` stub with no prose of its own.
    expect(result.summary).toBe("1 searchable chunks, 0 pairs at or above 0.28, highest 0.000.");
  });

  it("reports the canon-against-docs pair first, whatever order the corpus produced it in", () => {
    const other = RULE.replace("deleted", "removed");
    const result = checkDuplicates(
      config(
        repo("warden-dup-order-", [
          ["warden/canon/libs/CODE_RULES.md", doc("the comment budget", RULE)],
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
          ["warden/canon/libs/CODE_RULES.md", doc("the comment budget", RULE)],
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

  it("reports nothing where the check reports nothing", () => {
    expect(duplicatePairs(config(repo("warden-dup-pairs-none-", [["warden/canon/libs/CODE_RULES.md", doc("the budget", RULE)]])))).toEqual([]);
  });
});
