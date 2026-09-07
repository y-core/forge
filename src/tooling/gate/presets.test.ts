import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cloudflareWorkerSteps, forgeChecks } from "./presets";
import { isCheckStep, type Step } from "./steps";

function labelsOf(steps: readonly Step[]): string[] {
  return steps.map((step) => step.label);
}

function fixerOf(step: Step | undefined): readonly string[] | undefined {
  return step === undefined || isCheckStep(step) ? undefined : step.fix;
}

const DESIGN = { stylesheet: "src/assets/tailwind.css", cssDir: "src/assets" };

describe("cloudflareWorkerSteps() — shape", () => {
  it("emits the fleet's order, minus the optional asset step", () => {
    expect(labelsOf(cloudflareWorkerSteps())).toEqual(["types:cf-runtime", "types:cf-bindings", "typecheck", "lint", "format", "test"]);
  });

  it("inserts types:assets, then the check that judges what it wrote, before the type check", () => {
    expect(labelsOf(cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }))).toEqual([
      "types:cf-runtime",
      "types:cf-bindings",
      "types:assets",
      "validate-asset-manifest",
      "typecheck",
      "lint",
      "format",
      "test",
    ]);
  });

  it("gives every step a unique label", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }));

    expect(new Set(labels).size).toBe(labels.length);
  });

  it("puts every step of the default table on the fast tier, so all three modes select the same table", () => {
    for (const step of cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" })) {
      expect(step.tier).toBeUndefined();
    }
  });

  it("makes test:browser the only row above the fast tier once the browser opt-in is taken", () => {
    const held = cloudflareWorkerSteps({ browser: true, design: DESIGN }).filter((step) => step.tier !== undefined);

    expect(held.map((step) => [step.label, step.tier])).toEqual([["test:browser", "full"]]);
  });
});

describe("cloudflareWorkerSteps() — the §6c property", () => {
  it("declares no machine prerequisite on any step of the default table", () => {
    const gated = cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts", workerConfig: "wrangler.workers.jsonc" }).filter(
      (step) => step.requires !== undefined,
    );

    expect(labelsOf(gated)).toEqual([]);
  });

  it("gates only the two compiling design rows and the browser row once the opt-ins are taken", () => {
    const gated = cloudflareWorkerSteps({ browser: true, design: DESIGN }).filter((step) => step.requires !== undefined);

    expect(labelsOf(gated)).toEqual(["validate-class-tokens", "validate-css-tokens", "test:browser"]);
    expect(gated.map((step) => step.requires?.tool)).toEqual(["tailwindcss", "tailwindcss", "chromium"]);
  });
});

describe("cloudflareWorkerSteps() — the browser row", () => {
  it("puts test:browser last, on the full tier and behind the downloaded browser", () => {
    const steps = cloudflareWorkerSteps({ browser: true, assetConfig: "src/assets/config.ts", workerConfig: "wrangler.workers.jsonc" });
    const browser = steps.at(-1);

    expect(browser?.label).toBe("test:browser");
    expect(browser?.tier).toBe("full");
    expect(browser?.requires?.tool).toBe("chromium");
  });

  it("omits the row for an app with no browser suite", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("test:browser");
    expect(labelsOf(cloudflareWorkerSteps({ browser: false }))).not.toContain("test:browser");
  });
});

