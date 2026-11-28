import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { openIndex } from "../index/open";
import { CORPORA } from "../types";
import { callTool, knowledgeTools } from "./tools";

const roots: string[] = [];
afterAll(() => {
  for (const tempRoot of roots) rmSync(tempRoot, { recursive: true, force: true });
});

const DOC =
  '---\ntitle: Rules\ndescription: "One."\n---\n\n> Defers to: `AGENT_GUIDE.md` §1 for the form.\n\n## 0. Quick Reference\n\n- §1 One: the comment budget\n\n## 1. One\n\nThe comment budget is a ceiling.\n';

const root = mkdtempSync(join(tmpdir(), "warden-tools-"));
roots.push(root);
const canonRoot = join(root, "canon");
for (const path of [join(root, "docs/A.md"), join(canonRoot, "libs/CODE_RULES.md"), join(canonRoot, "shared/AGENT_GUIDE.md")]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, DOC, "utf-8");
}
const knowledge = openIndex(root, "libs", { path: ":memory:", canonRoot, canonVersion: "1.0.0" });

const tools = knowledgeTools(knowledge);

describe("knowledgeTools()", () => {
  // `warden_check` with no argument sweeps the whole tree, which is a meaningful call.
  it("declares a required argument for every tool but the tree-wide sweep, so a caller cannot omit the one that matters", async () => {
    for (const tool of tools.filter(({ name }) => name !== "warden_check"))
      expect((tool.inputSchema as { required: string[] }).required.length).toBeGreaterThan(0);
  });

  it("serialises the whole tool list in about 1.5k tokens, which every session pays before its first call", async () => {
    expect(Math.ceil(JSON.stringify(tools).length / 4)).toBeLessThanOrEqual(1500);
  });

  it("offers every corpus in the search schema, since an agent will not use a filter it is not told about", async () => {
    const schema = tools.find((tool) => tool.name === "knowledge_search")?.inputSchema as
      | { properties: { corpus: { enum: string[] } } }
      | undefined;

    expect(schema?.properties.corpus.enum).toEqual([...CORPORA]);
  });

  it("names each tool distinctly", async () => {
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
  });

  // A host that is not told a tool only reads asks before every call, which costs a turn each time.
  it("declares every tool read-only, non-destructive and closed-world", async () => {
    for (const tool of tools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
      expect(tool.annotations.openWorldHint).toBe(false);
      expect(tool.annotations.idempotentHint).toBe(true);
      expect(tool.annotations.title).not.toBe("");
    }
  });

  it("names the documents it holds in the search description, so scope is known before a turn is spent", async () => {
    const description = tools.find((tool) => tool.name === "knowledge_search")?.description ?? "";
    const line = description.split("\n").at(-1) ?? "";

    expect(line).toContain("Covers: ");
    expect(line).toContain("CODE_RULES.md");
    expect(line).toContain("(2 canon, 1 project documents).");
  });
});

