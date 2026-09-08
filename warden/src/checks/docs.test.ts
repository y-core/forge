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
  return `# CLAUDE.md\n\n## Governing Documents\n\n${rows.join("\n")}\n`;
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

  it("does not require a document to be registered anywhere — warden indexes it, so nothing lists it", () => {
    const root = fixtureRoot({ ".decisions/governance/TESTING.md": doc("Testing", "Body."), "CLAUDE.md": index("- nothing here") });

    expect(run(root).ok).toBe(true);
  });

  it("reports a link naming a nested document that does not exist", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      "CLAUDE.md": index(
        "- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules",
        "- [`ABSENT.md`](.decisions/governance/ABSENT.md): nothing on disk",
      ),
    });

    expect(messages(root)).toContain("link target `.decisions/governance/ABSENT.md` does not exist");
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

  it("reports a §N citation naming a document that exists in neither corpus", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      ".decisions/implementation/SUITES.md": doc("Suites", "The rule in TSETING.md §1 applies."),
      "CLAUDE.md": index(
        "- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules",
        "- [`SUITES.md`](.decisions/implementation/SUITES.md): this repository's suites",
      ),
    });

    expect(messages(root)).toContain("`TSETING.md §1` names no document in this repository or the canon");
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

const soleIndex = index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules");

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

describe("checkDocs() — a required frontmatter key", () => {
  const AUDIENCE = [{ dir: ".decisions", key: "audience", values: ["consumer", "internal"] }];
  const withRule = (root: string) =>
    checkDocs({ root, packageName: "@y-core/forge", exports: {}, requiredFrontmatter: AUDIENCE }).findings.map((finding) => finding.message);

  const repo = (frontmatter: string) =>
    fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body.").replace("title: Testing\n", `title: Testing\n${frontmatter}`),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

  it("accepts a declared value and admits the key into the allowed set", () => {
    expect(withRule(repo("audience: consumer\n"))).toEqual([]);
  });

  // A new document must fail closed rather than default into a consumer's index.
  it("fails a document that declares nothing", () => {
    expect(withRule(repo(""))).toEqual(["frontmatter is missing `audience` — one of `consumer` and `internal`"]);
  });

  it("fails a value it does not declare, so a typo cannot read as a decision", () => {
    expect(withRule(repo("audience: consumers\n"))).toEqual(["frontmatter `audience: consumers` is not one of `consumer` and `internal`"]);
  });

  // The same check validates the fleet canon and every consumer's own `docs/`, none of which can
  // carry a key one repository decided to require.
  it("leaves a repository that configures no rule exactly as it was", () => {
    expect(messages(repo(""))).toEqual([]);
    expect(messages(repo("audience: consumer\n"))).toEqual(["unexpected frontmatter key `audience` — `title` and `description` only"]);
  });
});

