import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkDocs } from "./docs";

/** A throwaway repository root holding exactly the files given. */
function fixtureRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-docs-check-"));
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf-8");
  }
  return root;
}

function doc(title: string, body: string): string {
  return `---\ntitle: ${title}\ndescription: "One sentence describing what this document governs."\n---\n\n## 0. Quick Reference\n\n- §1 One: what it decides\n\n## 1. One\n\n${body}\n`;
}

function docWithSub(title: string, body: string): string {
  return `---\ntitle: ${title}\ndescription: "One sentence describing what this document governs."\n---\n\n## 0. Quick Reference\n\n- §1 One: what it decides\n- §1a Sub: what it refines\n\n## 1. One\n\n### 1a. Sub\n\n${body}\n`;
}

function index(...rows: string[]): string {
  return `# CLAUDE.md\n\n## Guide Index\n\n${rows.join("\n")}\n`;
}

const run = (root: string) => checkDocs({ root, packageName: "@y-core/forge", exports: {} });
const messages = (root: string) => run(root).findings.map((finding) => finding.message);

describe("checkDocs() — nested document discovery", () => {
  it("discovers a document one directory deep", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

    const result = run(root);

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("2 documents verified, 0 warnings.");
  });

  it("reports a nested document that no Guide Index row registers", () => {
    const root = fixtureRoot({ ".decisions/governance/TESTING.md": doc("Testing", "Body."), "CLAUDE.md": index("- nothing here") });

    expect(messages(root)).toContain("`.decisions/governance/TESTING.md` is not registered in the Guide Index");
  });

  it("reports a Guide Index row naming a nested document that does not exist", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      "CLAUDE.md": index(
        "- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules",
        "- [`ABSENT.md`](.decisions/governance/ABSENT.md): nothing on disk",
      ),
    });

    expect(messages(root)).toContain("Guide Index names `governance/ABSENT.md`, which does not exist");
  });

  it("fails rather than passing vacuously when the directory exists and holds no documents", () => {
    const root = fixtureRoot({ ".decisions/governance/.gitkeep": "", "CLAUDE.md": index("- none") });

    expect(messages(root)).toContain("`.decisions/` exists but holds no documents");
  });
});

describe("checkDocs() — cross-references across a subdirectory", () => {
  it("resolves a §N citation from one subdirectory into another", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      ".decisions/implementation/SUITES.md": doc("Suites", "See [`TESTING.md`](../governance/TESTING.md) §1 for the rule."),
      "CLAUDE.md": index(
        "- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules",
        "- [`SUITES.md`](.decisions/implementation/SUITES.md): this repository's suites",
      ),
    });

    expect(run(root).ok).toBe(true);
  });

  it("reports a §N citation naming a section the nested target does not have", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      ".decisions/implementation/SUITES.md": doc("Suites", "See [`TESTING.md`](../governance/TESTING.md) §9 for the rule."),
      "CLAUDE.md": index(
        "- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules",
        "- [`SUITES.md`](.decisions/implementation/SUITES.md): this repository's suites",
      ),
    });

    expect(messages(root)).toContain("`governance/TESTING.md §9` does not resolve to a section in that document");
  });

  it("resolves a bare basename while exactly one document carries it", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      ".decisions/implementation/SUITES.md": doc("Suites", "The rule in TESTING.md §9 applies."),
      "CLAUDE.md": index(
        "- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules",
        "- [`SUITES.md`](.decisions/implementation/SUITES.md): this repository's suites",
      ),
    });

    expect(messages(root)).toContain("`TESTING.md §9` does not resolve to a section in that document");
  });

  it("reports an unlinked basename shared by two documents rather than skipping it", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      ".decisions/implementation/TESTING.md": doc("Testing Local", "Body."),
      ".decisions/implementation/SUITES.md": doc("Suites", "The rule in TESTING.md §9 applies."),
      "CLAUDE.md": index(
        "- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules",
        "- [`TESTING.md`](.decisions/implementation/TESTING.md): this repository's testing notes",
        "- [`SUITES.md`](.decisions/implementation/SUITES.md): this repository's suites",
      ),
    });

    expect(messages(root)).toContain(
      "`TESTING.md §9` is ambiguous — governance/TESTING.md and implementation/TESTING.md both match; cite the path",
    );
  });

  it("disambiguates a shared basename by the link on the same line", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      ".decisions/implementation/TESTING.md": doc("Testing Local", "Body."),
      ".decisions/implementation/SUITES.md": doc("Suites", "See [`TESTING.md`](../governance/TESTING.md) §1 for the rule."),
      "CLAUDE.md": index(
        "- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules",
        "- [`TESTING.md`](.decisions/implementation/TESTING.md): this repository's testing notes",
        "- [`SUITES.md`](.decisions/implementation/SUITES.md): this repository's suites",
      ),
    });

    expect(run(root).ok).toBe(true);
  });
});

const pairIndex = index(
  "- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules",
  "- [`SUITES.md`](.decisions/implementation/SUITES.md): this repository's suites",
);

describe("checkDocs() — citations wrapped across a line break", () => {
  it("validates a §N that opens the line after its link", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      ".decisions/implementation/SUITES.md": doc("Suites", "See [`TESTING.md`](../governance/TESTING.md)\n§1 for the rule."),
      "CLAUDE.md": pairIndex,
    });

    expect(run(root).ok).toBe(true);
  });

  it("reports an unresolvable §N that opens the line after its link", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      ".decisions/implementation/SUITES.md": doc("Suites", "See [`TESTING.md`](../governance/TESTING.md)\n§9 for the rule."),
      "CLAUDE.md": pairIndex,
    });

    expect(messages(root)).toEqual(["`governance/TESTING.md §9` does not resolve to a section in that document"]);
  });
});