describe("cloudflareWorkerSteps() — the design rows", () => {
  it("emits three rows before test when no cssDir is given", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ design: { stylesheet: "src/assets/tailwind.css" } }));

    expect(labels).toEqual([
      "types:cf-runtime",
      "types:cf-bindings",
      "typecheck",
      "lint",
      "format",
      "validate-modern-css",
      "validate-class-order",
      "validate-class-tokens",
      "test",
    ]);
    expect(labels).not.toContain("validate-css-tokens");
  });

  it("adds validate-css-tokens as the fourth row when a cssDir is given", () => {
    expect(labelsOf(cloudflareWorkerSteps({ design: DESIGN }))).toEqual([
      "types:cf-runtime",
      "types:cf-bindings",
      "typecheck",
      "lint",
      "format",
      "validate-modern-css",
      "validate-class-order",
      "validate-class-tokens",
      "validate-css-tokens",
      "test",
    ]);
  });

  it("omits every design row for an app that does not use ui/*", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }));

    expect(labels).toEqual([
      "types:cf-runtime",
      "types:cf-bindings",
      "types:assets",
      "validate-asset-manifest",
      "typecheck",
      "lint",
      "format",
      "test",
    ]);
  });

  // The step configs are captured in a closure, so the default is pinned by running the check: a
  // spec's deliberately self-conflicting literal must be out of scope unless the app names `tests/`.
  it("defaults design.sources to src/ only, so class-order never reads a spec's fixture literal", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-preset-"));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "tests"));
    writeFileSync(join(root, "src", "view.tsx"), 'export const view = <div class="flex p-4" />;\n');
    // Assembled rather than written out, so forge's own `validate-class-order` — which reads this
    // file — never sees the conflicting literal it is here to prove the preset does not read.
    const conflicting = ["p-2", "p-4"].join(" ");
    writeFileSync(join(root, "tests", "cn.test.tsx"), `export const fixture = <div class="${conflicting}" />;\n`);

    expect(await classOrderResult({ root, design: { stylesheet: "x.css" } })).toBe(true);
    expect(await classOrderResult({ root, design: { stylesheet: "x.css", sources: ["src/", "tests/"] } })).toBe(false);

    rmSync(root, { recursive: true, force: true });
  });
});

async function classOrderResult(options: Parameters<typeof cloudflareWorkerSteps>[0]): Promise<boolean> {
  const step = cloudflareWorkerSteps(options).find((s) => s.label === "validate-class-order");
  if (step === undefined || !isCheckStep(step)) throw new Error("validate-class-order missing");
  return (await step.run("fast")).ok;
}

describe("cloudflareWorkerSteps() — the generated-type commands", () => {
  it("splits `wrangler types` into its two real invocations", () => {
    const steps = cloudflareWorkerSteps();

    expect(steps.find((s) => s.label === "types:cf-runtime")?.cmd).toEqual(["wrangler", "types", "./.types/cloudflare.d.ts", "--no-include-env"]);
    expect(steps.find((s) => s.label === "types:cf-bindings")?.cmd).toEqual([
      "wrangler",
      "types",
      "./.types/worker-configuration.d.ts",
      "--no-include-runtime",
    ]);
  });

  it("puts --config on the bindings invocation only, because runtime types do not depend on it", () => {
    const steps = cloudflareWorkerSteps({ workerConfig: "wrangler.workers.jsonc" });

    expect(steps.find((s) => s.label === "types:cf-runtime")?.cmd).not.toContain("--config");
    expect(steps.find((s) => s.label === "types:cf-bindings")?.cmd).toEqual([
      "wrangler",
      "types",
      "./.types/worker-configuration.d.ts",
      "--no-include-runtime",
      "--config",
      "wrangler.workers.jsonc",
    ]);
  });

  it("omits both wrangler steps for an app that declares its binding types by hand", () => {
    expect(labelsOf(cloudflareWorkerSteps({ wranglerTypes: false }))).toEqual(["typecheck", "lint", "format", "test"]);
  });

  it("emits the asset step with --out, since the emitter writes nothing useful without one", () => {
    const assets = cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }).find((s) => s.label === "types:assets");

    expect(assets?.cmd).toEqual(["forge", "assets", "gen", "types", "--config", "src/assets/config.ts", "--out", ".forge/assets.ts"]);
  });

  it("lets an app place the emitted module somewhere other than .forge/assets.ts", () => {
    const assets = cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts", assetOut: "generated/assets.ts" }).find(
      (s) => s.label === "types:assets",
    );

    expect(assets?.cmd).toEqual(["forge", "assets", "gen", "types", "--config", "src/assets/config.ts", "--out", "generated/assets.ts"]);
  });

  it("omits types:assets entirely when no asset config is given", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("types:assets");
  });
});