describe("checkDocs() — historical phrasing", () => {
  const phrases = ["previously", "no longer", "used to", "formerly", "renamed from", "fixed by", "has since", "Previously"];

  for (const phrase of phrases) {
    it(`fails on \`${phrase}\``, () => {
      const root = fixtureRoot({
        ".decisions/governance/TESTING.md": doc("Testing", `The rule ${phrase} the sentinel.`),
        "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
      });

      const result = run(root);

      expect(result.ok).toBe(false);
      expect(result.findings).toEqual([
        {
          level: "fail",
          message: `historical phrasing \`${phrase}\` — governing docs carry no history`,
          file: ".decisions/governance/TESTING.md",
          line: 12,
        },
      ]);
    });
  }

  it("does not report historical phrasing inside a fenced code block", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "```md\nThe rule previously named the sentinel.\n```"),
      "CLAUDE.md": index("- [`TESTING.md`](.decisions/governance/TESTING.md): the testing rules"),
    });

    expect(run(root).findings).toEqual([]);
  });

  it("does not report historical phrasing inside an inline code span", () => {
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

describe("checkDocs() — a configured root that is not there", () => {
  it("fails when the configured `decisionsDir` is absent, though the other roots still yield files", () => {
    const root = fixtureRoot({ ".decisions/governance/TESTING.md": doc("Testing", "Body."), "CLAUDE.md": soleIndex });

    const result = checkDocs({ root, packageName: "@y-core/forge", exports: {}, decisionsDir: "docs" });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toContain("`docs/` is configured but does not exist");
  });

  it("stays silent when `decisionsDir` is absent and was never configured", () => {
    const root = fixtureRoot({ "CLAUDE.md": index("- nothing here") });

    expect(messages(root)).toEqual([]);
  });
});

describe("checkDocs() — a citable root this repository does not own", () => {
  const canon = (rows: string) => ({
    "docs/SUITES.md": doc("Suites", rows),
    "CLAUDE.md": index("- [`SUITES.md`](docs/SUITES.md): the suites"),
    "warden/canon/libs/TESTING.md": doc("Testing", "Body."),
  });
  const runCanon = (root: string) =>
    checkDocs({ root, packageName: "@y-core/forge", exports: {}, decisionsDir: "docs", citableDirs: ["warden/canon/shared", "warden/canon/libs"] });

  it("resolves a citation into the canon", () => {
    const root = fixtureRoot(canon("See [`TESTING.md`](../warden/canon/libs/TESTING.md) §1."));

    expect(runCanon(root).findings.map((finding) => finding.message)).toEqual([]);
  });

  it("fails a citation naming a section the canon document does not have", () => {
    const root = fixtureRoot(canon("See [`TESTING.md`](../warden/canon/libs/TESTING.md) §9."));

    expect(runCanon(root).findings.map((finding) => finding.message)).toEqual([
      "`libs/TESTING.md §9` does not resolve to a section in that document",
    ]);
  });

  it("does not hold the canon itself to a consumer's own document rules", () => {
    const root = fixtureRoot(canon("Body."));

    expect(runCanon(root).ok).toBe(true);
  });

  it("reads a bare basename matching both a local document and a canon one as the local one", () => {
    const root = fixtureRoot({
      "docs/TESTING.md": doc("Testing", "It also names TESTING.md §1."),
      "CLAUDE.md": index("- [`TESTING.md`](docs/TESTING.md): the testing rules"),
      "warden/canon/libs/TESTING.md": docWithSub("Testing", "Body."),
    });

    expect(runCanon(root).findings.map((finding) => finding.message)).toEqual([]);
  });

  it("checks a bare basename matching both against the local document, not the canon one", () => {
    const root = fixtureRoot({
      "docs/TESTING.md": doc("Testing", "It also names TESTING.md §1a."),
      "CLAUDE.md": index("- [`TESTING.md`](docs/TESTING.md): the testing rules"),
      "warden/canon/libs/TESTING.md": docWithSub("Testing", "Body."),
    });

    expect(runCanon(root).findings.map((finding) => finding.message)).toEqual(["`TESTING.md §1a` does not resolve to a section in that document"]);
  });
});

describe("checkDocs() — which canon tree a bare citation means", () => {
  const trees = (body: Record<string, string>) => ({
    "docs/SUITES.md": doc("Suites", "Body."),
    "CLAUDE.md": index("- [`SUITES.md`](docs/SUITES.md): the suites"),
    "warden/canon/libs/CODE_RULES.md": doc("Code Rules", "Body."),
    "warden/canon/apps/CODE_RULES.md": doc("Code Rules", "Body."),
    "warden/canon/shared/AGENT_GUIDE.md": doc("Agent Guide", "Body."),
    ...body,
  });
  const runTrees = (root: string, kind?: "libs" | "apps") =>
    checkDocs({
      root,
      packageName: "@y-core/forge",
      exports: {},
      decisionsDir: "docs",
      ...(kind === undefined ? {} : { kind }),
      citableDirs: ["warden/canon/shared", "warden/canon/libs", "warden/canon/apps"],
      extraDirs: [
        { dir: "warden/claude/agents/libs", kind: "libs" },
        { dir: "warden/claude/agents/apps", kind: "apps" },
        { dir: "warden/canon/shared", kind: "shared" },
      ],
    }).findings.map((finding) => finding.message);

  it("resolves a citation from a kind-scoped reader to that reader's own tree", () => {
    const root = fixtureRoot(trees({ "warden/claude/agents/apps/cc-dev.md": doc("Dev", "It names CODE_RULES.md §1.") }));

    expect(runTrees(root)).toEqual([]);
  });

  it("names the reader's own tree when the cited section is missing from it", () => {
    const root = fixtureRoot(trees({ "warden/claude/agents/libs/cc-dev.md": doc("Dev", "It names CODE_RULES.md §9.") }));

    expect(runTrees(root)).toEqual(["`CODE_RULES.md §9` does not resolve to a section in that document"]);
  });

  it("falls back to `shared` for a document the reader's own tree does not carry", () => {
    const root = fixtureRoot(trees({ "warden/claude/agents/libs/cc-dev.md": doc("Dev", "It names AGENT_GUIDE.md §1.") }));

    expect(runTrees(root)).toEqual([]);
  });

  it("requires a citation from `shared` to hold in every tree carrying the document", () => {
    const root = fixtureRoot({ ...trees({}), "warden/canon/shared/AGENT_GUIDE.md": doc("Agent Guide", "It names CODE_RULES.md §1.") });

    expect(runTrees(root)).toEqual([]);
  });

  it("names the tree that is missing the section a `shared` document cites", () => {
    const root = fixtureRoot({
      ...trees({}),
      "warden/canon/shared/AGENT_GUIDE.md": doc("Agent Guide", "It names CODE_RULES.md §1a."),
      "warden/canon/libs/CODE_RULES.md": docWithSub("Code Rules", "Body."),
    });

    expect(runTrees(root)).toEqual(["`CODE_RULES.md §1a` does not resolve to a section in `apps/CODE_RULES.md`"]);
  });

  it("resolves a local citation into the canon at this repository's own kind", () => {
    const root = fixtureRoot({ ...trees({}), "docs/SUITES.md": doc("Suites", "It names CODE_RULES.md §1a.") });

    expect(runTrees(root, "libs")).toEqual(["`CODE_RULES.md §1a` does not resolve to a section in that document"]);
  });

  it("reports a local citation into a canon of more than one tree as ambiguous when no kind is declared", () => {
    const root = fixtureRoot({ ...trees({}), "docs/SUITES.md": doc("Suites", "It names CODE_RULES.md §1.") });

    expect(runTrees(root)).toEqual(["`CODE_RULES.md §1` is ambiguous — libs/CODE_RULES.md and apps/CODE_RULES.md both match; cite the path"]);
  });
});

describe("checkDocs() — extra directories", () => {
  it("discovers a document nested inside an extra directory", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      "CLAUDE.md": soleIndex,
      "warden/claude/agents/nested/cc-dev.md": doc("Dev", "Ratified on 2026-01-01."),
    });

    const result = checkDocs({ root, packageName: "@y-core/forge", exports: {}, extraDirs: ["warden/claude/agents"] });

    expect(result.findings.map((finding) => finding.message)).toEqual(["calendar date `2026-01-01` — governing docs carry no history"]);
  });

  it("leaves an unmarked extra directory's unnumbered prose alone", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      "CLAUDE.md": soleIndex,
      "corpus/floor.md": "# Floor\n\n## Verify\n\nBody.\n",
    });

    const result = checkDocs({ root, packageName: "@y-core/forge", exports: {}, extraDirs: ["corpus"] });

    expect(result.findings.map((finding) => finding.message)).toEqual([]);
  });

  it("holds a `numbered` extra directory to the numbering and Quick Reference rules", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      "CLAUDE.md": soleIndex,
      "corpus/floor.md": "# Floor\n\n## Verify\n\nBody.\n",
    });

    const result = checkDocs({ root, packageName: "@y-core/forge", exports: {}, extraDirs: [{ dir: "corpus", numbered: true }] });

    expect(result.findings.map((finding) => finding.message)).toEqual([
      "unnumbered heading `Verify` — every section needs a citable number",
      "missing YAML frontmatter",
      "no `## 0. Quick Reference` — the document has no section map",
    ]);
  });

  it("registers no citation key for a `numbered` extra directory, leaving the canon's own tree keys standing", () => {
    const root = fixtureRoot({
      "docs/SUITES.md": doc("Suites", "It names [`CODE_RULES.md`](../warden/canon/libs/CODE_RULES.md) §1."),
      "CLAUDE.md": index("- [`SUITES.md`](docs/SUITES.md): the suites"),
      "warden/canon/libs/CODE_RULES.md": doc("Code Rules", "Body."),
      "warden/canon/apps/CODE_RULES.md": doc("Code Rules", "Body."),
      "warden/canon/shared/AGENT_GUIDE.md": doc("Agent Guide", "Body."),
    });

    const result = checkDocs({
      root,
      packageName: "@y-core/forge",
      exports: {},
      decisionsDir: "docs",
      kind: "libs",
      citableDirs: ["warden/canon/shared", "warden/canon/libs", "warden/canon/apps"],
      extraDirs: [
        { dir: "warden/canon/shared", kind: "shared", numbered: true },
        { dir: "warden/canon/libs", kind: "libs", numbered: true },
        { dir: "warden/canon/apps", kind: "apps", numbered: true },
      ],
    });

    expect(result.findings.map((finding) => finding.message)).toEqual([]);
  });
});