describe("checkDocs() — backticked repository paths", () => {
  it("accepts `src/`, `config/`, and `.claude/` paths that exist on disk", () => {
    const root = fixtureRoot({
      "src/index.ts": "export {};\n",
      "config/steps.ts": "export {};\n",
      ".claude/settings.json": "{}\n",
      ".decisions/governance/TESTING.md": doc(
        "Testing",
        "The gate reads `config/steps.ts`, the entry `src/index.ts`, and `.claude/settings.json`.",
      ),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

    expect(run(root).ok).toBe(true);
  });

  it("reports a backticked path with nothing on disk, naming the document, line, and path", () => {
    const root = fixtureRoot({
      "src/index.ts": "export {};\n",
      ".decisions/governance/TESTING.md": doc("Testing", "The gate reads `src/absent.ts` at startup."),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

    expect(run(root).findings).toEqual([
      { level: "fail", message: "path `src/absent.ts` does not exist", file: ".decisions/governance/TESTING.md", line: 12 },
    ]);
  });

  it("strips a trailing slash before resolving a directory path", () => {
    const root = fixtureRoot({
      "src/ui/mod.ts": "export {};\n",
      ".decisions/governance/TESTING.md": doc("Testing", "Components live in `src/ui/`."),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

    expect(run(root).ok).toBe(true);
  });

  it("ignores tokens carrying a glob, a placeholder, or a space", () => {
    const root = fixtureRoot({
      "src/index.ts": "export {};\n",
      ".decisions/governance/TESTING.md": doc(
        "Testing",
        "Every `src/**/*.test.ts` file.\nOne `src/<name>/mod.ts` barrel.\nThe `config/{steps,gate}.ts` pair.\nUnder `src/ui/…` and `src/two words.ts`.",
      ),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

    expect(run(root).ok).toBe(true);
  });

  it("leaves a backticked path outside the decisions directory unchecked", () => {
    const root = fixtureRoot({ "README.md": "# Forge\n\nThe entry is `src/absent.ts`.\n" });

    expect(run(root).findings).toEqual([]);
  });
});

describe("checkDocs() — frontmatter keys", () => {
  it("accepts frontmatter carrying `title` and `description` only", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

    expect(run(root).ok).toBe(true);
  });

  it("reports a third frontmatter key", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body.").replace("title: Testing\n", "title: Testing\nstatus: draft\n"),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

    expect(messages(root)).toEqual(["unexpected frontmatter key `status` — `title` and `description` only"]);
  });
});

describe("checkDocs() — historical phrasing", () => {
  const phrases = ["previously", "no longer", "used to", "formerly", "renamed from", "fixed by", "has since", "Previously"];

  for (const phrase of phrases) {
    it(`warns without failing on \`${phrase}\``, () => {
      const root = fixtureRoot({
        ".decisions/governance/TESTING.md": doc("Testing", `The rule ${phrase} the sentinel.`),
        "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
      });

      const result = run(root);

      expect(result.ok).toBe(true);
      expect(result.findings).toEqual([
        {
          level: "warn",
          message: `historical phrasing \`${phrase}\` — governing docs carry no history`,
          file: ".decisions/governance/TESTING.md",
          line: 12,
        },
      ]);
      expect(result.summary).toBe("2 documents verified, 1 warning.");
    });
  }

  it("does not warn on historical phrasing inside a fenced code block", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "```md\nThe rule previously named the sentinel.\n```"),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

    expect(run(root).findings).toEqual([]);
  });

  it("does not warn on historical phrasing inside an inline code span", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "The `no longer` flag is read at startup."),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

    expect(run(root).findings).toEqual([]);
  });
});

describe("checkDocs() — section citations", () => {
  it("validates every member of a conjunct chain against the cited document", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": docWithSub("Testing", "Body."),
      ".decisions/implementation/SUITES.md": doc("Suites", "See [`TESTING.md`](../governance/TESTING.md) §1 and §1a for the rule."),
      "CLAUDE.md": pairIndex,
    });

    expect(run(root).ok).toBe(true);
  });

  it("reports the unresolvable member of a conjunct chain", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": docWithSub("Testing", "Body."),
      ".decisions/implementation/SUITES.md": doc("Suites", "See [`TESTING.md`](../governance/TESTING.md) §1 and §9 for the rule."),
      "CLAUDE.md": pairIndex,
    });

    expect(messages(root)).toEqual(["`governance/TESTING.md §9` does not resolve to a section in that document"]);
  });

  it("accepts a bare §N naming a section of the citing document", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "The rule in §1 governs it."),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

    expect(run(root).ok).toBe(true);
  });

  it("reports a bare §N the citing document has no section for", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "The rule in §7 governs it."),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

    expect(run(root).findings).toEqual([
      {
        level: "fail",
        message: "intra-document `§7` does not resolve to a section in this file",
        file: ".decisions/governance/TESTING.md",
        line: 12,
      },
    ]);
  });

  it("reports a dangling bare §N on a line that also carries an inter-document citation", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      ".decisions/implementation/SUITES.md": doc("Suites", "See [`TESTING.md`](../governance/TESTING.md) §1. It also names §7."),
      "CLAUDE.md": pairIndex,
    });

    expect(messages(root)).toEqual(["intra-document `§7` does not resolve to a section in this file"]);
  });
});
