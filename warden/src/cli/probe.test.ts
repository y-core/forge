import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { probe, probeSetsOf } from "./probe";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function doc(gloss: string, body: string): string {
  return `---\ntitle: Rules\ndescription: "One."\n---\n\n## 0. Quick Reference\n\n- §1 One: ${gloss}\n\n## 1. One\n\n${body}\n`;
}

function repo(prefix: string, files: readonly (readonly [string, string])[]): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  for (const [path, source] of files) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source, "utf-8");
  }
  return root;
}

const CORPUS = [
  ["warden/canon/shared/CODE_RULES.md", doc("the comment budget", "A comment earns its line or it is deleted.")],
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

  it("removes the scratch index it built, leaving no directory of its own in the temp dir", () => {
    const scratch = () => readdirSync(tmpdir()).filter((name) => /^warden-probe-[^-]{6}$/.test(name));
    const before = scratch();

    measure("warden-probe-scratch-");

    expect(scratch()).toEqual(before);
  });

  it("refuses a root whose corpus roots find nothing, rather than reporting an empty index as a result", () => {
    const root = repo("warden-probe-empty-", [["package.json", "{}"]]);

    expect(() => probe({ root, kind: "libs", canonRoot: join(root, "warden/canon") })).toThrow("discovery found no document to index");
  });
});

const QUERY = `{ query: "comment budget", expect: "canon:CODE_RULES.md#1", dimension: "prohibition" }`;
const PARSED = { query: "comment budget", expect: "canon:CODE_RULES.md#1", dimension: "prohibition" };

/** A step table exporting one row under `label`, carrying the sets when `sets` is given. */
function table(label: string, sets: boolean): string {
  const carried = sets ? `, golden: [${QUERY}], negative: ["taxes"]` : "";
  return `export default { tiers: { static: [{ label: ${JSON.stringify(label)}, run: () => ({ ok: true, findings: [] })${carried} }] } };\n`;
}

describe("probeSetsOf()", () => {
  it("reads the sets off the step table's golden row", async () => {
    const root = repo("warden-sets-table-", [["config/steps.config.ts", table("warden:queries", true)]]);

    expect(await probeSetsOf(undefined, root)).toEqual({ golden: [PARSED], negative: ["taxes"] });
  });

  it("names the fix when the step table will not load", async () => {
    const root = repo("warden-sets-missing-", [["package.json", "{}"]]);

    await expect(probeSetsOf(undefined, root)).rejects.toThrow("cannot load");
  });

  it("names the fix when the module default-exports no step table", async () => {
    const root = repo("warden-sets-notable-", [["config/steps.config.ts", "export default [];\n"]]);

    await expect(probeSetsOf(undefined, root)).rejects.toThrow("default-exports no defineSteps");
  });

  it("names the fix when the table declares no golden row", async () => {
    const root = repo("warden-sets-norow-", [["config/steps.config.ts", table("lint", false)]]);

    await expect(probeSetsOf(undefined, root)).rejects.toThrow("declares no `warden:queries` row");
  });

  // Never a silent fall-through to the shipped pair: that is what let a renamed set be reported as a
  // corpus regression rather than as a missing file.
  it("requires an explicit module to default-export a golden set", async () => {
    const root = repo("warden-sets-explicit-", [["config/warden.config.ts", "export default { negative: [] };\n"]]);

    await expect(probeSetsOf(join(root, "config/warden.config.ts"), root)).rejects.toThrow("default-exports no `golden` set");
  });

  it("takes an explicit module's sets, defaulting its negative set to empty", async () => {
    const root = repo("warden-sets-golden-", [["config/warden.config.ts", `export default { golden: [${QUERY}] };\n`]]);

    expect(await probeSetsOf(join(root, "config/warden.config.ts"), root)).toEqual({ golden: [PARSED], negative: [] });
  });

  it("resolves a relative explicit module against the repository root", async () => {
    const root = repo("warden-sets-relative-", [["config/warden.config.ts", `export default { golden: [${QUERY}] };\n`]]);

    expect(await probeSetsOf("config/warden.config.ts", root)).toEqual({ golden: [PARSED], negative: [] });
  });
});