describe("checkDocs() — what indentation hides", () => {
  it("checks a citation wrapped onto an indented continuation line", () => {
    const body = ["A rule the reader must follow, whose citation does not fit on one line", "    (see §1z for the exception)."].join("\n");
    const root = fixtureRoot({ ".decisions/governance/TESTING.md": doc("Testing", body), "CLAUDE.md": soleIndex });

    expect(messages(root)).toEqual(["intra-document `§1z` does not resolve to a section in this file"]);
  });

  it("checks an indented bullet nested under a list item", () => {
    const body = ["- The rule.", "    - the exception, added in §1z"].join("\n");
    const root = fixtureRoot({ ".decisions/governance/TESTING.md": doc("Testing", body), "CLAUDE.md": soleIndex });

    expect(messages(root)).toEqual(["intra-document `§1z` does not resolve to a section in this file"]);
  });

  it("still strips a real indented code block, which opens after a blank line and outside a list", () => {
    const body = ["The shape of a reference:", "", "    - §1z Topic: what it decides", "    - §2z Other: what it decides"].join("\n");
    const root = fixtureRoot({ ".decisions/governance/TESTING.md": doc("Testing", body), "CLAUDE.md": soleIndex });

    expect(messages(root)).toEqual([]);
  });
});

describe("checkDocs() — Quick Reference agreement", () => {
  /** A document whose Quick Reference line for §1 is `entry` and whose §1 heading is `heading`. */
  function drifted(heading: string, entry: string): string {
    return [
      "---",
      "title: Testing",
      'description: "One sentence describing what this document governs."',
      "---",
      "",
      "## 0. Quick Reference",
      "",
      `- §1 ${entry}`,
      "",
      `## 1. ${heading}`,
      "",
      "Body.",
      "",
    ].join("\n");
  }

  const at = (source: string) => fixtureRoot({ ".decisions/governance/TESTING.md": source, "CLAUDE.md": soleIndex });

  it("fails a Quick Reference line naming a section the heading no longer names", () => {
    const root = at(drifted("`tooling/lint` — a Barrel That Is Also a Plugin", "`cli/pkg/lint` — an Export Target: the published file"));

    expect(messages(root)).toEqual(["Quick Reference §1 says `cli/pkg/lint` where the heading says `tooling/lint` — one of the two is stale"]);
  });

  it("accepts an em dash in the heading against a colon in the Quick Reference", () => {
    expect(messages(at(drifted("Expected Errors — User Input", "Expected Errors: user input, not exceptions")))).toEqual([]);
  });

  it("accepts a Quick Reference that abbreviates the heading it summarises", () => {
    expect(messages(at(drifted("`htmlResponse` Pattern", "htmlResponse: full-page render")))).toEqual([]);
  });

  it("accepts a trailing parenthetical the Quick Reference drops", () => {
    expect(messages(at(drifted("Validation Namespace (valibot facade)", "Validation Namespace: the facade")))).toEqual([]);
  });

  it("says nothing about a section the Quick Reference does not list — that is the omission check's finding", () => {
    const source = drifted("One", "One: what it decides").replace("## 1. One", "## 1. One\n\nBody.\n\n## 2. Two");

    expect(messages(at(source))).toEqual(["Quick Reference omits §2"]);
  });
});

