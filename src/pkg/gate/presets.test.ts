import { describe, expect, it } from "bun:test";
import { cloudflareWorkerSteps } from "./presets";
import type { Step } from "./steps";

function labelsOf(steps: readonly Step[]): string[] {
  return steps.map((step) => step.label);
}

describe("cloudflareWorkerSteps() — shape", () => {
  it("emits the fleet's order, minus the optional asset step", () => {
    expect(labelsOf(cloudflareWorkerSteps())).toEqual(["cf:typecheck", "typecheck", "lint", "test"]);
  });

  it("inserts types:assets between the binding types and the type check when a config is given", () => {
    expect(labelsOf(cloudflareWorkerSteps({ assetConfig: "assets.config.ts" }))).toEqual([
      "cf:typecheck",
      "types:assets",
      "typecheck",
      "lint",
      "test",
    ]);
  });

  it("gives every step a unique label", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ assetConfig: "assets.config.ts" }));

    expect(new Set(labels).size).toBe(labels.length);
  });

  it("puts every step in both gates, so the preset is the same table either verb selects", () => {
    for (const step of cloudflareWorkerSteps({ assetConfig: "assets.config.ts" })) {
      expect(step.gates).toEqual(["check", "verify"]);
    }
  });
});

// The property, not an incidental fact: `.decisions/TESTING.md` §6c makes `check` prerequisite-free
// so it runs on any machine with dependencies installed. Every preset step is in `check`, so a
// `requires` added to any of them would silently break that for all five repos at once.
describe("cloudflareWorkerSteps() — the §6c property", () => {
  it("declares no machine prerequisite on any step", () => {
    const gated = cloudflareWorkerSteps({ assetConfig: "assets.config.ts", workerConfig: "wrangler.worker.jsonc" }).filter(
      (step) => step.requires !== undefined,
    );

    expect(labelsOf(gated)).toEqual([]);
  });
});

describe("cloudflareWorkerSteps() — options", () => {
  it("defaults the linted and tested paths to src/ and tests/", () => {
    const steps = cloudflareWorkerSteps();

    expect(steps.find((step) => step.label === "lint")?.cmd).toEqual(["biome", "check", "src/", "tests/"]);
    expect(steps.find((step) => step.label === "test")?.cmd).toEqual(["bun", "test", "tests/"]);
  });

  it("threads sources through both the lint command and its fixer", () => {
    const lint = cloudflareWorkerSteps({ sources: ["src/", "scripts/"] }).find((step) => step.label === "lint");

    expect(lint?.cmd).toEqual(["biome", "check", "src/", "scripts/"]);
    expect(lint?.fix).toEqual(["biome", "check", "--write", "src/", "scripts/"]);
  });

  it("passes every test path to one bun test invocation", () => {
    const test = cloudflareWorkerSteps({ tests: ["tests/unit/", "tests/seam/"] }).find((step) => step.label === "test");

    expect(test?.cmd).toEqual(["bun", "test", "tests/unit/", "tests/seam/"]);
  });

  it("omits types:assets entirely when no asset config is given", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("types:assets");
  });

  it("points types:assets at the given config", () => {
    const assets = cloudflareWorkerSteps({ assetConfig: "assets.config.ts" }).find((step) => step.label === "types:assets");

    expect(assets?.cmd).toEqual(["forge-assets", "types", "--config", "assets.config.ts"]);
  });

  it("runs a bare `wrangler types` when no worker config is named", () => {
    expect(cloudflareWorkerSteps()[0]?.cmd).toEqual(["wrangler", "types"]);
  });

  it("adds --config to cf:typecheck for an app with a second wrangler config", () => {
    expect(cloudflareWorkerSteps({ workerConfig: "wrangler.worker.jsonc" })[0]?.cmd).toEqual([
      "wrangler",
      "types",
      "--config",
      "wrangler.worker.jsonc",
    ]);
  });
});

describe("cloudflareWorkerSteps() — fixers", () => {
  it("gives lint the only fixer, so --fix never silently rewrites generated types", () => {
    const fixable = cloudflareWorkerSteps({ assetConfig: "assets.config.ts" }).filter((step) => step.fix !== undefined);

    expect(labelsOf(fixable)).toEqual(["lint"]);
  });
});
