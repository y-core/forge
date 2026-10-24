import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { worktreeFixture } from "../cli/worktree.fixture";
import { CURATE_FIXTURE_MANIFEST, curateFixtureRepo, curateFixtureTemplate } from "../curate/curate.fixture";
import { browserSteps, importBoundaryStep } from "./builders";
import { gateFixtureRoot } from "./checks/gate.fixture";
import { cloudflareWorkerSteps, forgeChecks } from "./presets";
import { isCheckStep, selectSteps } from "./steps";
import type { CheckResult, Step } from "./types";

afterAll(() => {
  rmSync(curateFixtureTemplate(), { recursive: true, force: true });
});

function labelsOf(steps: readonly Step[]): string[] {
  return steps.map((step) => step.label);
}

function fixerOf(step: Step | undefined): readonly string[] | undefined {
  return step === undefined || isCheckStep(step) ? undefined : step.fix;
}

const DESIGN = { stylesheet: "src/assets/tailwind.css", cssDir: "src/assets" };

async function runRow(steps: readonly Step[], label: string): Promise<CheckResult> {
  const row = steps.find((step) => step.label === label);
  if (row === undefined || !isCheckStep(row)) throw new Error(`no ${label} row`);
  return row.run("static");
}

function crossingsOf(result: CheckResult): [string | undefined, string][] {
  return result.findings.map((finding) => [finding.file, finding.message]);
}

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
      "validate-dev-bundle",
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
      "validate-dev-bundle",
    ]);
  });

  it("gives every step a unique label", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }));

    expect(new Set(labels).size).toBe(labels.length);
  });

  it("gives every step a unique label with both boundary directions and the vendor row emitted", () => {
    const labels = labelsOf(
      cloudflareWorkerSteps({
        ssrBoundary: { clientDirs: ["src/ui/client"], sources: ["src/"], entryPoints: ["mount.ts"], serverDirs: ["src/app"] },
        importBoundary: { guarded: ["src/showcase"] },
        vendorDir: "src/vendor",
      }),
    );

    expect(new Set(labels).size).toBe(labels.length);
  });

  it("holds back only the test row and the bundle proof, so a static run is every other step of the default table", () => {
    const held = cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts" }).filter((step) => step.tier !== undefined);

    expect(held.map((step) => [step.label, step.tier])).toEqual([
      ["test", "unit"],
      ["validate-dev-bundle", "deploy"],
    ]);
  });

  it("adds test:browser to the runtime tier once the browser opt-in is taken", () => {
    const held = cloudflareWorkerSteps({ browser: true, design: DESIGN }).filter((step) => step.tier === "runtime");

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

  it("gates only the compiling design rows and the browser row once the opt-ins are taken", () => {
    const gated = cloudflareWorkerSteps({ browser: true, design: DESIGN }).filter((step) => step.requires !== undefined);

    expect(labelsOf(gated)).toEqual(["validate-class-tokens", "validate-css-coverage", "validate-css-tokens", "test:browser"]);
    expect(gated.slice(0, 3).map((step) => step.requires?.tool)).toEqual(["tailwindcss", "tailwindcss", "tailwindcss"]);
    expect(gated.at(-1)?.requires?.probe).toBeFunction();
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
      "validate-dev-bundle",
    ]);
  });

  it("orders it after validate-asset-root when both halves are configured", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ assetConfig: "src/assets/config.ts", workerConfig: "wrangler.workers.jsonc" }));

    expect(labels.slice(-5)).toEqual([
      "validate-asset-root",
      "validate-exposure",
      "validate-compatibility",
      "validate-dev-boundary",
      "validate-dev-bundle",
    ]);
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

const DEV_MODULE_APP = {
  "wrangler.jsonc": '{ "name": "app", "main": "src/worker.ts" }\n',
  "src/worker.ts": 'import { viewer } from "./controllers/logs.dev";\n\nexport default { fetch: () => new Response(viewer) };\n',
  "src/controllers/logs.dev.ts": 'export const viewer = "logs";\n',
};

