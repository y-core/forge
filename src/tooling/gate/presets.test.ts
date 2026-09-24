import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CURATE_FIXTURE_MANIFEST, curateFixtureRepo } from "../curate/curate.fixture";
import { gateFixtureRoot } from "./checks/gate.fixture";
import { cloudflareWorkerSteps, forgeChecks } from "./presets";
import { isCheckStep, selectSteps } from "./steps";
import type { Step } from "./types";

function labelsOf(steps: readonly Step[]): string[] {
  return steps.map((step) => step.label);
}

function fixerOf(step: Step | undefined): readonly string[] | undefined {
  return step === undefined || isCheckStep(step) ? undefined : step.fix;
}

const DESIGN = { stylesheet: "src/assets/tailwind.css", cssDir: "src/assets" };

describe("cloudflareWorkerSteps() — shape", () => {
  it("emits the fleet's order, minus the optional asset step", () => {
    expect(labelsOf(cloudflareWorkerSteps())).toEqual([
      "types:cf-runtime",
      "types:cf-bindings",
      "typecheck",
      "lint",
      "format",
      "lint:types",
      "test",
      "validate-dev-boundary",
    ]);
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
      "lint:types",
      "test",
      "validate-dev-boundary",
    ]);
  });

  it("gives every step a unique label", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }));

    expect(new Set(labels).size).toBe(labels.length);
  });

  it("holds back only the test rows, so a quality run is every other step of the default table", () => {
    const held = cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }).filter((step) => step.tier !== undefined);

    expect(held.map((step) => [step.label, step.tier])).toEqual([["test", "standard"]]);
  });

  it("makes test:browser the only full-tier row once the browser opt-in is taken", () => {
    const held = cloudflareWorkerSteps({ browser: true, design: DESIGN }).filter((step) => step.tier === "full");

    expect(held.map((step) => step.label)).toEqual(["test:browser"]);
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

describe("cloudflareWorkerSteps() — the exposure row", () => {
  it("emits validate-exposure from the worker config alone, with no assets half", () => {
    expect(labelsOf(cloudflareWorkerSteps({ workerConfig: "wrangler.workers.jsonc" }))).toEqual([
      "types:cf-runtime",
      "types:cf-bindings",
      "typecheck",
      "lint",
      "format",
      "lint:types",
      "test",
      "validate-exposure",
      "validate-compatibility",
      "validate-dev-boundary",
    ]);
  });

  it("orders it after validate-asset-root when both halves are configured", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts", workerConfig: "wrangler.workers.jsonc" }));

    expect(labels.slice(-4)).toEqual(["validate-asset-root", "validate-exposure", "validate-compatibility", "validate-dev-boundary"]);
  });

  it("omits the row for an app naming no worker config", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("validate-exposure");
    expect(labelsOf(cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }))).not.toContain("validate-exposure");
  });
});

describe("cloudflareWorkerSteps() — the compatibility row", () => {
  it("omits the row for an app naming no worker config, since there is nothing to read the flags from", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("validate-compatibility");
    expect(labelsOf(cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }))).not.toContain("validate-compatibility");
  });

  it("emits the row from the worker config alone, with no opt-in of its own", () => {
    expect(labelsOf(cloudflareWorkerSteps({ workerConfig: "wrangler.workers.jsonc" }))).toContain("validate-compatibility");
  });
});

describe("cloudflareWorkerSteps() — the dev-boundary row", () => {
  // Default-on: the forbidden specifiers come from forge's own installed manifest, so an app that
  // configures nothing still fails on `@y-core/forge/testing` in a deployed module.
  it("emits validate-dev-boundary on the quality tier for an app that configures nothing", () => {
    const row = cloudflareWorkerSteps().find((step) => step.label === "validate-dev-boundary");

    expect(row?.tier).toBeUndefined();
    expect(labelsOf(cloudflareWorkerSteps()).at(-1)).toBe("validate-dev-boundary");
  });

  it("orders it after the two rows read from the worker config", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ workerConfig: "wrangler.workers.jsonc" }));

    expect(labels.indexOf("validate-dev-boundary")).toBe(labels.indexOf("validate-compatibility") + 1);
    expect(labels.indexOf("validate-compatibility")).toBe(labels.indexOf("validate-exposure") + 1);
  });

  it("keeps the long rows last, so a sub-second boundary finding is not paid for with a browser", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ browser: true, workerd: true, db: true }));

    expect(labels.indexOf("validate-dev-boundary")).toBeLessThan(labels.indexOf("db:schema:digests"));
    expect(labels.indexOf("validate-dev-boundary")).toBeLessThan(labels.indexOf("test:browser"));
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

