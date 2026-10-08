import { describe, expect, it } from "bun:test";

import type { BundleCheckConfig } from "../src/tooling/gate/checks/types";
import { isCheckStep } from "../src/tooling/gate/steps";
import { BUNDLE_FIXER, BUNDLES, writeBundles } from "./bundles";
import { STEPS } from "./steps";

const bundleRows = () => STEPS.filter((step) => isCheckStep(step) && step.requires?.tool === "esbuild");

describe("the bundle list", () => {
  it("is exactly the set of bundle-drift rows the gate checks, so no checked bundle is one gen:bundles skips", () => {
    expect(bundleRows().map((step) => step.label)).toEqual(BUNDLES.map((row) => row.label));
  });

  it("hands each row the watches its bundle lists", () => {
    expect(bundleRows().map((step) => step.watches)).toEqual(BUNDLES.map((row) => row.watches));
  });

  it("regenerates every bundle on the list, so gen:bundles writes each one the gate checks", async () => {
    const written: BundleCheckConfig[] = [];
    await writeBundles("/repo", async (config) => {
      written.push(config);
    });

    expect(written).toEqual(BUNDLES.map(({ entry, bundle }) => ({ root: "/repo", entry, bundle, fixer: BUNDLE_FIXER })));
  });

  it("names a fixer that is the script regenerating this list", async () => {
    const pkg = (await import("../package.json")) as { scripts: Record<string, string> };

    expect([BUNDLE_FIXER, pkg.scripts["gen:bundles"]]).toEqual(["bun run gen:bundles", "bun run config/bundles.ts"]);
  });
});
