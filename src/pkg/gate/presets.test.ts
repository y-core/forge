import { describe, expect, it } from "bun:test";
import { cloudflareWorkerSteps, forgeChecks } from "./presets";
import { isCheckStep, type Step } from "./steps";

function labelsOf(steps: readonly Step[]): string[] {
  return steps.map((step) => step.label);
}

function fixerOf(step: Step | undefined): readonly string[] | undefined {
  return step === undefined || isCheckStep(step) ? undefined : step.fix;
}

describe("cloudflareWorkerSteps() — shape", () => {
  it("emits the fleet's order, minus the optional asset step", () => {
    expect(labelsOf(cloudflareWorkerSteps())).toEqual(["cf:types:runtime", "cf:types:bindings", "typecheck", "lint", "test"]);
  });

  it("inserts types:assets after the binding types and before the type check", () => {
    expect(labelsOf(cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }))).toEqual([
      "cf:types:runtime",
      "cf:types:bindings",
      "types:assets",
      "typecheck",
      "lint",
      "test",
    ]);
  });

  it("gives every step a unique label", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }));

    expect(new Set(labels).size).toBe(labels.length);
  });

  it("marks no step full-only, so the preset is the same table either mode selects", () => {
    for (const step of cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" })) {
      expect(step.fullOnly).toBeUndefined();
    }
  });
});

describe("cloudflareWorkerSteps() — the §6c property", () => {
  it("declares no machine prerequisite on any step", () => {
    const gated = cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts", workerConfig: "wrangler.workers.jsonc" }).filter(
      (step) => step.requires !== undefined,
    );

    expect(labelsOf(gated)).toEqual([]);
  });
});

describe("cloudflareWorkerSteps() — the generated-type commands", () => {
  it("splits `wrangler types` into its two real invocations", () => {
    const steps = cloudflareWorkerSteps();

    expect(steps.find((s) => s.label === "cf:types:runtime")?.cmd).toEqual(["wrangler", "types", "./.types/cloudflare.d.ts", "--no-include-env"]);
    expect(steps.find((s) => s.label === "cf:types:bindings")?.cmd).toEqual([
      "wrangler",
      "types",
      "./.types/worker-configuration.d.ts",
      "--no-include-runtime",
    ]);
  });

  it("puts --config on the bindings invocation only, because runtime types do not depend on it", () => {
    const steps = cloudflareWorkerSteps({ workerConfig: "wrangler.workers.jsonc" });

    expect(steps.find((s) => s.label === "cf:types:runtime")?.cmd).not.toContain("--config");
    expect(steps.find((s) => s.label === "cf:types:bindings")?.cmd).toEqual([
      "wrangler",
      "types",
      "./.types/worker-configuration.d.ts",
      "--no-include-runtime",
      "--config",
      "wrangler.workers.jsonc",
    ]);
  });

  it("omits both wrangler steps for an app that declares its binding types by hand", () => {
    expect(labelsOf(cloudflareWorkerSteps({ wranglerTypes: false }))).toEqual(["typecheck", "lint", "test"]);
  });

  it("emits the asset step with --out, since the emitter writes nothing useful without one", () => {
    const assets = cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }).find((s) => s.label === "types:assets");

    expect(assets?.cmd).toEqual(["forge-assets", "types", "--config", "src/assets/config.ts", "--out", ".forge/assets.ts"]);
  });

  it("lets an app place the emitted module somewhere other than .forge/assets.ts", () => {
    const assets = cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts", assetOut: "generated/assets.ts" }).find(
      (s) => s.label === "types:assets",
    );

    expect(assets?.cmd).toEqual(["forge-assets", "types", "--config", "src/assets/config.ts", "--out", "generated/assets.ts"]);
  });

  it("omits types:assets entirely when no asset config is given", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("types:assets");
  });
});