describe("callTool()", () => {
  it("returns ranked ids a caller can hand straight to knowledge_read", async () => {
    const result = await callTool(knowledge, "knowledge_search", { query: "comment budget" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("canon:CODE_RULES.md#1");
  });

  // An unknown corpus reaches SQL as a literal no row carries, and this tool's contract is that an
  // empty result means nothing here governs the question — so a typo would be reported as law.
  it("refuses a corpus it does not know rather than answering nothing", async () => {
    const result = await callTool(knowledge, "knowledge_search", { query: "comment budget", corpus: "cannon" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('knowledge_search: `corpus` must be one of canon, project, dependency, not "cannon"');
  });

  it("renders each hit as `renderHit` does, so the CLI and this tool describe one corpus", async () => {
    const result = await callTool(knowledge, "knowledge_search", { query: "comment budget", corpus: "canon", limit: 1 });

    expect(result.content[0]?.text).toBe("canon:AGENT_GUIDE.md#1  (1.00, fleet canon)\n  1. One\n  One: the comment budget");
  });

  it("names an uncovered question as a property of the corpus, not as a failed lookup", async () => {
    const text = (await callTool(knowledge, "knowledge_search", { query: "zzzzz" })).content[0]?.text ?? "";

    expect(text).toContain("No section of this corpus covers");
    expect(text).toContain("do not infer a rule from a near miss");
  });

  it("refuses an empty query rather than returning the whole corpus", async () => {
    expect((await callTool(knowledge, "knowledge_search", { query: "   " })).isError).toBe(true);
  });

  it("says which corpus a hit governs, since a repository specialises the canon under the same name", async () => {
    const canon = (await callTool(knowledge, "knowledge_search", { query: "comment budget", corpus: "canon" })).content[0]?.text ?? "";
    const local = (await callTool(knowledge, "knowledge_search", { query: "comment budget", corpus: "project" })).content[0]?.text ?? "";

    expect(canon).toContain("fleet canon");
    expect(local).toContain("this repository");
  });

  it("says it on a read too, which is where acting on the wrong one of the pair does the damage", async () => {
    expect((await callTool(knowledge, "knowledge_read", { id: "canon:CODE_RULES.md#1" })).content[0]?.text).toContain("fleet canon");
  });

  it("reads one section whole", async () => {
    expect((await callTool(knowledge, "knowledge_read", { id: "canon:CODE_RULES.md#1" })).content[0]?.text).toContain(
      "The comment budget is a ceiling.",
    );
  });

  it("points a bad id back at search rather than failing blankly", async () => {
    const result = await callTool(knowledge, "knowledge_read", { id: "nonsense" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("knowledge_search");
  });

  it("outlines a document with the chunk id of every section", async () => {
    const text = (await callTool(knowledge, "knowledge_outline", { path: "CODE_RULES.md" })).content[0]?.text ?? "";

    expect(text).toContain("§1 One");
    expect(text).toContain("canon:CODE_RULES.md#1");
  });

  it("returns the edges a section declares", async () => {
    expect((await callTool(knowledge, "knowledge_related", { id: "canon:CODE_RULES.md#1" })).content[0]?.text).toContain("defers");
  });

  // `limit` is the only number a caller sets that bounds how much the server reads, and it reached
  // both the SQL pool and the final slice unchecked.
  it("clamps a limit outside [1, 50] rather than passing it through", async () => {
    const hits = async (limit: unknown): Promise<number> =>
      ((await callTool(knowledge, "knowledge_search", { query: "comment budget", limit })).content[0]?.text ?? "").split("\n\n").length;

    // Floored to 1 from below, and from above capped well under what this corpus holds is
    // not something to assert — what matters is that neither extreme reaches SQL as given.
    expect(await hits(0)).toBe(1);
    expect(await hits(-5)).toBe(1);
    expect(await hits(Number.NaN)).toBe(3);
    expect(await hits(10_000)).toBe(3);
    expect(await hits(2.7)).toBe(2);
  });

  it("names an unknown tool rather than answering it", async () => {
    expect((await callTool(knowledge, "knowledge_guess", {})).isError).toBe(true);
  });
});

describe("warden_check and warden_query", () => {
  const repo = mkdtempSync(join(tmpdir(), "warden-code-mode-"));
  roots.push(repo);
  const files: Record<string, string> = {
    "docs/RULES.md": "## 1. Rules\n\n<!-- rule:forge-no-todo --> Because.\n",
    "config/rules.config.ts": `export default [{ id: "forge-no-todo", statement: "Never leave a TODO.", detectors: [{ kind: "rg", pattern: "TODO", paths: ["src/"], level: "fail" }] }];\n`,
    "src/a.ts": "// TODO later\n",
    "src/b.ts": "fine\n",
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), body, "utf-8");
  }
  const code = openIndex(repo, "libs", { path: ":memory:", canonVersion: "1.0.0" });
  code.refresh();

  it("returns each hit and its rule's statement and rationale as JSON", async () => {
    const result = await callTool(code, "warden_check", {});
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({
      findings: [{ rule: "forge-no-todo", level: "fail", file: "src/a.ts", line: 1, match: "// TODO later" }],
      rules: [{ id: "forge-no-todo", statement: "Never leave a TODO.", rationale: "project:docs/RULES.md#1" }],
      scanned: 4,
    });
  });

  it("checks only the named files", async () => {
    expect(JSON.parse((await callTool(code, "warden_check", { files: ["src/b.ts"] })).content[0]?.text ?? "").findings).toEqual([]);
  });

  it("names an unknown rule id as an error", async () => {
    expect(await callTool(code, "warden_check", { rules: ["forge-ghost"] })).toEqual({
      content: [{ type: "text", text: "no registered rule is named `forge-ghost`" }],
      isError: true,
    });
  });

  it("returns only what a query returns, over the rules, the corpus and the steps it was given", async () => {
    const steps = [{ tier: "static", label: "lint", fixable: true }] as const;
    const query =
      "async () => ({ rules: rules.filter((r) => r.origin === 'repo' && r.detectors[0].kind === 'rg').map((r) => r.id), sections: corpus.filter((s) => s.path === 'docs/RULES.md').map((s) => s.id), steps: steps.map((s) => s.label) })";
    const result = await callTool(code, "warden_query", { code: query }, steps);

    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual({ rules: ["forge-no-todo"], sections: ["project:docs/RULES.md#1"], steps: ["lint"] });
  });

  it("refuses an empty query, and reports one that throws as an error", async () => {
    expect((await callTool(code, "warden_query", { code: " " })).isError).toBe(true);
    expect(await callTool(code, "warden_query", { code: "async () => { throw new Error('no') }" })).toEqual({
      content: [{ type: "text", text: "the query threw — Error: no" }],
      isError: true,
    });
  });
});
