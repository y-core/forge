import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { openIndex } from "../index/open";
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

  it("names each tool distinctly", () => {
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
  });
});

describe("callTool()", () => {
  it("returns ranked ids a caller can hand straight to knowledge_read", () => {
    const result = callTool(knowledge, "knowledge_search", { query: "comment budget" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("canon/libs:CODE_RULES.md#1");
  });

  it("says so plainly when nothing matches", () => {
    expect(callTool(knowledge, "knowledge_search", { query: "zzzzz" }).content[0]?.text).toContain("No match");
  });

  it("refuses an empty query rather than returning the whole corpus", () => {
    expect(callTool(knowledge, "knowledge_search", { query: "   " }).isError).toBe(true);
  });

  it("reads one section whole", () => {
    expect(callTool(knowledge, "knowledge_read", { id: "canon/libs:CODE_RULES.md#1" }).content[0]?.text).toContain(
      "The comment budget is a ceiling.",
    );
  });

  it("points a bad id back at search rather than failing blankly", () => {
    const result = callTool(knowledge, "knowledge_read", { id: "nonsense" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("knowledge_search");
  });

  it("outlines a document with the chunk id of every section", () => {
    const text = callTool(knowledge, "knowledge_outline", { path: "CODE_RULES.md" }).content[0]?.text ?? "";

    expect(text).toContain("§1 One");
    expect(text).toContain("canon/libs:CODE_RULES.md#1");
  });

  it("returns the edges a section declares", () => {
    expect(callTool(knowledge, "knowledge_related", { id: "canon/libs:CODE_RULES.md#1" }).content[0]?.text).toContain("defers");
  });

  it("names an unknown tool rather than answering it", () => {
    expect(callTool(knowledge, "knowledge_guess", {}).isError).toBe(true);
  });
});