describe("cloudflareWorkerSteps() — the dev-boundary row", () => {
  // Default-on: the forbidden specifiers come from forge's own installed manifest, so an app that
  // configures nothing still fails on `@y-core/forge/testing` in a deployed module.
  it("emits validate-dev-boundary on the static tier for an app that configures nothing", () => {
    const row = cloudflareWorkerSteps().find((step) => step.label === "validate-dev-boundary");

    expect(row?.tier).toBeUndefined();
    expect(labelsOf(cloudflareWorkerSteps()).at(-2)).toBe("validate-dev-boundary");
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

  it("fails a production import of a `*.dev.ts` helper with nothing configured", async () => {
    const root = gateFixtureRoot(DEV_MODULE_APP, "forge-presets-");
    try {
      const result = await runRow(cloudflareWorkerSteps({ root }), "validate-dev-boundary");

      expect(result.findings.map((finding) => [finding.file, finding.message])).toContainEqual([
        "src/worker.ts",
        "development module imported — `./controllers/logs.dev` resolves to `src/controllers/logs.dev.ts`",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("cloudflareWorkerSteps() — the browser row", () => {
  it("puts test:browser last, on the runtime tier and behind the Playwright server", () => {
    const steps = cloudflareWorkerSteps({ browser: true, assetConfig: "src/assets/config.ts", workerConfig: "wrangler.workers.jsonc" });
    const browser = steps.at(-1);

    expect(browser?.label).toBe("test:browser");
    expect(browser?.tier).toBe("runtime");
    expect(browser?.requires?.probe).toBeFunction();
    expect(browser !== undefined && !isCheckStep(browser) ? browser.cmd : undefined).toEqual(["playwright", "test", "--project=chromium"]);
  });

  it("omits the row for an app with no browser suite", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("test:browser");
    expect(labelsOf(cloudflareWorkerSteps({ browser: false }))).not.toContain("test:browser");
  });
});

describe("cloudflareWorkerSteps() — the browser rows per engine", () => {
  function browserRows(steps: readonly Step[]): [string, string | undefined, readonly string[] | undefined, Step["narrow"]][] {
    return steps
      .filter((step) => step.label.startsWith("test:browser"))
      .map((step) => [step.label, step.tier, isCheckStep(step) ? undefined : step.cmd, step.narrow]);
  }

  it("hands an engine list to browserSteps, so the matrix rows are exactly the builder's", () => {
    const engines = ["chromium", "firefox", "webkit"] as const;

    expect(browserRows(cloudflareWorkerSteps({ browser: { engines } }))).toEqual(browserRows(browserSteps({ engines })));
  });

  it("emits the same Chromium row for `true` as for an engine list naming Chromium alone", () => {
    expect(browserRows(cloudflareWorkerSteps({ browser: true }))).toEqual(
      browserRows(cloudflareWorkerSteps({ browser: { engines: ["chromium"] } })),
    );
  });
});

describe("cloudflareWorkerSteps() — the rows a spec reaches through the served Worker", () => {
  const APP = {
    "wrangler.jsonc": '{ "name": "app", "main": "src/worker.ts" }\n',
    "wrangler.staging.jsonc": '{ "name": "app-staging", "main": "src/staging.ts" }\n',
    "src/worker.ts": 'import { routes } from "./routes";\nexport default { routes };\n',
    "src/staging.ts": "export default {};\n",
    "src/routes.ts": "export const routes = 1;\n",
    "tests/app.browser.ts": "export {};\n",
  };

  const traced = async (steps: readonly Step[], root: string): Promise<[string, readonly string[] | undefined][]> =>
    Promise.all(
      steps
        .filter((step) => step.label.startsWith("test:"))
        .map(async (step): Promise<[string, readonly string[] | undefined]> => [step.label, await step.widen?.(root)]),
    );

  it("runs the browser and workerd rows whole for a change to the app Worker's closure, read from the default config", async () => {
    const root = gateFixtureRoot(APP);
    const steps = cloudflareWorkerSteps({ root, wranglerTypes: false, browser: { engines: ["chromium", "firefox"] }, workerd: true });

    expect(await traced(steps, root)).toEqual([
      ["test:browser", ["src/routes.ts", "src/worker.ts"]],
      ["test:browser:firefox", ["src/routes.ts", "src/worker.ts"]],
      ["test:workerd", ["src/routes.ts", "src/worker.ts"]],
    ]);
    rmSync(root, { recursive: true, force: true });
  });

  it("traces the Worker the app's own `workerConfig` names", async () => {
    const root = gateFixtureRoot(APP);
    const steps = cloudflareWorkerSteps({ root, wranglerTypes: false, workerConfig: "wrangler.staging.jsonc", browser: true });

    expect(await traced(steps, root)).toEqual([["test:browser", ["src/staging.ts"]]]);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects the trace when the app's Worker config names no `main`, so the rows run whole", async () => {
    const root = gateFixtureRoot({ "wrangler.jsonc": '{ "name": "app" }\n' });
    const [workerd] = cloudflareWorkerSteps({ root, wranglerTypes: false, workerd: true }).filter((step) => step.label === "test:workerd");

    await expect(Promise.resolve(workerd?.widen?.(root))).rejects.toThrow("names no `main`");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("cloudflareWorkerSteps() — the rows a spec reaches through the served assets", () => {
  const TAILWIND = resolve(import.meta.dir, "../../../node_modules/tailwindcss");
  const ASSETS = {
    js: { bundles: [{ entry: "src/client/main.ts", outdir: "js" }] },
    css: [{ tool: "tailwindcss", input: "src/styles/main.css", output: "css/main.css" }],
  };
  const APP = {
    ".gitignore": "node_modules\n",
    "wrangler.jsonc": '{ "name": "app", "main": "src/worker.ts" }\n',
    "wrangler.assets.jsonc": '{ "name": "app", "main": "src/worker.ts", "assets": { "directory": "public" } }\n',
    "config/assets.ts": `export default ${JSON.stringify(ASSETS)};\n`,
    "src/worker.ts": "export default {};\n",
    "src/client/main.ts": 'import { helper } from "./helper";\nconsole.log(helper);\n',
    "src/client/helper.ts": "export const helper = 1;\n",
    "src/styles/main.css": '@import "tailwindcss" source(none);\n@source "../views";\n',
    "src/views/page.tsx": "export const page = 1;\n",
  };
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function repo(): string {
    const root = worktreeFixture(APP);
    roots.push(root);
    mkdirSync(join(root, "node_modules"));
    symlinkSync(TAILWIND, join(root, "node_modules/tailwindcss"));
    return root;
  }

  const widened = async (steps: readonly Step[], label: string, root: string): Promise<readonly string[] | undefined> =>
    steps.find((step) => step.label === label)?.widen?.(root);

  const REACHED = ["src/client/helper.ts", "src/views/page.tsx"];
  const reachedOf = (paths: readonly string[] | undefined): string[] | undefined => paths?.filter((path) => REACHED.includes(path));

  it("runs the browser row whole for a change to a client bundle input or a covered CSS source", async () => {
    const root = repo();
    const steps = cloudflareWorkerSteps({ root, wranglerTypes: false, assetConfig: "config/assets.ts", browser: true });

    const paths = await widened(steps, "test:browser", root);

    expect(reachedOf(paths)).toEqual(REACHED);
    expect(paths).toContain("src/worker.ts");
  });

  it("widens the workerd row by the asset inputs only when the wrangler config serves assets", async () => {
    const root = repo();
    const served = cloudflareWorkerSteps({
      root,
      wranglerTypes: false,
      assetConfig: "config/assets.ts",
      workerConfig: "wrangler.assets.jsonc",
      workerd: true,
    });
    const unserved = cloudflareWorkerSteps({ root, wranglerTypes: false, assetConfig: "config/assets.ts", workerd: true });

    expect(reachedOf(await widened(served, "test:workerd", root))).toEqual(REACHED);
    expect(await widened(unserved, "test:workerd", root)).toEqual(["src/worker.ts"]);
  });

  it("leaves both rows on the Worker's closure without an `assetConfig`", async () => {
    const root = repo();
    const steps = cloudflareWorkerSteps({ root, wranglerTypes: false, workerConfig: "wrangler.assets.jsonc", browser: true, workerd: true });

    expect(await widened(steps, "test:browser", root)).toEqual(["src/worker.ts"]);
    expect(await widened(steps, "test:workerd", root)).toEqual(["src/worker.ts"]);
  });

  it("rejects the browser trace when an asset input does not resolve, so the row runs whole", async () => {
    const root = repo();
    writeFileSync(join(root, "src/client/helper.ts"), 'export { gone } from "./gone";\n');
    const steps = cloudflareWorkerSteps({ root, wranglerTypes: false, assetConfig: "config/assets.ts", browser: true });

    await expect(Promise.resolve(widened(steps, "test:browser", root))).rejects.toThrow();
  });
});

describe("cloudflareWorkerSteps() — the workerd row", () => {
  it("puts test:workerd last, on the runtime tier and behind the installed runtime", () => {
    const steps = cloudflareWorkerSteps({ workerd: true, assetConfig: "src/assets/config.ts", workerConfig: "wrangler.workers.jsonc" });
    const workerd = steps.at(-1);

    expect(workerd?.label).toBe("test:workerd");
    expect(workerd?.tier).toBe("runtime");
    expect(workerd?.requires?.tool).toBe("workerd");
  });

  it("runs the consumer's workerd Playwright project", () => {
    const row = cloudflareWorkerSteps({ workerd: true }).at(-1);

    expect(row !== undefined && "cmd" in row ? row.cmd : undefined).toEqual(["playwright", "test", "--project=workerd"]);
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
  it("puts validate-features last, after test:workerd, on the deploy tier", () => {
    const steps = cloudflareWorkerSteps({ features: {}, browser: true, workerd: true, db: true });

    expect(labelsOf(steps).slice(-2)).toEqual(["test:workerd", "validate-features"]);
    expect(steps.at(-1)?.tier).toBe("deploy");
  });

  it("omits the row for an app with no feature manifest to verify", () => {
    expect(labelsOf(cloudflareWorkerSteps())).not.toContain("validate-features");
  });

  it("hands the row the preset's root, so a root with no manifest fails naming `config/features.ts`", async () => {
    const root = gateFixtureRoot({ "README.md": "# app\n" }, "forge-gate-features-");
    const row = cloudflareWorkerSteps({ root, features: {} }).at(-1);
    if (row === undefined || !isCheckStep(row)) throw new Error("no features row");
    const result = await row.run("deploy");
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
    const result = await row.run("deploy");
    rmSync(root, { recursive: true, force: true });

    expect(result.findings.map((finding) => finding.message)).toEqual([
      "--drop blog: cannot drop unknown feature `blog` — the manifest names `showcase`, `contact`",
    ]);
  });

  it("hands the row an empty profile list, so the row fails rather than passing having proved nothing", async () => {
    const root = curateFixtureRepo(CURATE_FIXTURE_MANIFEST);
    const row = cloudflareWorkerSteps({ root, features: { profiles: [] } }).at(-1);
    if (row === undefined || !isCheckStep(row)) throw new Error("no features row");
    const result = await row.run("deploy");
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`profiles` is empty — the check would prove no skeleton; omit it for the defaults",
    ]);
  });
});

describe("cloudflareWorkerSteps() — the db rows", () => {
  it("emits the digests row on static, and the lint and replay rows on runtime, behind the installed runtime", () => {
    const rows = cloudflareWorkerSteps({ db: true }).filter((step) => step.label.startsWith("db:"));

    expect(rows.map((step) => [step.label, step.tier, step.requires?.tool])).toEqual([
      ["db:schema:digests", undefined, undefined],
      ["db:lint", "runtime", "workerd"],
      ["db:schema", "runtime", "workerd"],
    ]);
  });

  it("runs forge db lint", () => {
    const step = cloudflareWorkerSteps({ db: true }).find((candidate) => candidate.label === "db:lint");
    expect(step !== undefined && "cmd" in step ? step.cmd : null).toEqual(["forge", "db", "lint", "--root", process.cwd()]);
  });

  // A fresh checkout has no local database, so a status row would read every migration as pending and fail;
  // the replay row is what proves the migrations apply.
  it("emits no row that reads a local database's status", () => {
    expect(labelsOf(cloudflareWorkerSteps({ db: true })).filter((label) => label.includes("status"))).toEqual([]);
  });

  it("orders the db rows before the browser and workerd rows", () => {
    expect(labelsOf(cloudflareWorkerSteps({ db: true, browser: true, workerd: true })).slice(-5)).toEqual([
      "db:schema:digests",
      "db:lint",
      "db:schema",
      "test:browser",
      "test:workerd",
    ]);
  });

  it("omits every db row for an app with no database", () => {
    expect(labelsOf(cloudflareWorkerSteps()).filter((label) => label.startsWith("db:"))).toEqual([]);
    expect(labelsOf(cloudflareWorkerSteps({ db: false })).filter((label) => label.startsWith("db:"))).toEqual([]);
  });
});

describe("cloudflareWorkerSteps() — the dev-bundle row", () => {
  it("emits validate-dev-bundle on the deploy tier, right after the dev-boundary row, with no machine prerequisite", () => {
    const steps = cloudflareWorkerSteps({ workerConfig: "wrangler.workers.jsonc" });
    const labels = labelsOf(steps);
    const row = steps.find((step) => step.label === "validate-dev-bundle");

    expect(labels.indexOf("validate-dev-bundle")).toBe(labels.indexOf("validate-dev-boundary") + 1);
    expect(row?.tier).toBe("deploy");
    expect(row?.requires).toBeUndefined();
  });

  it("judges the worker config the app names", async () => {
    const root = gateFixtureRoot({ "wrangler.workers.jsonc": '{ "name": "app" }\n' }, "forge-presets-");
    try {
      const result = await runRow(cloudflareWorkerSteps({ root, workerConfig: "wrangler.workers.jsonc" }), "validate-dev-bundle");

      expect(result.findings.map((finding) => [finding.file, finding.message])).toContainEqual([
        "wrangler.workers.jsonc",
        "`main` is unstated, so there is no deployed bundle to judge",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails a `*.dev.ts` helper that reaches main's bundle, with nothing configured", async () => {
    const root = gateFixtureRoot(DEV_MODULE_APP, "forge-presets-");
    try {
      const result = await runRow(cloudflareWorkerSteps({ root }), "validate-dev-bundle");

      expect(result.findings.filter((finding) => finding.message.startsWith("development code")).map((finding) => finding.file)).toEqual([
        "src/controllers/logs.dev.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
      "validate-dev-bundle",
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
    expect(selectSteps(steps, { tier: "static", only: ["test"] })).toMatchObject({ ok: false });
  });

  it("leaves a label colliding with another row to selectSteps, which refuses the whole table", () => {
    const steps = cloudflareWorkerSteps({ testSets: [{ label: "lint", sources: ["tests/unit/"] }] });
    const selection = selectSteps(steps, { tier: "static" });

    expect(selection.ok).toBe(false);
    expect(selection.ok ? "" : selection.error).toContain("Duplicate step label: lint");
  });
});

describe("cloudflareWorkerSteps() — the opt-in check rows", () => {
  const SSR = { clientDirs: ["src/ui/client"], sources: ["src/"], entryPoints: ["mount.ts"] };
  const CONTRAST = { cssDir: "src/assets", tokenFiles: ["src/assets/tokens.css"], mappingFile: "src/assets/theme.css", pairs: [], criteria: {} };
  const IMPORT = { guarded: ["src/showcase"] };
  const SSR_SERVER = { ...SSR, serverDirs: ["src/app"] };
  const VENDOR = "src/vendor";

  it("puts validate-jsx after format, where a file-granular row runs before the slow lint", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ jsx: {} }));

    expect(labels.indexOf("validate-jsx")).toBe(labels.indexOf("format") + 1);
    expect(labels.indexOf("validate-jsx")).toBeLessThan(labels.indexOf("lint:types"));
  });

  it("puts the ssr, client, import, vendor and contrast rows after the test rows, in that order", () => {
    const labels = labelsOf(cloudflareWorkerSteps({ ssrBoundary: SSR_SERVER, importBoundary: IMPORT, vendorDir: VENDOR, contrast: CONTRAST }));

    expect(labels).toEqual([
      "types:cf-runtime",
      "types:cf-bindings",
      "typecheck",
      "lint",
      "format",
      "lint:types",
      "test",
      "validate-ssr-boundary",
      "validate-client-boundary",
      "validate-import-boundary",
      "validate-vendor-boundary",
      "validate-contrast",
      "validate-dev-boundary",
      "validate-dev-bundle",
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

    expect((await crossed.run("static")).ok).toBe(true);
    expect((await uncrossed.run("static")).ok).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("reads the feature manifest when features are opted into too, so a root with none fails the row naming it", async () => {
    const root = gateFixtureRoot({ "src/showcase/mod.ts": "export const registerShowcase = () => 1;\n" });
    const row = cloudflareWorkerSteps({ root, importBoundary: IMPORT, features: {} }).find((step) => step.label === "validate-import-boundary");
    if (row === undefined || !isCheckStep(row)) throw new Error("no import-boundary row");
    const result = await row.run("static");
    rmSync(root, { recursive: true, force: true });

    expect(result.findings.map((finding) => finding.message)).toEqual([
      "No feature manifest at `config/features.ts` — forge curate needs one, default-exporting defineFeatures({...})",
    ]);
  });

  it("guards the feature manifest's directories when features are opted into too", async () => {
    const root = curateFixtureRepo(CURATE_FIXTURE_MANIFEST);
    const row = cloudflareWorkerSteps({ root, importBoundary: { guarded: [] }, features: {} }).find(
      (step) => step.label === "validate-import-boundary",
    );
    if (row === undefined || !isCheckStep(row)) throw new Error("no import-boundary row");
    const result = await row.run("static");
    rmSync(root, { recursive: true, force: true });

    expect(result.findings.map((finding) => [finding.file, finding.message])).toEqual([
      ["src/app.ts", "import boundary crossed — `./showcase/demo` resolves to `src/showcase/demo.ts`"],
      ["src/app.ts", "import boundary crossed — `./contact/form` resolves to `src/contact/form.ts`"],
    ]);
  });

  it("reads no feature manifest when features are not opted into", async () => {
    const root = gateFixtureRoot({ "src/showcase/mod.ts": "export const registerShowcase = () => 1;\n", "src/app.ts": "export const app = 1;\n" });
    const row = cloudflareWorkerSteps({ root, importBoundary: IMPORT }).find((step) => step.label === "validate-import-boundary");
    if (row === undefined || !isCheckStep(row)) throw new Error("no import-boundary row");
    const result = await row.run("static");
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(true);
  });

  it("omits every such row for an app that configures none of them", () => {
    const labels = labelsOf(cloudflareWorkerSteps());

    expect(labels).not.toContain("validate-jsx");
    expect(labels).not.toContain("validate-ssr-boundary");
    expect(labels).not.toContain("validate-import-boundary");
    expect(labels).not.toContain("validate-contrast");
  });
});

describe("cloudflareWorkerSteps() — the client-boundary row", () => {
  const SSR = { clientDirs: ["src/ui/client"], sources: ["src/"], entryPoints: ["mount.ts"] };
  const SSR_SERVER = { ...SSR, serverDirs: ["src/app"] };
  const CLIENT_TREE = { "src/app/config.ts": "export const SECRET = 1;\n", "src/ui/client/util.ts": "export const util = 1;\n" };

  it("emits validate-client-boundary only when ssrBoundary names serverDirs", () => {
    expect(labelsOf(cloudflareWorkerSteps({ ssrBoundary: SSR }))).not.toContain("validate-client-boundary");
    expect(labelsOf(cloudflareWorkerSteps({ ssrBoundary: SSR_SERVER }))).toContain("validate-client-boundary");
  });

  it("fails a client module importing a server directory at value, naming the client file", async () => {
    const root = gateFixtureRoot({
      ...CLIENT_TREE,
      "src/ui/client/main.ts": 'import { SECRET } from "../../app/config";\nexport const main = SECRET;\n',
    });
    const result = await runRow(cloudflareWorkerSteps({ root, ssrBoundary: SSR_SERVER }), "validate-client-boundary");
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(false);
    expect(crossingsOf(result)).toEqual([
      ["src/ui/client/main.ts", "import boundary crossed — `../../app/config` resolves to `src/app/config.ts`"],
    ]);
  });

  it("passes a client tree importing only within itself", async () => {
    const root = gateFixtureRoot({ ...CLIENT_TREE, "src/ui/client/main.ts": 'import { util } from "./util";\nexport const main = util;\n' });
    const result = await runRow(cloudflareWorkerSteps({ root, ssrBoundary: SSR_SERVER }), "validate-client-boundary");
    rmSync(root, { recursive: true, force: true });

    expect(result.ok).toBe(true);
  });

  it("still fails a server module importing the client tree on the ssr row once serverDirs is set", async () => {
    const root = gateFixtureRoot({
      ...CLIENT_TREE,
      "src/ui/client/main.ts": 'import { util } from "./util";\nexport const main = util;\n',
      "src/app/router.ts": 'import { util } from "../ui/client/util";\nexport const router = util;\n',
    });
    const crossed = await runRow(cloudflareWorkerSteps({ root, ssrBoundary: SSR_SERVER }), "validate-ssr-boundary");
    rmSync(join(root, "src/app/router.ts"));
    const clean = await runRow(cloudflareWorkerSteps({ root, ssrBoundary: SSR_SERVER }), "validate-ssr-boundary");
    rmSync(root, { recursive: true, force: true });

    expect(crossingsOf(crossed)).toEqual([["src/app/router.ts", "SSR boundary crossed"]]);
    expect(clean.ok).toBe(true);
  });
});

describe("cloudflareWorkerSteps() — the vendor-boundary row", () => {
  const VENDOR = "src/vendor";
  const VENDOR_TREE = {
    "src/app/x.ts": "export const x = 1;\n",
    "src/router.ts": "export const router = 1;\n",
    "src/vendor/sibling/mod.ts": "export const sibling = 1;\n",
  };

  async function vendorResult(files: Record<string, string>, vendorDir = VENDOR): Promise<CheckResult> {
    const root = gateFixtureRoot(files);
    const result = await runRow(cloudflareWorkerSteps({ root, vendorDir }), "validate-vendor-boundary");
    rmSync(root, { recursive: true, force: true });
    return result;
  }

  it("emits no validate-vendor-boundary without vendorDir, and only that row beyond the default with it", () => {
    const plain = labelsOf(cloudflareWorkerSteps());
    const vendored = labelsOf(cloudflareWorkerSteps({ vendorDir: VENDOR }));

    expect(plain).not.toContain("validate-vendor-boundary");
    expect(vendored.filter((label) => !plain.includes(label))).toEqual(["validate-vendor-boundary"]);
  });

  it("fails a vendor module importing a directory beside the vendor tree", async () => {
    const result = await vendorResult({ ...VENDOR_TREE, "src/vendor/lib/mod.ts": 'import { x } from "../../app/x";\nexport const lib = x;\n' });

    expect(result.ok).toBe(false);
    expect(crossingsOf(result)).toEqual([["src/vendor/lib/mod.ts", "import boundary crossed — `../../app/x` resolves to `src/app/x.ts`"]]);
  });

  it("fails a vendor module importing a source file beside the vendor tree", async () => {
    const result = await vendorResult({
      ...VENDOR_TREE,
      "src/vendor/lib/mod.ts": 'import { router } from "../../router";\nexport const lib = router;\n',
    });

    expect(result.ok).toBe(false);
    expect(crossingsOf(result)).toEqual([["src/vendor/lib/mod.ts", "import boundary crossed — `../../router` resolves to `src/router.ts`"]]);
  });

  it("passes a vendor module importing only the vendor tree and a bare package", async () => {
    const result = await vendorResult({
      ...VENDOR_TREE,
      "src/vendor/lib/mod.ts":
        'import { sibling } from "../sibling/mod";\nimport { object } from "valibot";\nexport const lib = [sibling, object];\n',
    });

    expect(result.ok).toBe(true);
  });

  it("leaves a spec beside the vendor tree unguarded, so it cannot misconfigure the row", async () => {
    const result = await vendorResult({
      ...VENDOR_TREE,
      "src/router.test.ts": "export const spec = 1;\n",
      "src/vendor/lib/mod.ts": 'import { sibling } from "../sibling/mod";\nexport const lib = sibling;\n',
    });

    expect(result.ok).toBe(true);
  });

  it("lists what sits beside the vendor tree when the row runs, not when the table is built", async () => {
    const root = gateFixtureRoot({ ...VENDOR_TREE, "src/vendor/lib/mod.ts": "export const lib = 1;\n" });
    const steps = cloudflareWorkerSteps({ root, vendorDir: VENDOR });
    mkdirSync(join(root, "src/late"));
    writeFileSync(join(root, "src/late/mod.ts"), "export const late = 1;\n");
    writeFileSync(join(root, "src/vendor/lib/late.ts"), 'import { late } from "../../late/mod";\nexport const lib = late;\n');
    const result = await runRow(steps, "validate-vendor-boundary");
    rmSync(root, { recursive: true, force: true });

    expect(crossingsOf(result)).toEqual([["src/vendor/lib/late.ts", "import boundary crossed — `../../late/mod` resolves to `src/late/mod.ts`"]]);
  });

  it("builds the table under a missing root without throwing, and fails the row when it runs", async () => {
    const steps = cloudflareWorkerSteps({ root: "/nowhere", vendorDir: VENDOR });
    const result = await runRow(steps, "validate-vendor-boundary");

    expect(result.ok).toBe(false);
    expect(crossingsOf(result)).toEqual([
      [undefined, "`src/vendor` matched no source — refusing to report a green import-boundary gate that scanned nothing"],
    ]);
  });

  it("still guards the vendor tree's neighbours when vendorDir ends in a slash", async () => {
    const result = await vendorResult(
      { ...VENDOR_TREE, "src/vendor/lib/mod.ts": 'import { x } from "../../app/x";\nexport const lib = x;\n' },
      "src/vendor/",
    );

    expect(crossingsOf(result)).toEqual([["src/vendor/lib/mod.ts", "import boundary crossed — `../../app/x` resolves to `src/app/x.ts`"]]);
  });

  it("guards the root's other entries when the vendor tree sits directly under the root", async () => {
    const result = await vendorResult(
      { "lib/x.ts": "export const x = 1;\n", "vendor/a/mod.ts": 'import { x } from "../../lib/x";\nexport const a = x;\n' },
      "vendor",
    );

    expect(crossingsOf(result)).toEqual([["vendor/a/mod.ts", "import boundary crossed — `../../lib/x` resolves to `lib/x.ts`"]]);
  });
});

describe("cloudflareWorkerSteps() — the design rows", () => {
  it("emits four rows before test when no cssDir is given", () => {
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
      "validate-css-coverage",
      "test",
      "validate-dev-boundary",
      "validate-dev-bundle",
    ]);
    expect(labels).not.toContain("validate-css-tokens");
  });

  it("adds validate-css-tokens after the coverage row when a cssDir is given", () => {
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
      "validate-css-coverage",
      "validate-css-tokens",
      "test",
      "validate-dev-boundary",
      "validate-dev-bundle",
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
      "validate-dev-bundle",
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
  return (await step.run("static")).ok;
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
      "validate-dev-bundle",
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
  it("emits lint:types on the static tier, immediately after format", () => {
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
  it("emits validate-markdown on the static tier, between format and lint:types", () => {
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
      "validate-dev-bundle",
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
      "validate-dev-bundle",
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

describe("cloudflareWorkerSteps() — watches", () => {
  const EVERY = {
    assetConfig: "src/assets/config.ts",
    workerConfig: "wrangler.jsonc",
    warden: true,
    jsx: {},
    markdown: {},
    design: DESIGN,
    ssrBoundary: { clientDirs: ["src/ui/client"], sources: ["src/"], entryPoints: ["mount.ts"], serverDirs: ["src/app"] },
    importBoundary: { guarded: ["src/showcase"] },
    vendorDir: "src/vendor",
    contrast: { cssDir: "src/assets", tokenFiles: [], mappingFile: "src/assets/theme.css", pairs: [], criteria: {} },
    db: true,
    browser: true,
    workerd: true,
    features: {},
  };

  const watchesOf = (steps: readonly Step[]): Record<string, readonly string[] | undefined> =>
    Object.fromEntries(steps.map((step) => [step.label, step.watches]));

  it("declares the warden row's synced trees, and derives the path-bounded rows", () => {
    const watches = watchesOf(cloudflareWorkerSteps(EVERY));

    expect(watches["warden"]).toEqual([".claude/**", "CLAUDE.md", "AGENTS.md"]);
    expect(watches["lint"]).toEqual(["src", "src/**", "tests", "tests/**", ".oxlintrc*", ".oxlintignore", ".gitignore"]);
    expect(watches["format"]).toEqual(["src", "src/**", "tests", "tests/**", ".oxfmtrc*", ".prettierignore", ".gitignore"]);
    expect(watches["validate-jsx"]).toEqual(["src", "src/**"]);
    expect(watches["validate-markdown"]).toEqual(["src/**/*.md"]);
    expect(watches["validate-modern-css"]).toEqual(["src", "src/**"]);
    expect(watches["validate-class-order"]).toEqual(["src", "src/**"]);
    expect(watches["validate-class-tokens"]).toEqual(["src", "src/**", "**/*.css"]);
    expect(watches["validate-css-coverage"]).toEqual(["src", "src/**", "**/*.css"]);
    expect(watches["validate-css-tokens"]).toEqual(["**/*.css"]);
    expect(watches["validate-ssr-boundary"]).toEqual(["src", "src/**"]);
    expect(watches["validate-client-boundary"]).toEqual(["src/ui/client", "src/ui/client/**", "src/app", "src/app/**"]);
    expect(watches["validate-vendor-boundary"]).toEqual(["src", "src/**"]);
    expect(watches["validate-exposure"]).toEqual(["wrangler.jsonc"]);
    expect(watches["validate-compatibility"]).toEqual(["wrangler.jsonc"]);
    expect(watches["validate-dev-boundary"]).toEqual(["src", "src/**", "wrangler.jsonc"]);
  });

  it("leaves undeclared every row whose inputs no path list bounds", () => {
    const steps = cloudflareWorkerSteps(EVERY);
    const undeclared = steps.filter((step) => step.watches === undefined).map((step) => step.label);

    expect(undeclared).toEqual([
      "types:cf-runtime",
      "types:cf-bindings",
      "types:assets",
      "validate-asset-manifest",
      "typecheck",
      "lint:types",
      "test",
      "validate-contrast",
      "validate-asset-root",
      "validate-dev-bundle",
      "db:schema:digests",
      "db:lint",
      "db:schema",
      "test:browser",
      "test:workerd",
      "validate-features",
    ]);
  });

  it("watches the whole root for a vendor tree directly under it", () => {
    expect(watchesOf(cloudflareWorkerSteps({ vendorDir: "vendor" }))["validate-vendor-boundary"]).toEqual(["**"]);
  });

  it("gives the features import-boundary row the watches the plain row derives for the same config", () => {
    const featured = cloudflareWorkerSteps({ importBoundary: { guarded: ["src/showcase"] }, features: {} });
    const plain = importBoundaryStep({ root: "/nowhere", guarded: ["src/showcase"] });

    expect(featured.find((step) => step.label === "validate-import-boundary")?.watches).toEqual(plain.watches);
    expect(watchesOf(cloudflareWorkerSteps({ importBoundary: { guarded: ["src/showcase"] } }))["validate-import-boundary"]).toEqual(plain.watches);
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

  it("holds back only the test row, so every check it emits is a static-run assurance", () => {
    const held = forgeChecks({ root: "/nowhere", pkg: PKG }).filter((step) => step.tier !== undefined);

    expect(held.map((step) => [step.label, step.tier])).toEqual([["test", "unit"]]);
  });

  it("omits the checks carrying project-specific policy, which a table must name explicitly", () => {
    const labels = labelsOf(forgeChecks({ root: "/nowhere", pkg: PKG }));

    expect(labels).not.toContain("validate-design");
    expect(labels).not.toContain("validate-contrast");
    expect(labels).not.toContain("validate-namespace-graph");
    expect(labels).not.toContain("validate-css-sources");
  });

  it("carries no machine prerequisite, so the whole preset is legal in a static run", () => {
    expect(forgeChecks({ root: "/nowhere", pkg: PKG }).filter((step) => step.requires !== undefined)).toEqual([]);
  });
});

describe("forgeChecks() — watches", () => {
  it("derives the path-bounded rows and leaves typecheck, test and exports undeclared", () => {
    const steps = forgeChecks({ root: "/nowhere", pkg: PKG });

    expect(steps.filter((step) => step.watches === undefined).map((step) => step.label)).toEqual(["typecheck", "test", "validate-exports"]);
    expect(steps.find((step) => step.label === "validate-class-order")?.watches).toEqual(["src", "src/**"]);
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