describe("cloudflareWorkerSteps() — the workerd row", () => {
  it("puts test:workerd last, on the full tier and behind the installed runtime", () => {
    const steps = cloudflareWorkerSteps({ workerd: true, assetConfig: "src/assets/config.ts", workerConfig: "wrangler.workers.jsonc" });
    const workerd = steps.at(-1);

    expect(workerd?.label).toBe("test:workerd");
    expect(workerd?.tier).toBe("full");
    expect(workerd?.requires?.tool).toBe("workerd");
  });

  it("runs two spec files at once by default, and the number `parallel` names when given", () => {
    const command = (workerd: boolean | { parallel: number }) => {
      const row = cloudflareWorkerSteps({ workerd }).at(-1);
      return row !== undefined && "cmd" in row ? row.cmd : undefined;
    };
    expect(command(true)).toEqual(["bun", "test", "--parallel=2", "tests/workerd/"]);
    expect(command({ parallel: 1 })).toEqual(["bun", "test", "--parallel=1", "tests/workerd/"]);
  });

  it("orders the workerd row after the browser row when both opt-ins are taken", () => {
    expect(labelsOf(cloudflareWorkerSteps({ browser: true, workerd: true })).slice(-2)).toEqual(["test:browser", "test:workerd"]);
  });

  it("omits the row for an app with no workerd suite", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("test:workerd");
    expect(labelsOf(cloudflareWorkerSteps({ workerd: false }))).not.toContain("test:workerd");
  });
});

describe("cloudflareWorkerSteps() — the features row", () => {
  it("puts validate-features last, after test:workerd, on the full tier", () => {
    const steps = cloudflareWorkerSteps({ features: {}, browser: true, workerd: true, db: true });

    expect(labelsOf(steps).slice(-2)).toEqual(["test:workerd", "validate-features"]);
    expect(steps.at(-1)?.tier).toBe("full");
  });

  it("omits the row for an app with no feature manifest to verify", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("validate-features");
  });

  it("hands the row the preset's root, so a root with no manifest fails naming `config/features.ts`", async () => {
    const root = gateFixtureRoot({ "README.md": "# app\n" }, "forge-gate-features-");
    const row = cloudflareWorkerSteps({ root, features: {} }).at(-1);
    if (row === undefined || !isCheckStep(row)) throw new Error("no features row");
    const result = await row.run("full");
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "No feature manifest at `config/features.ts` — forge curate needs one, default-exporting defineFeatures({...})",
    ]);
  });

  it("hands the row the profiles it is given, so a profile naming no feature fails naming that profile", async () => {
    const root = curateFixtureRepo(CURATE_FIXTURE_MANIFEST);
    const row = cloudflareWorkerSteps({ root, features: { profiles: [["blog"]] } }).at(-1);
    if (row === undefined || !isCheckStep(row)) throw new Error("no features row");
    const result = await row.run("full");
    rmSync(root, { recursive: true, force: true });

    expect(result.findings.map((finding) => finding.message)).toEqual([
      "--drop blog: cannot drop unknown feature `blog` — the manifest names `showcase`, `contact`",
    ]);
  });

  it("hands the row an empty profile list, so the row fails rather than passing having proved nothing", async () => {
    const root = curateFixtureRepo(CURATE_FIXTURE_MANIFEST);
    const row = cloudflareWorkerSteps({ root, features: { profiles: [] } }).at(-1);
    if (row === undefined || !isCheckStep(row)) throw new Error("no features row");
    const result = await row.run("full");
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`profiles` is empty — the check would prove no skeleton; omit it for the defaults",
    ]);
  });
});

describe("cloudflareWorkerSteps() — the db rows", () => {
  it("emits the digests row on quality and the replay row in full, behind the installed runtime", () => {
    const rows = cloudflareWorkerSteps({ db: true }).filter((step) => step.label.startsWith("db:schema"));

    expect(rows.map((step) => [step.label, step.tier])).toEqual([
      ["db:schema:digests", undefined],
      ["db:schema", "full"],
    ]);
    expect(rows.at(-1)?.requires?.tool).toBe("workerd");
  });

  it("orders the db rows before the browser and workerd rows", () => {
    expect(labelsOf(cloudflareWorkerSteps({ db: true, browser: true, workerd: true })).slice(-4)).toEqual([
      "db:schema:digests",
      "db:schema",
      "test:browser",
      "test:workerd",
    ]);
  });

  it("omits both rows for an app with no database", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("db:schema:digests");
    expect(labelsOf(cloudflareWorkerSteps({ db: false }))).not.toContain("db:schema");
  });
});

