import { describe, expect, it } from "bun:test";

import { isCheckStep } from "../../src/tooling/gate/steps";
import { changelogStep, designStep, docsStep, readmeExportsStep } from "./steps";

const EXPORTS = { ".": "./src/mod.ts" };

const STEPS = [
  docsStep({ root: "/nowhere", packageName: "@scope/pkg", exports: EXPORTS }),
  readmeExportsStep({ root: "/nowhere", readmes: [] }),
  changelogStep({ root: "/nowhere", packageVersion: "1.0.0" }),
  designStep({ root: "/nowhere", packageName: "@scope/pkg", exports: EXPORTS, designDir: "design", cssDir: "css" }),
];

describe("warden steps", () => {
  it("gives every step the label that is its `--only` token", () => {
    expect(STEPS.map((step) => step.label)).toEqual(["validate-docs", "validate-readme-exports", "validate-changelog", "validate-design"]);
  });

  it("builds check steps, never command steps", () => {
    for (const step of STEPS) expect(isCheckStep(step)).toBe(true);
  });

  it("puts the changelog on the `full` tier alone, and leaves the rest on `fast`", () => {
    expect(STEPS.map((step) => step.tier)).toEqual([undefined, undefined, "full", undefined]);
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
