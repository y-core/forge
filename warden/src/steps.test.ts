import { describe, expect, it } from "bun:test";

import { isCheckStep } from "../../src/tooling/gate/steps";
import { libraryDocsDir } from "./corpus/dependency";
import { GOLDEN, NEGATIVE } from "./gate/golden";
import { changelogStep, designStep, docsStep, wardenAppSteps, wardenQueriesStep } from "./steps";

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

  it("puts the changelog on the `full` tier alone, and leaves the rest on `fast`", () => {
    expect(STEPS.map((step) => step.tier)).toEqual([undefined, "full", undefined]);
  });

  it("lets a project pull the changelog into the fast run, overriding the default", () => {
    expect(changelogStep({ root: "/nowhere", packageVersion: "1.0.0" }, { tier: "fast" }).tier).toBeUndefined();
  });

  it("lets a project hold a check back to a higher tier", () => {
    expect(docsStep({ root: "/nowhere", packageName: "@scope/pkg", exports: EXPORTS }, { tier: "standard" }).tier).toBe("standard");
  });

  it("hands the config it was given to the check, rather than capturing one of its own", async () => {
    const step = changelogStep({ root: "/nowhere/forge-no-such-root", packageVersion: "1.0.0" });

    const result = await step.run("fast");

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => `${finding.file}: ${finding.message}`)).toEqual(["CHANGELOG.md: file does not exist"]);
  });

  it("defers the walk until the runner calls it, so building a table touches no disk", () => {
    expect(() => docsStep({ root: "/nowhere/forge-no-such-root", packageName: "@scope/pkg", exports: EXPORTS })).not.toThrow();
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
    packageName: "forge-starter",
    queries: [{ query: "where do tests live", expect: "canon:TESTING.md#2a", dimension: "placement" }] as const,
    citableDirs: ["node_modules/@y-core/forge/warden/canon/shared"],
  };

  it("appends the rows a consuming application takes, in order", () => {
    expect(wardenAppSteps(options).map((step) => step.label)).toEqual(["validate-docs", "warden:index", "warden:queries", "warden:duplicates"]);
  });

  it("appends nothing to `citableDirs` where there is no installed library", () => {
    // Run inside the library, `libraryDocsDir` is `undefined` — the same condition under which the
    // three index rows serve no dependency corpus — so a consumer's list reaches the check as given.
    expect(libraryDocsDir(options.root)).toBeUndefined();
  });

  it("builds check steps, and touches no disk doing it", () => {
    expect(() => wardenAppSteps(options).every((step) => isCheckStep(step))).not.toThrow();
    expect(wardenAppSteps(options).every((step) => isCheckStep(step))).toBe(true);
  });
});
