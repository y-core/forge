import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build } from "../index/build";
import { openDatabase } from "../index/db";
import type { Corpus, SourceDoc } from "../types";
import { renderCatalogue } from "./render";

function doc(title: string, description: string): string {
  return `---\ntitle: ${title}\ndescription: "${description}"\n---\n\n## 0. Quick Reference\n\n- §1 One: what it decides\n\n## 1. One\n\nBody.\n`;
}

const root = mkdtempSync(join(tmpdir(), "warden-catalogue-"));
const sources: SourceDoc[] = [
  ["canon", "libs", "CODE_RULES.md", "Six rules every source file obeys."],
  ["canon", "shared", "AGENT_GUIDE.md", "How a governing document is written."],
  ["project", undefined, "docs/NAMESPACES.md", "This repository's subpath catalog."],
  ["dependency", undefined, "forge/UI_CLASS_COMPOSITION.md", "How the library composes class strings."],
].map(([corpus, tree, path, description]) => {
  const file = join(root, String(path).replace("/", "-"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, doc(String(path), String(description)), "utf-8");
  return { corpus: corpus as Corpus, ...(tree === undefined ? {} : { tree: tree as "libs" }), path: String(path), file, weight: 1.3 };
});

const db = openDatabase(":memory:");
build(db, sources, "1.0.0");
const rendered = renderCatalogue(db);

describe("renderCatalogue()", () => {
  it("lists every canon document with the sentence its own frontmatter uses", () => {
    expect(rendered).toContain("- `CODE_RULES.md` — CODE_RULES.md: Six rules every source file obeys.");
    expect(rendered).toContain("- `AGENT_GUIDE.md` — AGENT_GUIDE.md: How a governing document is written.");
  });

  it("leaves the local half out — it varies per repository and would make the file unstable", () => {
    expect(rendered).not.toContain("NAMESPACES.md");
  });

  it("lists the local half under its own heading when asked, which is what the resource serves", () => {
    const both = renderCatalogue(db, { local: true });
    expect(both).toContain("## This repository — its own documents");
    expect(both).toContain("- `docs/NAMESPACES.md` — docs/NAMESPACES.md: This repository's subpath catalog.");
    expect(both).toContain("- `CODE_RULES.md` — CODE_RULES.md: Six rules every source file obeys.");
    expect(both.indexOf("## Libraries")).toBeLessThan(both.indexOf("## This repository"));
  });

  it("groups by tree, in a fixed order", () => {
    expect(rendered.indexOf("## Libraries")).toBeLessThan(rendered.indexOf("## Shared"));
  });

  it("carries nothing that changes when prose changes without the document set changing", () => {
    expect(rendered).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    expect(rendered).not.toMatch(/\b\d+ documents?\b/);
    expect(rendered).not.toContain("1.0.0");
  });

  it("is byte-identical on a second render, which is what a drift check depends on", () => {
    expect(renderCatalogue(db)).toBe(rendered);
  });
});

describe("renderCatalogue() — the corpus a row is filed under", () => {
  // A `row.corpus === "project" ? … : …` filed every corpus that was not `project` under the fleet
  // canon's heading — in the resource an agent reads before it asks anything.
  it("gives the installed library a heading of its own, and says the rules are the library's", () => {
    const served = renderCatalogue(db, { local: true });

    expect(served).toContain("## The installed library — advisory, and about the library rather than this repository");
    expect(served).toContain("- `forge/UI_CLASS_COMPOSITION.md` — forge/UI_CLASS_COMPOSITION.md: How the library composes class strings.");
  });

  // The committed `warden/CATALOGUE.md` is forge's own inventory of the fleet canon, and is safe
  // only because this defaults to canon alone. A dependency row reaching it would fail every
  // consumer's catalogue-drift check for a file none of them wrote.
  it("keeps the committed file canon-only, whatever else the index holds", () => {
    expect(rendered).not.toContain("forge/UI_CLASS_COMPOSITION.md");
    expect(rendered).not.toContain("docs/NAMESPACES.md");
  });
});