describe("cloudflareWorkerSteps() — options", () => {
  it("defaults the linted and tested paths to src/ and tests/", () => {
    const steps = cloudflareWorkerSteps();

    expect(steps.find((step) => step.label === "lint")?.cmd).toEqual(["oxlint", "--deny-warnings", "src/", "tests/"]);
    expect(steps.find((step) => step.label === "format")?.cmd).toEqual(["oxfmt", "--check", "src/", "tests/"]);
    expect(steps.find((step) => step.label === "test")?.cmd).toEqual(["bun", "test", "tests/"]);
  });

  it("threads sources through both the lint command and its fixer", () => {
    const lint = cloudflareWorkerSteps({ sources: ["src/", "tests/", "scripts/"] }).find((step) => step.label === "lint");

    expect(lint?.cmd).toEqual(["oxlint", "--deny-warnings", "src/", "tests/", "scripts/"]);
    expect(fixerOf(lint)).toEqual(["oxlint", "--fix", "src/", "tests/", "scripts/"]);
  });

  it("threads sources through both the format command and its fixer", () => {
    const format = cloudflareWorkerSteps({ sources: ["src/", "tests/", "scripts/"] }).find((step) => step.label === "format");

    expect(format?.cmd).toEqual(["oxfmt", "--check", "src/", "tests/", "scripts/"]);
    expect(fixerOf(format)).toEqual(["oxfmt", "src/", "tests/", "scripts/"]);
  });

  it("passes every test path to one bun test invocation", () => {
    const test = cloudflareWorkerSteps({ tests: ["tests/unit/", "tests/seam/"] }).find((step) => step.label === "test");

    expect(test?.cmd).toEqual(["bun", "test", "tests/unit/", "tests/seam/"]);
  });
});

describe("cloudflareWorkerSteps() — the warden step", () => {
  // The argv is published contract: a sibling's gate invokes exactly these words.
  it("emits `warden sync --check` after format, with the sync itself as its fixer", () => {
    const steps = cloudflareWorkerSteps({ warden: true });
    const warden = steps.find((step) => step.label === "warden");

    expect(warden?.cmd).toEqual(["warden", "sync", "--check"]);
    expect(fixerOf(warden)).toEqual(["warden", "sync"]);
    expect(labelsOf(steps)).toEqual(["types:cf-runtime", "types:cf-bindings", "typecheck", "lint", "format", "warden", "test"]);
  });

  it("omits the step entirely for an app that does not clone the corpus", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("warden");
    expect(labelsOf(cloudflareWorkerSteps({ warden: false }))).not.toContain("warden");
  });
});

describe("cloudflareWorkerSteps() — fixers", () => {
  // `lint` before `format`: under `--fix` the formatter must write last and own the final layout.
  it("gives lint and format the only fixers, so --fix never silently rewrites generated types", () => {
    const fixable = cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }).filter((step) => fixerOf(step) !== undefined);

    expect(labelsOf(fixable)).toEqual(["lint", "format"]);
  });
});

const PKG = { name: "@scope/pkg", version: "1.2.3", exports: { ".": "./src/mod.ts" }, files: ["src"] };

describe("forgeChecks() — shape", () => {
  it("emits the library order, generation-free and typecheck-first", () => {
    expect(labelsOf(forgeChecks({ root: "/nowhere", pkg: PKG }))).toEqual([
      "typecheck",
      "lint",
      "format",
      "test",
      "validate-exports",
      "validate-jsx",
      "validate-class-order",
    ]);
  });

  it("puts every step on the fast tier, so the whole preset is a fast-run assurance", () => {
    expect(forgeChecks({ root: "/nowhere", pkg: PKG }).filter((step) => step.tier !== undefined)).toEqual([]);
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

    expect(steps.find((step) => step.label === "lint")?.cmd).toEqual(["oxlint", "--deny-warnings", "src/"]);
    expect(steps.find((step) => step.label === "format")?.cmd).toEqual(["oxfmt", "--check", "src/"]);
    expect(steps.find((step) => step.label === "test")?.cmd).toEqual(["bun", "test"]);
  });

  it("threads sources and tests to the two steps that take them", () => {
    const steps = forgeChecks({ root: "/nowhere", pkg: PKG, sources: ["src/", "scripts/"], tests: ["tests/"] });

    expect(steps.find((step) => step.label === "lint")?.cmd).toEqual(["oxlint", "--deny-warnings", "src/", "scripts/"]);
    expect(steps.find((step) => step.label === "test")?.cmd).toEqual(["bun", "test", "tests/"]);
  });

  it("emits no documentation or changelog row — warden owns both, and `src` may not import it", () => {
    const labels = labelsOf(forgeChecks({ root: "/nowhere", pkg: PKG }));

    expect(labels).not.toContain("validate-docs");
    expect(labels).not.toContain("validate-changelog");
  });
});