describe("checkDocs() — agreementDirs", () => {
  const canon = [
    "---",
    "title: Rules",
    'description: "One sentence describing what this document governs."',
    "---",
    "",
    "## 0. Quick Reference",
    "",
    "- §1 Governance Versus Implementation: portable rule or local fact",
    "",
    "## 1. The Canon Versus This Repository's Docs",
    "",
    "See `NOWHERE.md` §9 and `src/absent.ts`.",
    "",
  ].join("\n");

  it("holds a tree outside this repository's own docs to Quick Reference agreement", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      "CLAUDE.md": soleIndex,
      "warden/canon/shared/AGENT_GUIDE.md": canon,
    });

    // Only the agreement finding: the canon is governed prose, but the citation and path rules are
    // written against a repository's own conventions and are not the canon's to answer.
    expect(checkDocs({ root, packageName: "@y-core/forge", exports: {}, agreementDirs: ["warden/canon"] }).findings.map((f) => f.message)).toEqual([
      "Quick Reference §1 says `governance versus implementation` where the heading says `the canon versus this repository's docs` — one of the two is stale",
    ]);
  });

  it("leaves that tree entirely unread when no agreementDirs is configured", () => {
    const root = fixtureRoot({
      ".decisions/governance/TESTING.md": doc("Testing", "Body."),
      "CLAUDE.md": soleIndex,
      "warden/canon/shared/AGENT_GUIDE.md": canon,
    });

    expect(messages(root)).toEqual([]);
  });
});

