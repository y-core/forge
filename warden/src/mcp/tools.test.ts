import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { openIndex } from "../index/open";
import { CORPORA } from "../types";
import { callTool, TOOLS } from "./tools";

const DOC =
  '---\ntitle: Rules\ndescription: "One."\n---\n\n> Defers to: `AGENT_GUIDE.md` §1 for the form.\n\n## 0. Quick Reference\n\n- §1 One: the comment budget\n\n## 1. One\n\nThe comment budget is a ceiling.\n';

const root = mkdtempSync(join(tmpdir(), "warden-tools-"));
const canonRoot = join(root, "canon");
for (const path of [join(root, "docs/A.md"), join(canonRoot, "libs/CODE_RULES.md"), join(canonRoot, "shared/AGENT_GUIDE.md")]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, DOC, "utf-8");
}
const knowledge = openIndex(root, "libs", { path: ":memory:", canonRoot, canonVersion: "1.0.0" });

describe("TOOLS", () => {
  it("declares a required argument for every tool, so a caller cannot omit the one that matters", () => {
    for (const tool of TOOLS) expect((tool.inputSchema as { required: string[] }).required.length).toBeGreaterThan(0);
  });

  it("offers every corpus in the search schema, since an agent will not use a filter it is not told about", () => {
    const schema = TOOLS.find((tool) => tool.name === "knowledge_search")?.inputSchema as
      | { properties: { corpus: { enum: string[] } } }
      | undefined;

    expect(schema?.properties.corpus.enum).toEqual([...CORPORA]);
  });

  it("names each tool distinctly", () => {
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
  });
});

describe("callTool()", () => {
  it("returns ranked ids a caller can hand straight to knowledge_read", () => {
    const result = callTool(knowledge, "knowledge_search", { query: "comment budget" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("canon:CODE_RULES.md#1");
  });

  // An unknown corpus reaches SQL as a literal no row carries, and this tool's contract is that an
  // empty result means nothing here governs the question — so a typo would be reported as law.
  it("refuses a corpus it does not know rather than answering nothing", () => {
    const result = callTool(knowledge, "knowledge_search", { query: "comment budget", corpus: "cannon" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('knowledge_search: `corpus` must be one of canon, project, dependency, not "cannon"');
  });

  it("names an uncovered question as a property of the corpus, not as a failed lookup", () => {
    const text = callTool(knowledge, "knowledge_search", { query: "zzzzz" }).content[0]?.text ?? "";

    expect(text).toContain("No section of this corpus covers");
    expect(text).toContain("do not infer a rule from a near miss");
  });

  it("refuses an empty query rather than returning the whole corpus", () => {
    expect(callTool(knowledge, "knowledge_search", { query: "   " }).isError).toBe(true);
  });

  it("says which corpus a hit governs, since a repository specialises the canon under the same name", () => {
    const canon = callTool(knowledge, "knowledge_search", { query: "comment budget", corpus: "canon" }).content[0]?.text ?? "";
    const local = callTool(knowledge, "knowledge_search", { query: "comment budget", corpus: "project" }).content[0]?.text ?? "";

    expect(canon).toContain("fleet canon");
    expect(local).toContain("this repository");
  });

  it("says it on a read too, which is where acting on the wrong one of the pair does the damage", () => {
    expect(callTool(knowledge, "knowledge_read", { id: "canon:CODE_RULES.md#1" }).content[0]?.text).toContain("fleet canon");
  });

  it("reads one section whole", () => {
    expect(callTool(knowledge, "knowledge_read", { id: "canon:CODE_RULES.md#1" }).content[0]?.text).toContain("The comment budget is a ceiling.");
  });

  it("points a bad id back at search rather than failing blankly", () => {
    const result = callTool(knowledge, "knowledge_read", { id: "nonsense" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("knowledge_search");
  });

  it("outlines a document with the chunk id of every section", () => {
    const text = callTool(knowledge, "knowledge_outline", { path: "CODE_RULES.md" }).content[0]?.text ?? "";

    expect(text).toContain("§1 One");
    expect(text).toContain("canon:CODE_RULES.md#1");
  });

  it("returns the edges a section declares", () => {
    expect(callTool(knowledge, "knowledge_related", { id: "canon:CODE_RULES.md#1" }).content[0]?.text).toContain("defers");
  });

  it("names an unknown tool rather than answering it", () => {
    expect(callTool(knowledge, "knowledge_guess", {}).isError).toBe(true);
  });
});
