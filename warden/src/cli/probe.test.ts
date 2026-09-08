import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { probe } from "./probe";

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

const CORPUS = [
  ["warden/canon/libs/CODE_RULES.md", doc("the comment budget", "A comment earns its line or it is deleted.")],
  ["docs/NAMESPACES.md", doc("where a new namespace goes", "A leaf namespace imports no sibling.")],
] as const;

function measure(prefix: string, files: readonly (readonly [string, string])[] = CORPUS): string {
  const root = repo(prefix, files);
  return probe({
    root,
    kind: "libs",
    canonRoot: join(root, "warden/canon"),
    golden: [{ query: "comment budget", expect: "canon:CODE_RULES.md#1", dimension: "prohibition" }],
    negative: ["what is the retry policy for flaky payment webhooks"],
  });
}

describe("probe()", () => {
  it("counts documents and chunks per corpus, which is the only cheap defence against an empty one", () => {
    const report = measure("warden-probe-corpora-");

    expect(report).toContain("canon       1     documents  1 chunks");
    expect(report).toContain("project     1     documents  1 chunks");
  });

  it("reports each golden query's rank, threshold, coverage and verdict", () => {
    expect(measure("warden-probe-golden-")).toContain("pass  1/3    1.000  canon:CODE_RULES.md#1");
  });

  it("names a canon document no golden query reaches, which is what the gate hard-fails on", () => {
    const report = measure("warden-probe-unreached-", [
      ...CORPUS,
      ["warden/canon/shared/AGENT_GUIDE.md", doc("how to look a rule up", "Search before inferring a rule.")],
    ]);

    expect(report).toContain("UNREACHED canon:AGENT_GUIDE.md");
  });

  it("reports the peak pool coverage of a refused question, never the top hit's", () => {
    const report = measure("warden-probe-negative-");

    expect(report).toMatch(/0\.\d{3} peak, 0 offered {2}"what is the retry policy for flaky payment webhooks"/);
  });

  // The load-bearing figure: `ABSENT_PENALTY` means a refusal can only start failing after one of
  // its terms leaves `df 0`, so this list is what a corpus enlargement is read against.
  it("reports the document frequency of every term the negative set carries", () => {
    const report = measure("warden-probe-df-");

    expect(report).toContain("0     webhooks");
    expect(report).toContain("0     payment");
  });

  it("refuses a root whose corpus roots find nothing, rather than reporting an empty index as a result", () => {
    const root = repo("warden-probe-empty-", [["package.json", "{}"]]);

    expect(() => probe({ root, kind: "libs", canonRoot: join(root, "warden/canon") })).toThrow("discovery found no document to index");
  });
});