describe("cloudflareWorkerSteps() — the test rows", () => {
  it("emits one row per set, in declared order, where the single test row stood", () => {
    const labels = labelsOf(
      cloudflareWorkerSteps({
        testSets: [
          { label: "test:unit", sources: ["tests/unit/"] },
          { label: "test:seam", sources: ["tests/seam/"] },
        ],
      }),
    );

    expect(labels).toEqual([
      "types:cf-runtime",
      "types:cf-bindings",
      "typecheck",
      "lint",
      "format",
      "lint:types",
      "test:unit",
      "test:seam",
      "validate-dev-boundary",
    ]);
  });

  it("ignores tests when testSets is given, so one option cannot silently shadow the other's paths", () => {
    const steps = cloudflareWorkerSteps({ tests: ["tests/"], testSets: [{ label: "test:unit", sources: ["tests/unit/"] }] });

    expect(steps.find((step) => step.label === "test:unit")?.cmd).toEqual(["bun", "test", "tests/unit/"]);
    expect(labelsOf(steps)).not.toContain("test");
  });

  // An empty array is a table with no suite in it. Nothing here refuses that — `selectSteps` does,
  // and only for a run narrowed to a label the table no longer carries.
  it("emits no test row at all for an empty testSets", () => {
    const steps = cloudflareWorkerSteps({ testSets: [] });

    expect(labelsOf(steps).filter((label) => label.startsWith("test"))).toEqual([]);
    expect(selectSteps(steps, { mode: "quality", only: ["test"] })).toMatchObject({ ok: false });
  });

  it("leaves a label colliding with another row to selectSteps, which refuses the whole table", () => {
    const steps = cloudflareWorkerSteps({ testSets: [{ label: "lint", sources: ["tests/unit/"] }] });
    const selection = selectSteps(steps, { mode: "quality" });

    expect(selection.ok).toBe(false);
    expect(selection.ok ? "" : selection.error).toContain("Duplicate step label: lint");
  });
});

describe("cloudflareWorkerSteps() — the opt-in check rows", () => {
  const SSR = { clientDirs: ["src/ui/client"], sources: ["src/"], entryPoints: ["mount.ts"] };
  const CONTRAST = { cssDir: "src/assets", tokenFiles: ["src/assets/tokens.css"], mappingFile: "src/assets/theme.css", pairs: [], criteria: {} };
  const IMPORT = { guarded: ["src/showcase"] };

  it("puts validate-jsx after format, where a file-granular row runs before the slow lint", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ jsx: {} }));

    expect(labels.indexOf("validate-jsx")).toBe(labels.indexOf("format") + 1);
    expect(labels.indexOf("validate-jsx")).toBeLessThan(labels.indexOf("lint:types"));
  });

  it("puts validate-ssr-boundary, validate-import-boundary and validate-contrast after the test rows, in that order", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ ssrBoundary: SSR, importBoundary: IMPORT, contrast: CONTRAST }));

    expect(labels).toEqual([
      "types:cf-runtime",
      "types:cf-bindings",
      "typecheck",
      "lint",
      "format",
      "lint:types",
      "test",
      "validate-ssr-boundary",
      "validate-import-boundary",
      "validate-contrast",
      "validate-dev-boundary",
    ]);
  });

  it("emits validate-import-boundary without validate-ssr-boundary, since neither implies the other", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ importBoundary: IMPORT }));

    expect(labels).toContain("validate-import-boundary");
    expect(labels).not.toContain("validate-ssr-boundary");
  });

  it("emits validate-ssr-boundary without validate-import-boundary, the other direction of the same independence", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ ssrBoundary: SSR }));

    expect(labels).toContain("validate-ssr-boundary");
    expect(labels).not.toContain("validate-import-boundary");
  });

  it("hands the row the preset's root and the app's crossings", async () => {
    const root = gateFixtureRoot({
      "src/showcase/mod.ts": "export const registerShowcase = () => 1;\n",
      "src/router.tsx": 'import { registerShowcase } from "./showcase/mod";\nexport const r = registerShowcase;\n',
    });
    const rowOf = (crossings: readonly string[]) =>
      cloudflareWorkerSteps({ root, importBoundary: { ...IMPORT, crossings } }).find((step) => step.label === "validate-import-boundary");
    const crossed = rowOf(["src/router.tsx"]);
    const uncrossed = rowOf([]);
    if (crossed === undefined || !isCheckStep(crossed) || uncrossed === undefined || !isCheckStep(uncrossed))
      throw new Error("no import-boundary row");

    expect((await crossed.run("quality")).ok).toBe(true);
    expect((await uncrossed.run("quality")).ok).toBe(false);
  });

  it("omits every such row for an app that configures none of them", () => {
    const labels = labelsOf(cloudflareWorkerSteps());

    expect(labels).not.toContain("validate-jsx");
    expect(labels).not.toContain("validate-ssr-boundary");
    expect(labels).not.toContain("validate-import-boundary");
    expect(labels).not.toContain("validate-contrast");
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
      "lint:types",
      "validate-modern-css",
      "validate-class-order",
      "validate-class-tokens",
      "test",
      "validate-dev-boundary",
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
      "lint:types",
      "validate-modern-css",
      "validate-class-order",
      "validate-class-tokens",
      "validate-css-tokens",
      "test",
      "validate-dev-boundary",
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
      "lint:types",
      "test",
      "validate-dev-boundary",
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
  return (await step.run("quality")).ok;
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
    expect(labelsOf(cloudflareWorkerSteps({ wranglerTypes: false }))).toEqual([
      "typecheck",
      "lint",
      "format",
      "lint:types",
      "test",
      "validate-dev-boundary",
    ]);
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

describe("cloudflareWorkerSteps() — the type-aware lint row", () => {
  it("emits lint:types on the quality tier, immediately after format", () => {
    const steps = cloudflareWorkerSteps({ sources: ["src/", "tests/"] });
    const row = steps.find((step) => step.label === "lint:types");

    expect(row?.tier).toBeUndefined();
    expect(row?.cmd).toEqual([
      "oxlint",
      "--type-aware",
      "--deny-warnings",
      "--report-unused-disable-directives-severity",
      "error",
      "src/",
      "tests/",
    ]);
    expect(labelsOf(steps).indexOf("lint:types")).toBe(labelsOf(steps).indexOf("format") + 1);
  });

  it("threads sources through, so an app that lints scripts/ type-checks them too", () => {
    const row = cloudflareWorkerSteps({ sources: ["src/", "scripts/"] }).find((step) => step.label === "lint:types");

    expect(row?.cmd?.slice(-2)).toEqual(["src/", "scripts/"]);
  });

  // The row runs before anything minutes long, so a sub-second finding is not paid for with Chromium.
  it("orders lint:types ahead of the browser and workerd rows", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ browser: true, workerd: true }));

    expect(labels.indexOf("lint:types")).toBeLessThan(labels.indexOf("test:browser"));
    expect(labels.indexOf("lint:types")).toBeLessThan(labels.indexOf("test:workerd"));
  });
});