describe("cloudflareWorkerSteps() — options", () => {
  it("defaults the linted and tested paths to src/ and tests/", () => {
    const steps = cloudflareWorkerSteps();

    expect(steps.find((step) => step.label === "lint")?.cmd).toEqual(["biome", "check", "src/", "tests/"]);
    expect(steps.find((step) => step.label === "test")?.cmd).toEqual(["bun", "test", "tests/"]);
  });

  it("threads sources through both the lint command and its fixer", () => {
    const lint = cloudflareWorkerSteps({ sources: ["src/", "tests/", "scripts/"] }).find((step) => step.label === "lint");

    expect(lint?.cmd).toEqual(["biome", "check", "src/", "tests/", "scripts/"]);
    expect(fixerOf(lint)).toEqual(["biome", "check", "--write", "src/", "tests/", "scripts/"]);
  });

  it("passes every test path to one bun test invocation", () => {
    const test = cloudflareWorkerSteps({ tests: ["tests/unit/", "tests/seam/"] }).find((step) => step.label === "test");

    expect(test?.cmd).toEqual(["bun", "test", "tests/unit/", "tests/seam/"]);
  });
});

describe("cloudflareWorkerSteps() — fixers", () => {
  it("gives lint the only fixer, so --fix never silently rewrites generated types", () => {
    const fixable = cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }).filter((step) => fixerOf(step) !== undefined);

    expect(labelsOf(fixable)).toEqual(["lint"]);
  });
});

const PKG = { name: "@scope/pkg", version: "1.2.3", exports: { ".": "./src/mod.ts" }, files: ["src"] };

describe("forgeChecks() — shape", () => {
  it("emits the library order, generation-free and typecheck-first", () => {
    expect(labelsOf(forgeChecks({ root: "/nowhere", pkg: PKG }))).toEqual([
      "typecheck",
      "lint",
      "test",
      "validate-exports",
      "validate-jsx",
      "validate-docs",
      "validate-changelog",
    ]);
  });

  it("holds only the changelog back to --full, so every other step is a fast-run assurance", () => {
    const held = forgeChecks({ root: "/nowhere", pkg: PKG }).filter((step) => step.fullOnly === true);

    expect(labelsOf(held)).toEqual(["validate-changelog"]);
  });

  it("omits the checks carrying project-specific policy, which a table must name explicitly", () => {
    const labels = labelsOf(forgeChecks({ root: "/nowhere", pkg: PKG }));

    expect(labels).not.toContain("validate-design");
    expect(labels).not.toContain("validate-contrast");
    expect(labels).not.toContain("validate-namespace-graph");
    expect(labels).not.toContain("validate-css-sources");
  });

  it("carries no machine prerequisite, so the whole preset is legal in a fast run", () => {
    expect(forgeChecks({ root: "/nowhere", pkg: PKG }).filter((step) => step.requires !== undefined)).toEqual([]);
  });
});

describe("forgeChecks() — options", () => {
  it("defaults lint to src/ and tests the whole project", () => {
    const steps = forgeChecks({ root: "/nowhere", pkg: PKG });

    expect(steps.find((step) => step.label === "lint")?.cmd).toEqual(["biome", "check", "src/"]);
    expect(steps.find((step) => step.label === "test")?.cmd).toEqual(["bun", "test"]);
  });

  it("threads sources and tests to the two steps that take them", () => {
    const steps = forgeChecks({ root: "/nowhere", pkg: PKG, sources: ["src/", "scripts/"], tests: ["tests/"] });

    expect(steps.find((step) => step.label === "lint")?.cmd).toEqual(["biome", "check", "src/", "scripts/"]);
    expect(steps.find((step) => step.label === "test")?.cmd).toEqual(["bun", "test", "tests/"]);
  });

  it("reads the changelog's expected version from pkg rather than taking one of its own", async () => {
    const step = forgeChecks({ root: "/nowhere/forge-no-such-root", pkg: PKG }).find((s) => s.label === "validate-changelog");

    expect(step !== undefined && isCheckStep(step)).toBe(true);
    if (step === undefined || !isCheckStep(step)) return;
    expect((await step.run()).ok).toBe(false);
  });
});
