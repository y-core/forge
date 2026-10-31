import { describe, expect, it } from "bun:test";

import { cloudflareWorkerSteps } from "../../src/tooling/gate/presets";
import { isCheckStep } from "../../src/tooling/gate/steps";
import { declaredSteps, mergeTiers, resolveTiers } from "../../src/tooling/gate/tiers";
import { libraryDocsDir } from "./corpus/dependency";
import { GOLDEN, NEGATIVE } from "./gate/golden";
import { changelogStep, designStep, docsStep, duplicatesStep, wardenAppSteps, wardenQueriesStep, wardenStep } from "./steps";

const EXPORTS = { ".": "./src/mod.ts" };

const STEPS = [
  docsStep({ root: "/nowhere", packageName: "@scope/pkg", exports: EXPORTS }),
  changelogStep({ root: "/nowhere", packageVersion: "1.0.0" }),
  designStep({ root: "/nowhere", packageName: "@scope/pkg", exports: EXPORTS, designDir: "design", cssDir: "css" }),
];

describe("warden steps", () => {
  it("gives every step the label that is its `--only` token", () => {
    expect(STEPS.map((step) => step.label)).toEqual(["validate-docs", "validate-changelog", "validate-design"]);
  });

  it("builds check steps, never command steps", () => {
    for (const step of STEPS) expect(isCheckStep(step)).toBe(true);
  });

  it("hands the config it was given to the check, rather than capturing one of its own", async () => {
    const step = changelogStep({ root: "/nowhere/forge-no-such-root", packageVersion: "1.0.0" });

    const result = await step.run("static");

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => `${finding.file}: ${finding.message}`)).toEqual(["CHANGELOG.md: file does not exist"]);
  });

  it("defers the walk until the runner calls it, so building a table touches no disk", () => {
    expect(() => docsStep({ root: "/nowhere/forge-no-such-root", packageName: "@scope/pkg", exports: EXPORTS })).not.toThrow();
  });
});

describe("warden steps — watches", () => {
  it("derives the changelog row's watches from the two files it reads", () => {
    expect(changelogStep({ root: "/nowhere", packageVersion: "1.0.0" }).watches).toEqual(["CHANGELOG.md", "config/changelog-sections.json"]);
  });

  it("honours the changelog row's file and sectionsFile overrides", () => {
    const step = changelogStep({ root: "/nowhere", packageVersion: "1.0.0", file: "HISTORY.md", sectionsFile: "meta/sections.json" });

    expect(step.watches).toEqual(["HISTORY.md", "meta/sections.json"]);
  });

  it("derives nothing for the rows that read paths across the tree", () => {
    const scope = { root: "/nowhere", kind: "libs" } as const;
    const rows = [
      docsStep({ root: "/nowhere", packageName: "@scope/pkg", exports: EXPORTS }),
      designStep({ root: "/nowhere", packageName: "@scope/pkg", exports: EXPORTS, designDir: "design", cssDir: "css" }),
      wardenStep(scope),
      wardenQueriesStep(scope),
      duplicatesStep(scope),
    ];

    expect(rows.filter((step) => Object.hasOwn(step, "watches")).map((step) => step.label)).toEqual([]);
  });
});

describe("wardenQueriesStep()", () => {
  it("carries the shipped sets where the caller states none", () => {
    const step = wardenQueriesStep({ root: "/nowhere", kind: "libs" });

    expect(step.golden).toBe(GOLDEN);
    expect(step.negative).toBe(NEGATIVE);
  });

  it("carries the caller's own sets where it states them", () => {
    const queries = [{ query: "where do tests live", expect: "canon:TESTING.md#2a", dimension: "placement" }] as const;

    const step = wardenQueriesStep({ root: "/nowhere", kind: "apps", queries, negative: ["how do I file my taxes"] });

    expect(step.golden).toBe(queries);
    expect(step.negative).toEqual(["how do I file my taxes"]);
  });
});

describe("wardenAppSteps()", () => {
  const options = {
    root: "/nowhere/forge-no-such-root",
    packageName: "consumer-app",
    queries: [{ query: "where do tests live", expect: "canon:TESTING.md#2a", dimension: "placement" }] as const,
    citableDirs: ["node_modules/@y-core/forge/warden/canon/shared"],
  };

  it("declares the docs row on static and the index rows on unit, with no refs and no other tier", () => {
    const tiers = wardenAppSteps(options);

    expect(Object.keys(tiers)).toEqual(["static", "unit"]);
    expect(tiers.static?.map((entry) => ("label" in entry ? entry.label : entry))).toEqual(["validate-docs"]);
    expect(tiers.unit?.map((entry) => ("label" in entry ? entry.label : entry))).toEqual(["warden:index", "warden:queries", "warden:duplicates"]);
  });

  it("merges onto the Cloudflare preset into a table that resolves, the index rows after `test`", () => {
    const merged = resolveTiers(mergeTiers(cloudflareWorkerSteps({ root: options.root }), wardenAppSteps(options)));

    if (!merged.ok) throw new Error(merged.error);
    expect(merged.data.unit?.steps.map((step) => step.label).slice(-4)).toEqual(["test", "warden:index", "warden:queries", "warden:duplicates"]);
    expect(merged.data.static?.steps.map((step) => step.label)).toContain("validate-docs");
  });

  it("appends nothing to `citableDirs` where there is no installed library", () => {
    // Run inside the library, `libraryDocsDir` is `undefined` — the same condition under which the
    // three index rows serve no dependency corpus — so a consumer's list reaches the check as given.
    expect(libraryDocsDir(options.root)).toBeUndefined();
  });

  it("builds check steps, and touches no disk doing it", () => {
    expect(() => declaredSteps(wardenAppSteps(options)).every((step) => isCheckStep(step))).not.toThrow();
    expect(declaredSteps(wardenAppSteps(options)).every((step) => isCheckStep(step))).toBe(true);
  });
});
