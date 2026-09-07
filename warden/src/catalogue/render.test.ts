import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { build } from "../index/build";
import { openDatabase } from "../index/db";
import type { SourceDoc } from "../types";
import { renderCatalogue } from "./render";

function doc(title: string, description: string): string {
  return `---\ntitle: ${title}\ndescription: "${description}"\n---\n\n## 0. Quick Reference\n\n- §1 One: what it decides\n\n## 1. One\n\nBody.\n`;
}

const root = mkdtempSync(join(tmpdir(), "warden-catalogue-"));
const sources: SourceDoc[] = [
  ["canon", "libs", "CODE_RULES.md", "Six rules every source file obeys."],
  ["canon", "shared", "AGENT_GUIDE.md", "How a governing document is written."],
  ["project", undefined, "docs/NAMESPACES.md", "This repository's subpath catalog."],
].map(([corpus, tree, path, description]) => {
  const file = join(root, String(path).replace("/", "-"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, doc(String(path), String(description)), "utf-8");
  return { corpus: corpus as "canon" | "project", ...(tree === undefined ? {} : { tree: tree as "libs" }), path: String(path), file, weight: 1.3 };
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