describe("checkDocs() — binding a subpath to its governance", () => {
  const catalogDoc = (title: string, rows: string) =>
    `---\ntitle: ${title}\ndescription: "One sentence describing what this document governs."\n---\n\n## 0. Quick Reference\n\n- §1 Catalog: every subpath\n\n## 1. Catalog\n\n| Export Path | Source |\n| --- | --- |\n${rows}\n`;

  const catalogIndex = index("- [`NAMESPACES.md`](docs/NAMESPACES.md): the namespace catalog");

  it("passes a subpath that a prose rule binds", () => {
    const root = fixtureRoot({
      "CLAUDE.md": catalogIndex,
      "docs/NAMESPACES.md": catalogDoc(
        "Namespaces",
        "| `@y-core/forge/http` | the HTTP output namespace |\n\nEvery HTTP output concern goes to `@y-core/forge/http`.",
      ),
    });

    const result = checkDocs({
      root,
      packageName: "@y-core/forge",
      exports: { "./http": "./src/http/mod.ts" },
      decisionsDir: "docs",
      catalogs: [{ doc: "docs/NAMESPACES.md" }],
    });

    expect(result.findings.map((f) => f.message)).toEqual([]);
  });

  it("warns on a subpath a table lists and no prose binds", () => {
    const root = fixtureRoot({
      "CLAUDE.md": catalogIndex,
      "docs/NAMESPACES.md": catalogDoc("Namespaces", "| `@y-core/forge/router` | the router namespace |"),
    });

    const result = checkDocs({
      root,
      packageName: "@y-core/forge",
      exports: { "./router": "./src/router/mod.ts" },
      decisionsDir: "docs",
      catalogs: [{ doc: "docs/NAMESPACES.md" }],
    });

    expect(result.findings.map((f) => `${f.level}: ${f.message}`)).toEqual([
      "warn: `./router` is listed but bound by no prose rule — add one, or exempt it with a reason",
    ]);
  });

  it("stays silent on a table-only subpath that `listedOnlySubpaths` exempts", () => {
    const root = fixtureRoot({
      "CLAUDE.md": catalogIndex,
      "docs/NAMESPACES.md": catalogDoc("Namespaces", "| `@y-core/forge/router` | the router namespace |"),
    });

    const result = checkDocs({
      root,
      packageName: "@y-core/forge",
      exports: { "./router": "./src/router/mod.ts" },
      decisionsDir: "docs",
      catalogs: [{ doc: "docs/NAMESPACES.md" }],
      listedOnlySubpaths: ["./router"],
    });

    expect(result.findings.map((f) => f.message)).toEqual([]);
  });

  it("fails a subpath absent from a configured catalog, which is what the front page alone missed", () => {
    const root = fixtureRoot({
      "CLAUDE.md": catalogIndex,
      "docs/NAMESPACES.md": catalogDoc(
        "Namespaces",
        "| `@y-core/forge/http` | the HTTP output namespace |\n\nEvery HTTP output concern goes to `@y-core/forge/http`.",
      ),
    });

    const result = checkDocs({
      root,
      packageName: "@y-core/forge",
      exports: { "./http": "./src/http/mod.ts", "./ui/contracts/theme": "./src/ui/contracts/theme/mod.ts" },
      decisionsDir: "docs",
      catalogs: [{ doc: "docs/NAMESPACES.md" }],
      listedOnlySubpaths: ["./ui/contracts/theme"],
    });

    expect(result.findings.map((f) => `${f.level}: ${f.file ?? ""}: ${f.message}`)).toEqual([
      "fail: docs/NAMESPACES.md: `./ui/contracts/theme` is published by package.json exports but not cited — add a namespace-table row, or exempt it with a rationale",
    ]);
  });

  it("exempts a subpath from one catalog without exempting it from the other", () => {
    const root = fixtureRoot({
      "CLAUDE.md": catalogIndex,
      "README.md": "# forge\n\n| Export | Source |\n| --- | --- |\n| `@y-core/forge/warden` | the warden namespace |\n",
      "docs/NAMESPACES.md": catalogDoc(
        "Namespaces",
        "| `@y-core/forge/http` | the HTTP output namespace |\n\nEvery HTTP output concern goes to `@y-core/forge/http`.",
      ),
    });

    const result = checkDocs({
      root,
      packageName: "@y-core/forge",
      exports: { "./http": "./src/http/mod.ts", "./warden": "./warden/src/mod.ts" },
      decisionsDir: "docs",
      catalogs: [{ doc: "README.md" }, { doc: "docs/NAMESPACES.md", exempt: ["./warden"] }],
      listedOnlySubpaths: ["./warden"],
    });

    expect(result.findings.map((f) => `${f.file ?? ""}: ${f.message}`)).toEqual([
      "README.md: `./http` is published by package.json exports but not cited — add a namespace-table row, or exempt it with a rationale",
    ]);
  });
});