describe("cloudflareWorkerSteps() — the markdown row", () => {
  it("emits validate-markdown on the quality tier, between format and lint:types", () => {
    const steps = cloudflareWorkerSteps({ markdown: { sources: ["docs"] } });
    const row = steps.find((step) => step.label === "validate-markdown");

    expect(row?.tier).toBeUndefined();
    expect(labelsOf(steps)).toEqual([
      "types:cf-runtime",
      "types:cf-bindings",
      "typecheck",
      "lint",
      "format",
      "validate-markdown",
      "lint:types",
      "test",
      "validate-dev-boundary",
    ]);
  });

  it("gives the row a fixer, so `--fix` normalizes prose the formatter is told to ignore", () => {
    const steps = cloudflareWorkerSteps({ markdown: { sources: ["docs"] } });
    const row = steps.find((step) => step.label === "validate-markdown");

    expect(row !== undefined && isCheckStep(row) && row.fix !== undefined).toBe(true);
  });

  it("omits the row for an app that does not opt in", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("validate-markdown");
  });
});

describe("cloudflareWorkerSteps() — the warden step", () => {
  // The argv is published contract: a sibling's gate invokes exactly these words.
  it("emits `warden sync --check` after format, with the sync itself as its fixer", () => {
    const steps = cloudflareWorkerSteps({ warden: true });
    const warden = steps.find((step) => step.label === "warden");

    expect(warden?.cmd).toEqual(["warden", "sync", "--check"]);
    expect(fixerOf(warden)).toEqual(["warden", "sync"]);
    expect(labelsOf(steps)).toEqual([
      "types:cf-runtime",
      "types:cf-bindings",
      "typecheck",
      "lint",
      "format",
      "lint:types",
      "warden",
      "test",
      "validate-dev-boundary",
    ]);
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

  it("holds back only the test row, so every check it emits is a quality-run assurance", () => {
    const held = forgeChecks({ root: "/nowhere", pkg: PKG }).filter((step) => step.tier !== undefined);

    expect(held.map((step) => [step.label, step.tier])).toEqual([["test", "standard"]]);
  });

  it("omits the checks carrying project-specific policy, which a table must name explicitly", () => {
    const labels = labelsOf(forgeChecks({ root: "/nowhere", pkg: PKG }));

    expect(labels).not.toContain("validate-design");
    expect(labels).not.toContain("validate-contrast");
    expect(labels).not.toContain("validate-namespace-graph");
    expect(labels).not.toContain("validate-css-sources");
  });

  it("carries no machine prerequisite, so the whole preset is legal in a quality run", () => {
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
