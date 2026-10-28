import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";

import {
  assetManifestStep,
  assetRootStep,
  browserStep,
  browserSteps,
  browserEnginesRequired,
  bundleStep,
  classGroupsStep,
  classOrderStep,
  classTokensStep,
  coLocationStep,
  commentBudgetStep,
  compatibilityStep,
  contrastStep,
  cssCoverageStep,
  cssSourcesStep,
  cssTokensStep,
  dbSteps,
  designScaleStep,
  devBoundaryStep,
  devBundleStep,
  exportsStep,
  exposureStep,
  formatStep,
  iccProfileStep,
  importBoundaryStep,
  jsxStep,
  lintStep,
  markdownStep,
  menuNamingStep,
  modernCssStep,
  namespaceGraphStep,
  namespaceWatches,
  packagingStep,
  sourceWatches,
  ssrBoundaryStep,
  stubGlobalsStep,
  featuresStep,
  testStep,
  typeAwareLintStep,
  typecheckStep,
  workerdStep,
} from "./builders";
import { hasTailwind } from "./checks/design-system";
import { gateFixtureRoot } from "./checks/gate.fixture";
import type { PlaywrightServerStatus } from "./checks/types";
import { hasWorkerd } from "./checks/workerd";
import { isCheckStep, selectSteps } from "./steps";
import type { CommandStep, GateTier, Step } from "./types";

const EXPORTS = { ".": "./src/mod.ts" };

const GRAPH = { primitives: ["p"], leaf: ["l"], edges: { a: { b: "value" }, b: { c: "type" }, d: { a: "value" } } } as const satisfies Parameters<
  typeof namespaceWatches
>[1];

const LISTING = ["--list"];

// The probe's parse is a function, so a row's narrowing is compared with the probe reduced to its arguments.
const narrowing = (step: Step): unknown => (step.narrow === undefined ? undefined : { ...step.narrow, probe: step.narrow.probe?.args });

const playwrightVersion = (createRequire(import.meta.url)("@playwright/test/package.json") as { version: string }).version;

const CHECK_STEPS: readonly Step[] = [
  exportsStep({ root: "/nowhere", packageName: "@scope/pkg", exports: EXPORTS, files: ["src"] }),
  namespaceGraphStep({ root: "/nowhere", exports: EXPORTS, graph: { primitives: [], leaf: [], edges: {} } }),
  jsxStep({ root: "/nowhere" }),
  contrastStep({
    root: "/nowhere",
    cssDir: "css",
    tokenFiles: ["css/theme.css"],
    mappingFile: "css/theme.css",
    pairs: [],
    criteria: {},
    palettePath: () => "/nowhere/theme.css",
  }),
  cssSourcesStep({ root: "/nowhere", uiDir: "ui", cssDir: "css", sourceDir: "src", readme: "README.md", packageName: "pkg", exports: {} }),
  assetManifestStep({ root: "/nowhere", assetConfig: "assets.config.ts" }),
];

const COMMAND_STEPS: readonly Step[] = [typecheckStep(), lintStep(), formatStep(), testStep(), browserStep()];

describe("builders — the two step kinds", () => {
  it("makes every check an in-process step, so none needs a spawnable file of its own", () => {
    expect(CHECK_STEPS.filter((step) => !isCheckStep(step))).toEqual([]);
  });

  it("leaves every external tool a spawned command", () => {
    expect(COMMAND_STEPS.filter(isCheckStep)).toEqual([]);
  });

  it("gives every step a label distinct from every other, since a label is an --only token", () => {
    const labels = [...COMMAND_STEPS, ...CHECK_STEPS].map((step) => step.label);

    expect(new Set(labels).size).toBe(labels.length);
  });

  it("labels every check `validate-<what>`", () => {
    expect(CHECK_STEPS.map((step) => step.label)).toEqual([
      "validate-exports",
      "validate-namespace-graph",
      "validate-jsx",
      "validate-contrast",
      "validate-css-sources",
      "validate-asset-manifest",
    ]);
  });
});

describe("markdownStep()", () => {
  it("carries an in-process fixer, which the other checks do not", () => {
    expect(typeof markdownStep({ root: "/nowhere" }).fix).toBe("function");
    expect(CHECK_STEPS.filter((step) => isCheckStep(step) && step.fix !== undefined)).toEqual([]);
  });

  it("runs from the tier the caller states, defaulting to static like every other check", () => {
    expect(markdownStep({ root: "/nowhere" }, { tier: "unit" }).tier).toBe("unit");
    expect(markdownStep({ root: "/nowhere" }).tier).toBeUndefined();
  });
});

describe("builders — the tool steps", () => {
  it("points the type checker at the whole project, with no source list to drift from lint's", () => {
    expect(typecheckStep().cmd).toEqual(["tsc", "--noEmit"]);
  });

  it("defaults lint to src/ alone", () => {
    expect(lintStep().cmd).toEqual(["oxlint", "--deny-warnings", "src/"]);
  });

  it("defaults format to src/ alone", () => {
    expect(formatStep().cmd).toEqual(["oxfmt", "--check", "src/"]);
  });

  it("fails lint on a warning, without letting the fixer inherit the flag", () => {
    const lint = lintStep();

    expect(lint.cmd).toContain("--deny-warnings");
    expect(lint.fix).not.toContain("--deny-warnings");
  });

  it("checks formatting without writing, and lets only the fixer write", () => {
    const format = formatStep();

    expect(format.cmd).toContain("--check");
    expect(format.fix).not.toContain("--check");
  });

  it("threads sources through both the lint command and its fixer, so the two cannot diverge", () => {
    const lint = lintStep({ sources: ["src/", "scripts/"] });

    expect(lint.cmd).toEqual(["oxlint", "--deny-warnings", "src/", "scripts/"]);
    expect(lint.fix).toEqual(["oxlint", "--fix", "src/", "scripts/"]);
  });

  it("threads sources through both the format command and its fixer, so the two cannot diverge", () => {
    const format = formatStep({ sources: ["src/", "scripts/"] });

    expect(format.cmd).toEqual(["oxfmt", "--check", "src/", "scripts/"]);
    expect(format.fix).toEqual(["oxfmt", "src/", "scripts/"]);
  });

  // `lint` before `format`: under `--fix` the formatter must write last and own the final layout.
  it("gives lint and format the only fixers, so --fix never rewrites what another step generated", () => {
    expect(COMMAND_STEPS.filter((step) => !isCheckStep(step) && step.fix !== undefined).map((step) => step.label)).toEqual(["lint", "format"]);
  });

  it("tests the whole project when no paths are named", () => {
    expect(testStep().cmd).toEqual(["bun", "test"]);
  });

  it("passes every named test path to one bun test invocation", () => {
    expect(testStep({ sources: ["tests/unit/", "tests/seam/"] }).cmd).toEqual(["bun", "test", "tests/unit/", "tests/seam/"]);
  });

  it("takes a label, so a suite split into sets gets one row per set", () => {
    expect(testStep({ label: "test:seam", sources: ["tests/seam/"] }).label).toBe("test:seam");
  });

  it("leaves a suite's temp leftovers unjudged unless the caller opts in", () => {
    expect(testStep().leavesNoTemp).toBeUndefined();
    expect(testStep({ leavesNoTemp: true }).leavesNoTemp).toBe(true);
  });

  it("stays the test row when no label is named", () => {
    expect(testStep().label).toBe("test");
    expect(testStep({ sources: ["tests/"] }).label).toBe("test");
  });

  it("gives the suite steps a wider tail than the tool steps, so late noise cannot bury a failure", () => {
    expect(testStep().tail).toBe(120);
    expect(browserStep().tail).toBe(120);
    expect(typecheckStep().tail).toBe(20);
    expect(lintStep().tail).toBe(20);
    expect(formatStep().tail).toBe(20);
  });
});

describe("typeAwareLintStep()", () => {
  it("defaults to the static tier: it judges the source rather than running it, whatever it costs", () => {
    expect(typeAwareLintStep().tier).toBeUndefined();
  });

  it("reports unused suppression directives as errors", () => {
    expect(typeAwareLintStep().cmd).toEqual([
      "oxlint",
      "--type-aware",
      "--deny-warnings",
      "--report-unused-disable-directives-severity",
      "error",
      "src/",
    ]);
  });

  it("has no fixer: a type-aware finding is never safe to rewrite unattended", () => {
    expect(typeAwareLintStep().fix).toBeUndefined();
  });
});

describe("browserStep()", () => {
  it("defaults to the runtime tier, because it needs a machine prerequisite", () => {
    expect(browserStep().tier).toBe("runtime");
  });

  it("runs from the tier the caller states, over its runtime default", () => {
    expect(browserStep({ tier: "release" }).tier).toBe("release");
  });

  it("narrows to the specs a pending change reaches, and runs whole when the Playwright config changes", () => {
    expect(narrowing(browserStep())).toEqual({ args: ["--only-changed"], wide: ["playwright.config.ts"], probe: LISTING });
  });

  it("adds a caller's wide globs to the Playwright config, and takes a caller's narrowing arguments", () => {
    expect(narrowing(browserStep({ narrow: { args: ["--last-failed"], wide: ["css/**"] } }))).toEqual({
      args: ["--last-failed"],
      wide: ["playwright.config.ts", "css/**"],
      probe: LISTING,
    });
  });

  it("carries a caller's traced paths onto every Playwright row, and none by default", () => {
    const widen = (): string[] => ["src/exposed.ts"];

    expect([browserStep().widen, workerdStep().widen]).toEqual([undefined, undefined]);
    expect([browserStep({ widen }).widen, workerdStep({ widen }).widen]).toEqual([widen, widen]);
    expect(browserSteps({ engines: ["chromium", "webkit"], widen }).map((step) => step.widen)).toEqual([widen, widen]);
  });

  it("reads a listing as selecting nothing only from Playwright's zero-test total", () => {
    const selects = browserStep().narrow?.probe?.selects ?? ((): boolean => true);

    expect(selects("Listing tests:\nTotal: 0 tests in 0 files\n")).toBe(false);
    expect(selects("Listing tests:\n  [chromium] › a.browser.ts:3:1 › a\nTotal: 1 test in 1 file\n")).toBe(true);
    expect(selects("Error: PW_TEST_CONNECT_WS_ENDPOINT is unset")).toBe(true);
    expect(selects("")).toBe(true);
    expect(selects("Total: 0 tests in 0 files\n  [chromium] › a.browser.ts:3:1 › a\nTotal: 1 test in 1 file\n")).toBe(true);
    expect(selects("Listing tests:\nTotal: 0 tests in 0 files\nWarning: listing interrupted\n")).toBe(true);
  });

  it("reads a total that is not the zero-test line whole as selecting", () => {
    const selects = browserStep().narrow?.probe?.selects ?? ((): boolean => false);
    const cases = [
      "Listing tests:\nTotal: 0 tests in 1 file\n",
      "Listing tests:\nTotal: 10 tests in 0 files\n",
      "Listing tests:\n  Total: 0 tests in 0 files\n",
      "Listing tests:\nTotal: 0 tests in 0 files (1 skipped)\n",
      "Listing tests:\ntotal: 0 tests in 0 files\n",
    ];

    expect(cases.filter((output) => !selects(output))).toEqual([]);
  });

  it("spawns the installed binary under node over the chromium project alone, so the workerd project stays its own row", () => {
    expect(browserStep().cmd).toEqual(["playwright", "test", "--project=chromium"]);
  });

  it("names one --project flag per engine it is given, in order", () => {
    expect(browserStep({ projects: ["firefox", "webkit"] }).cmd).toEqual(["playwright", "test", "--project=firefox", "--project=webkit"]);
  });

  it("never routes through a resolver that could fetch a binary from the registry", () => {
    expect(browserStep().cmd).not.toContain("bunx");
  });

  it("carries the browser requirement when the caller states none", () => {
    expect(browserStep().requires?.probe).toBeFunction();
  });

  it("refuses projects that span both Playwright servers, since one row connects to one", () => {
    expect(() => browserStep({ projects: ["chromium", "firefox"] })).toThrow(
      'browserStep: "chromium" and "firefox" run on different Playwright servers; give each engine its own row with browserSteps',
    );
  });

  it("takes Firefox and WebKit together, which share the compat server", () => {
    expect(() => browserStep({ projects: ["firefox", "webkit"] })).not.toThrow();
  });

  it("refuses a project that is not a browser engine, which no browser probe can answer for", () => {
    expect(() => browserStep({ projects: ["chromium", "workerd"] })).toThrow('project "workerd" is not a browser engine');
  });

  it("runs a project that is not a browser engine when the caller states the requirement", () => {
    const requires = { tool: "workerd", hint: "run `bun install`" };

    expect(browserStep({ projects: ["workerd"], requires }).requires).toBe(requires);
  });
});

describe("browserEnginesRequired() — no Playwright server named", () => {
  it("fails, so an unset endpoint never falls back to a local browser", () => {
    const requires = browserEnginesRequired(["chromium"], { env: {} });

    expect(requires.probe?.()).toBe(false);
    expect([requires.tool, requires.hint]).toEqual([
      "Playwright server",
      "`PW_TEST_CONNECT_WS_ENDPOINT` is unset; set it to the Playwright container's ws:// URL",
    ]);
  });

  it("treats an empty endpoint as unset, the way Playwright does", () => {
    expect(browserEnginesRequired(["chromium"], { env: { PW_TEST_CONNECT_WS_ENDPOINT: "" } }).probe?.()).toBe(false);
  });
});

describe("browserEnginesRequired() — a Playwright server named by PW_TEST_CONNECT_WS_ENDPOINT", () => {
  const ENDPOINT = "ws://playwright:3000/";

  function sidecar(status: PlaywrightServerStatus, env: Record<string, string> = {}) {
    const calls: { endpoint: string; client: string; headers: Readonly<Record<string, string>> | undefined }[] = [];
    const probes = {
      env: { PW_TEST_CONNECT_WS_ENDPOINT: ENDPOINT, ...env },
      serverStatus: (endpoint: string, client: string, headers?: Readonly<Record<string, string>>) => {
        calls.push({ endpoint, client, headers });
        return Promise.resolve(status);
      },
    };
    return { requires: browserEnginesRequired(["chromium"], probes), calls };
  }

  it("names the server as the prerequisite, since under a connection no local browser is launched", () => {
    expect(sidecar({ state: "ready" }).requires.tool).toBe(`Playwright server at ${ENDPOINT}`);
  });

  it("passes with no local engines when the server accepts the connection", async () => {
    expect(await sidecar({ state: "ready" }).requires.probe?.()).toBe(true);
  });

  it("asks the server as the installed @playwright/test, carrying PW_TEST_CONNECT_HEADERS", async () => {
    const { requires, calls } = sidecar({ state: "ready" }, { PW_TEST_CONNECT_HEADERS: '{"x-token":"abc"}' });
    await requires.probe?.();

    expect(calls).toEqual([{ endpoint: ENDPOINT, client: playwrightVersion, headers: { "x-token": "abc" } }]);
  });

  it("fails when the server does not answer, with a hint naming the endpoint and what to check", async () => {
    const { requires } = sidecar({ state: "unreachable", reason: "connect ECONNREFUSED" });

    expect(await requires.probe?.()).toBe(false);
    expect(requires.hint).toBe(
      `nothing answered at ${ENDPOINT} (connect ECONNREFUSED); check the Playwright sidecar is running and that NO_PROXY includes \`playwright\``,
    );
  });

  it("fails on a version mismatch, with a hint naming both versions and the pin that fixes it", async () => {
    const { requires } = sidecar({ state: "mismatch", server: "1.64" });

    expect(await requires.probe?.()).toBe(false);
    expect(requires.hint).toBe(
      `the server runs Playwright 1.64 and \`@playwright/test\` is ${playwrightVersion}; pin \`@playwright/test\` to 1.64`,
    );
  });

  it("fails rather than throwing on unreadable PW_TEST_CONNECT_HEADERS, and names the variable", async () => {
    const { requires, calls } = sidecar({ state: "ready" }, { PW_TEST_CONNECT_HEADERS: "{not json" });

    expect(await requires.probe?.()).toBe(false);
    expect(calls).toEqual([]);
    expect(requires.hint).toContain("PW_TEST_CONNECT_HEADERS");
  });

  it("blames a missing @playwright/test rather than the headers or the sidecar", async () => {
    const probes = {
      env: { PW_TEST_CONNECT_WS_ENDPOINT: "ws://no-client.test:3000/" },
      clientVersion: () => {
        throw new Error("Cannot find package '@playwright/test'");
      },
      serverStatus: () => Promise.resolve({ state: "ready" as const }),
    };
    const requires = browserEnginesRequired(["chromium"], probes);

    expect(await requires.probe?.()).toBe(false);
    expect(requires.hint).toBe(
      "`@playwright/test` cannot be resolved (Cannot find package '@playwright/test'); add it as a devDependency at the server's Playwright version",
    );
  });
});

describe("browserEnginesRequired() — Firefox and WebKit on the compat server", () => {
  const PRIMARY = "ws://playwright:3000/";
  const COMPAT = "ws://compat.test:3000/";
  const COMPAT_UNSET = [
    "Playwright compat server",
    "`PLAYWRIGHT_COMPAT_WS_ENDPOINT` is unset; Firefox and WebKit run on the playwright-compat server — start it with `devctl infra up playwright-compat` and set the variable to its ws:// URL",
  ];

  function servers(projects: readonly string[], env: Record<string, string>, status: PlaywrightServerStatus = { state: "ready" }) {
    const calls: { endpoint: string; headers: Readonly<Record<string, string>> | undefined }[] = [];
    const probes = {
      env,
      serverStatus: (endpoint: string, _client: string, headers?: Readonly<Record<string, string>>) => {
        calls.push({ endpoint, headers });
        return Promise.resolve(status);
      },
    };
    return { requires: browserEnginesRequired(projects, probes), calls };
  }

  it("fails with the compat server's hint when only the primary server is named", async () => {
    const { requires, calls } = servers(["firefox"], { PW_TEST_CONNECT_WS_ENDPOINT: PRIMARY });

    expect(await requires.probe?.()).toBe(false);
    expect([requires.tool, requires.hint]).toEqual(COMPAT_UNSET);
    expect(calls).toEqual([]);
  });

  it("treats an empty compat endpoint as unset", async () => {
    const { requires, calls } = servers(["webkit"], { PW_TEST_CONNECT_WS_ENDPOINT: PRIMARY, PLAYWRIGHT_COMPAT_WS_ENDPOINT: "" });

    expect(await requires.probe?.()).toBe(false);
    expect([requires.tool, requires.hint]).toEqual(COMPAT_UNSET);
    expect(calls).toEqual([]);
  });

  it("asks the compat server alone for Firefox and WebKit, never the primary", async () => {
    const { requires, calls } = servers(["firefox", "webkit"], { PW_TEST_CONNECT_WS_ENDPOINT: PRIMARY, PLAYWRIGHT_COMPAT_WS_ENDPOINT: COMPAT });

    expect(requires.tool).toBe("Playwright compat server at ws://compat.test:3000/");
    expect(await requires.probe?.()).toBe(true);
    expect(calls.map((call) => call.endpoint)).toEqual([COMPAT]);
  });

  it("asks the primary server alone for Chromium, with the compat server also named", async () => {
    const { requires, calls } = servers(["chromium"], { PW_TEST_CONNECT_WS_ENDPOINT: PRIMARY, PLAYWRIGHT_COMPAT_WS_ENDPOINT: COMPAT });

    expect(requires.tool).toBe("Playwright server at ws://playwright:3000/");
    expect(await requires.probe?.()).toBe(true);
    expect(calls.map((call) => call.endpoint)).toEqual([PRIMARY]);
  });

  it("fails when the compat server does not answer, with a hint naming how to bring it up", async () => {
    const { requires } = servers(
      ["firefox"],
      { PW_TEST_CONNECT_WS_ENDPOINT: PRIMARY, PLAYWRIGHT_COMPAT_WS_ENDPOINT: "ws://playwright-compat:3000/" },
      { state: "unreachable", reason: "connect ECONNREFUSED" },
    );

    expect(await requires.probe?.()).toBe(false);
    expect(requires.hint).toBe(
      "nothing answered at ws://playwright-compat:3000/ (connect ECONNREFUSED); check the playwright-compat server is up (`devctl infra up playwright-compat`) and that NO_PROXY includes `playwright-compat`",
    );
  });

  it("carries PW_TEST_CONNECT_HEADERS to the compat server", async () => {
    const { requires, calls } = servers(["webkit"], {
      PW_TEST_CONNECT_WS_ENDPOINT: PRIMARY,
      PLAYWRIGHT_COMPAT_WS_ENDPOINT: COMPAT,
      PW_TEST_CONNECT_HEADERS: '{"x-token":"abc"}',
    });
    await requires.probe?.();

    expect(calls).toEqual([{ endpoint: COMPAT, headers: { "x-token": "abc" } }]);
  });
});

describe("browserSteps()", () => {
  const ALL = { engines: ["chromium", "firefox", "webkit"] } as const;

  function rowsOf(steps: readonly CommandStep[]): [string, string | undefined, readonly string[]][] {
    return steps.map((step) => [step.label, step.tier, step.cmd]);
  }

  it("puts the primary engine on the runtime tier under the bare label, and every other engine on release under its own", () => {
    expect(rowsOf(browserSteps(ALL))).toEqual([
      ["test:browser", "runtime", ["playwright", "test", "--project=chromium"]],
      ["test:browser:firefox", "release", ["playwright", "test", "--project=firefox"]],
      ["test:browser:webkit", "release", ["playwright", "test", "--project=webkit"]],
    ]);
  });

  it("puts every engine row behind the Playwright server and narrows each the same way", () => {
    const rows = browserSteps({ ...ALL, narrow: { wide: ["css/**"] } });

    expect(rows.every((step) => typeof step.requires?.probe === "function")).toBe(true);
    expect(rows.map(narrowing)).toEqual(Array(3).fill({ args: ["--only-changed"], wide: ["playwright.config.ts", "css/**"], probe: LISTING }));
  });

  it("puts Chromium behind the primary server and Firefox and WebKit behind the compat server", () => {
    const saved = { primary: process.env.PW_TEST_CONNECT_WS_ENDPOINT, compat: process.env.PLAYWRIGHT_COMPAT_WS_ENDPOINT };
    process.env.PW_TEST_CONNECT_WS_ENDPOINT = "ws://playwright.test:3000/";
    process.env.PLAYWRIGHT_COMPAT_WS_ENDPOINT = "ws://compat.test:3000/";
    try {
      expect(browserSteps(ALL).map((step) => step.requires?.tool)).toEqual([
        "Playwright server at ws://playwright.test:3000/",
        "Playwright compat server at ws://compat.test:3000/",
        "Playwright compat server at ws://compat.test:3000/",
      ]);
    } finally {
      for (const [name, value] of [
        ["PW_TEST_CONNECT_WS_ENDPOINT", saved.primary],
        ["PLAYWRIGHT_COMPAT_WS_ENDPOINT", saved.compat],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("emits the same row for Chromium alone as browserStep does", () => {
    expect(rowsOf(browserSteps({ engines: ["chromium"] }))).toEqual(rowsOf([browserStep()]));
  });

  it("makes the named primary the runtime row", () => {
    expect(rowsOf(browserSteps({ ...ALL, primary: "webkit" })).map(([label, tier]) => [label, tier])).toEqual([
      ["test:browser:chromium", "release"],
      ["test:browser:firefox", "release"],
      ["test:browser", "runtime"],
    ]);
  });

  it("takes the first engine as primary when Chromium is not listed", () => {
    expect(rowsOf(browserSteps({ engines: ["webkit", "firefox"] })).map(([label, tier]) => [label, tier])).toEqual([
      ["test:browser", "runtime"],
      ["test:browser:firefox", "release"],
    ]);
  });

  it("carries a caller's watches onto every engine row", () => {
    expect(browserSteps({ ...ALL, watches: ["src/**"] }).map((step) => step.watches)).toEqual([["src/**"], ["src/**"], ["src/**"]]);
  });

  it("selects Chromium alone for `--only test:browser` at the release tier", () => {
    const selection = selectSteps(browserSteps(ALL), { tier: "release", only: ["test:browser"] });

    expect(selection.ok && selection.steps.map((step) => step.label)).toEqual(["test:browser"]);
  });

  it("holds every engine row out of the unit tier, and the matrix out of runtime and deploy", () => {
    const labelsAt = (tier: GateTier): string[] => {
      const selection = selectSteps([typecheckStep(), ...browserSteps(ALL)], { tier });
      return selection.ok ? selection.steps.map((step) => step.label).filter((label) => label.startsWith("test:browser")) : [];
    };

    expect([labelsAt("unit"), labelsAt("runtime"), labelsAt("deploy")]).toEqual([[], ["test:browser"], ["test:browser"]]);
  });

  it("refuses an empty engine list", () => {
    expect(() => browserSteps({ engines: [] as unknown as readonly ["chromium"] })).toThrow("browserSteps: `engines` is empty");
  });

  it("refuses an engine Playwright does not ship", () => {
    expect(() => browserSteps({ engines: ["edge" as "chromium"] })).toThrow('browserSteps: "edge" is not a browser engine');
  });

  it("refuses an engine named twice", () => {
    expect(() => browserSteps({ engines: ["firefox", "firefox"] })).toThrow('browserSteps: "firefox" is named twice');
  });

  it("refuses a primary engine that is not listed", () => {
    expect(() => browserSteps({ engines: ["firefox"], primary: "chromium" })).toThrow('browserSteps: primary "chromium" is not among the engines');
  });
});

describe("workerdStep()", () => {
  it("defaults to the runtime tier, because it is held back on a prerequisite the way the browser set is", () => {
    expect(workerdStep().tier).toBe("runtime");
  });

  it("runs from the tier the caller states, over its runtime default", () => {
    expect(workerdStep({ tier: "deploy" }).tier).toBe("deploy");
  });

  it("narrows and widens as the browser row does", () => {
    expect(narrowing(workerdStep())).toEqual({ args: ["--only-changed"], wide: ["playwright.config.ts"], probe: LISTING });
  });

  it("runs the workerd Playwright project under node, where createTestHarness answers HTTP", () => {
    expect(workerdStep().cmd).toEqual(["playwright", "test", "--project=workerd"]);
  });

  it("narrows the project to the sources a caller names", () => {
    expect(workerdStep({ sources: ["tests/runtime/"] }).cmd).toEqual(["playwright", "test", "--project=workerd", "tests/runtime/"]);
  });

  it("never routes through a resolver that could fetch a binary from the registry", () => {
    expect(workerdStep().cmd).not.toContain("bunx");
  });

  it("names the runtime as the prerequisite, not the playwright CLI that is always installed", () => {
    expect(workerdStep().requires?.tool).toBe("workerd");
  });

  it("probes for the runtime itself rather than spawning a command that could pass vacuously", () => {
    expect(workerdStep().requires?.probe).toBe(hasWorkerd);
  });

  it("leaves a run's temp leftovers unjudged unless the caller opts in", () => {
    expect(workerdStep().leavesNoTemp).toBeUndefined();
    expect(workerdStep({ leavesNoTemp: true }).leavesNoTemp).toBe(true);
  });

  it("declares Playwright's transform cache as a temp entry it keeps by design", () => {
    expect(workerdStep().tempCaches).toEqual(["playwright-transform-cache-*"]);
  });
});

describe("featuresStep()", () => {
  it("is the validate-features row, on the deploy tier because it runs a whole second gate", () => {
    const step = featuresStep({ root: "/nowhere" });

    expect(step.label).toBe("validate-features");
    expect(step.tier).toBe("deploy");
  });

  it("takes no tier override, since a lower tier would recurse into the gate it runs", () => {
    // @ts-expect-error -- `tier` is not part of the options featuresStep takes
    expect(featuresStep({ root: "/nowhere" }, { tier: "static" }).tier).toBe("deploy");
  });
});

describe("builders — tier", () => {
  it("puts every check this namespace still builds on the static tier", () => {
    expect(CHECK_STEPS.filter((step) => step.tier !== undefined)).toEqual([]);
  });

  it("lets a project hold any check back to a higher tier", () => {
    expect(jsxStep({ root: "/nowhere" }, { tier: "release" }).tier).toBe("release");
    expect(jsxStep({ root: "/nowhere" }, { tier: "unit" }).tier).toBe("unit");
  });

  it("puts the test suite on the unit tier and the dev bundle on deploy", () => {
    expect(testStep().tier).toBe("unit");
    expect(devBundleStep({ root: "/nowhere" }).tier).toBe("deploy");
  });

  it('omits the key rather than writing "static", so a static-tier step carries no key at all', () => {
    expect(Object.hasOwn(typecheckStep(), "tier")).toBe(false);
  });
});

describe("bundleStep()", () => {
  const BUNDLE = { root: "/nowhere", entry: "src/lint/mod.ts", bundle: "src/lint/plugin.mjs", fixer: "gen" };

  it("takes a label, so each committed bundle gets a drift row of its own", () => {
    expect([bundleStep("validate-a", BUNDLE).label, bundleStep("validate-b", BUNDLE).label]).toEqual(["validate-a", "validate-b"]);
  });

  it("requires esbuild, naming the command that installs it, and carries no in-process fixer", () => {
    const step = bundleStep("validate-a", BUNDLE);

    expect([step.requires?.tool, step.requires?.hint, step.fix]).toEqual(["esbuild", "run `bun add -d esbuild`", undefined]);
  });
});

describe("builders — conditional on tailwindcss", () => {
  const conditional = () => [
    classGroupsStep({ root: "/nowhere", stylesheet: "css/tailwind.css", table: "src/class-groups.ts" }),
    designScaleStep({ root: "/nowhere", stylesheet: "css/tailwind.css", table: "src/design-scale.ts" }),
    classTokensStep({ root: "/nowhere", sources: ["src/ui"], stylesheet: "css/tailwind.css" }),
    cssCoverageStep({ root: "/nowhere", sources: ["src/ui"], stylesheet: "css/tailwind.css" }),
    cssTokensStep({ root: "/nowhere", stylesheet: "css/tailwind.css", cssDir: "css" }),
  ];

  it("runs the design-system steps from the static tier up, naming tailwindcss and the command that installs it", () => {
    expect(conditional().map((step) => [step.label, step.tier, step.requires?.tool, step.requires?.hint])).toEqual([
      ["validate-class-groups", undefined, "tailwindcss", "run `bun add -d tailwindcss`"],
      ["validate-design-scale", undefined, "tailwindcss", "run `bun add -d tailwindcss`"],
      ["validate-class-tokens", undefined, "tailwindcss", "run `bun add -d tailwindcss`"],
      ["validate-css-coverage", undefined, "tailwindcss", "run `bun add -d tailwindcss`"],
      ["validate-css-tokens", undefined, "tailwindcss", "run `bun add -d tailwindcss`"],
    ]);
  });

  // The default probe spawns `tailwindcss --version`, and the package has no guaranteed bin — it would
  // report the dependency absent on a machine that has it.
  it("probes for the resolvable package rather than a command that may not exist", () => {
    expect(conditional().every((step) => step.requires?.probe === hasTailwind)).toBe(true);
  });

  it("gives each step a requirement of its own, so no two steps alias one record", () => {
    const [first, second] = conditional();

    expect(first?.requires).not.toBe(second?.requires);
  });

  it("attaches the requirement to the contrast step only when it was pointed at a palette", () => {
    const withPalette = contrastStep({
      root: "/nowhere",
      cssDir: "css",
      tokenFiles: [],
      mappingFile: "css/theme.css",
      pairs: [],
      criteria: {},
      palettePath: () => "/nowhere/theme.css",
    });
    const without = contrastStep({ root: "/nowhere", cssDir: "css", tokenFiles: [], mappingFile: "css/theme.css", pairs: [], criteria: {} });

    expect(withPalette.requires?.tool).toBe("tailwindcss");
    expect(Object.hasOwn(without, "requires")).toBe(false);
  });

  it("lets a project that vendors the dependency drop it, rather than being gated on probing it", () => {
    const step = classGroupsStep({ root: "/nowhere", stylesheet: "css/tailwind.css", table: "src/class-groups.ts" }, { requires: null });

    expect(Object.hasOwn(step, "requires")).toBe(false);
  });
});

describe("builders — config threading", () => {
  it("defers the walk until the runner calls it, so building a table touches no disk", () => {
    expect(() => jsxStep({ root: "/nowhere/forge-no-such-root" })).not.toThrow();
  });

  it("defers the palette resolve too, so a table builds on a machine that cannot resolve one", () => {
    const build = () =>
      contrastStep({
        root: "/nowhere",
        cssDir: "css",
        tokenFiles: [],
        mappingFile: "css/theme.css",
        pairs: [],
        criteria: {},
        palettePath: () => {
          throw new Error("Cannot find package 'tailwindcss'");
        },
      });

    expect(build).not.toThrow();
  });
});

describe("sourceWatches()", () => {
  it("covers each entry and everything beneath it, whatever slashes the entry carries", () => {
    expect(sourceWatches(["src/", "./tests", "README.md"])).toEqual(["src", "src/**", "tests", "tests/**", "README.md", "README.md/**"]);
  });

  it("widens the repository root to every path", () => {
    expect(sourceWatches(["."])).toEqual(["**"]);
    expect(sourceWatches(["./"])).toEqual(["**"]);
  });

  it("drops a `!` exclusion, so the list stays a superset of what the walk reads", () => {
    expect(sourceWatches(["src", "!src/gen"])).toEqual(["src", "src/**"]);
  });

  it("names each glob once", () => {
    expect(sourceWatches(["src", "src/"])).toEqual(["src", "src/**"]);
  });
});

describe("namespaceWatches()", () => {
  it("follows edges of either kind transitively, never against their direction, and adds the primitives", () => {
    expect(namespaceWatches(["a"], GRAPH)).toEqual(["src/a/**", "src/b/**", "src/c/**", "src/p/**"]);
  });

  it("knows a namespace from any place the graph declares it", () => {
    expect(namespaceWatches(["l", "c", "p"], GRAPH)).toEqual(["src/c/**", "src/l/**", "src/p/**"]);
  });

  it("refuses a namespace the graph does not declare", () => {
    expect(() => namespaceWatches(["a", "nope"], GRAPH)).toThrow('"nope", which the namespace graph does not declare');
  });

  it("closes over a cycle in the edges, watching each namespace on it once", () => {
    const cyclic = { primitives: [], leaf: [], edges: { a: { b: "value" }, b: { c: "value" }, c: { a: "type" } } } as const;

    expect(namespaceWatches(["b"], cyclic)).toEqual(["src/a/**", "src/b/**", "src/c/**"]);
  });

  it("follows a primitive's own edges, since the closure starts from every primitive", () => {
    const graph = { primitives: ["p"], leaf: [], edges: { p: { q: "value" }, q: {}, x: {} } } as const;

    expect(namespaceWatches(["x"], graph)).toEqual(["src/p/**", "src/q/**", "src/x/**"]);
  });
});

describe("builders — derived watches", () => {
  const BUNDLE = { root: "/nowhere", entry: "src/lint/mod.ts", bundle: "src/lint/plugin.mjs", fixer: "gen" };
  const CONTRAST = { root: "/nowhere", cssDir: "css", tokenFiles: [], mappingFile: "css/theme.css", pairs: [], criteria: {} };

  it("derives each builder's default from its sources and config files", () => {
    const cases: [Step, readonly string[] | undefined][] = [
      [typecheckStep(), undefined],
      [typeAwareLintStep(), undefined],
      [testStep(), undefined],
      [browserStep(), undefined],
      [workerdStep(), undefined],
      [featuresStep({ root: "/nowhere" }), undefined],
      [exportsStep({ root: "/nowhere", packageName: "p", exports: EXPORTS, files: [] }), undefined],
      [namespaceGraphStep({ root: "/nowhere", exports: EXPORTS, graph: { primitives: [], leaf: [], edges: {} } }), undefined],
      [packagingStep({ root: "/nowhere", files: [], exports: EXPORTS, entries: [], required: [] }), undefined],
      [assetRootStep({ root: "/nowhere", assetConfig: "assets.ts" }), undefined],
      [assetManifestStep({ root: "/nowhere", assetConfig: "assets.ts" }), undefined],
      [contrastStep(CONTRAST), undefined],
      [bundleStep("validate-bundle", BUNDLE), undefined],
      [lintStep(), ["src", "src/**", ".oxlintrc*", ".oxlintignore", ".gitignore"]],
      [formatStep({ sources: ["."] }), ["**", ".oxfmtrc*", ".prettierignore", ".gitignore"]],
      [jsxStep({ root: "/nowhere" }), ["src", "src/**"]],
      [menuNamingStep({ root: "/nowhere", sources: ["app/"] }), ["app", "app/**"]],
      [coLocationStep({ root: "/nowhere", sources: ["src", "warden"] }), ["src", "src/**", "warden", "warden/**"]],
      [commentBudgetStep({ root: "/nowhere", sources: ["src", "!**/.wrangler"] }), ["src", "src/**"]],
      [ssrBoundaryStep({ root: "/nowhere", clientDirs: [], sources: ["src/ui"], entryPoints: [] }), ["src/ui", "src/ui/**"]],
      [classOrderStep({ root: "/nowhere", sources: ["src"] }), ["src", "src/**"]],
      [modernCssStep({ root: "/nowhere", sources: ["src/ui"] }), ["src/ui", "src/ui/**"]],
      [importBoundaryStep({ root: "/nowhere", guarded: ["src/tooling"] }), ["src", "src/**", "src/tooling", "src/tooling/**"]],
      [devBoundaryStep({ root: "/nowhere" }), ["src", "src/**", "wrangler.jsonc"]],
      [devBoundaryStep({ root: "/nowhere", workerConfig: "app/wrangler.jsonc" }), ["src", "src/**", "app/wrangler.jsonc"]],
      [devBoundaryStep({ root: "/nowhere", workerConfig: null }), ["src", "src/**"]],
      [
        stubGlobalsStep({ root: "/nowhere", stubs: [".types"], shared: [], sources: ["src", "!src/dev"] }),
        [".types", ".types/**", "src", "src/**"],
      ],
      [classTokensStep({ root: "/nowhere", sources: ["src/ui"], stylesheet: "css/t.css" }), ["src/ui", "src/ui/**", "**/*.css"]],
      [classGroupsStep({ root: "/nowhere", stylesheet: "css/t.css", table: "src/groups.ts" }), ["**/*.css", "src/groups.ts"]],
      [designScaleStep({ root: "/nowhere", stylesheet: "css/t.css", table: "src/scale.ts" }), ["**/*.css", "src/scale.ts"]],
      [cssTokensStep({ root: "/nowhere", stylesheet: "css/t.css", cssDir: "css" }), ["**/*.css"]],
      [iccProfileStep({ root: "/nowhere", profile: "pdf/p.icc", module: "pdf/icc.ts" }), ["pdf/p.icc", "pdf/icc.ts"]],
      [
        cssSourcesStep({
          root: "/nowhere",
          uiDir: "src/ui",
          cssDir: "src/ui/css",
          sourceDir: "src",
          readme: "src/ui/README.md",
          packageName: "pkg",
          exports: {},
        }),
        ["src/ui", "src/ui/**", "src/ui/css", "src/ui/css/**", "src", "src/**", "src/ui/README.md", "src/ui/README.md/**"],
      ],
      [exposureStep({ root: "/nowhere" }), ["wrangler.jsonc"]],
      [compatibilityStep({ root: "/nowhere", workerConfig: "app.jsonc" }), ["app.jsonc"]],
    ];

    for (const [step, watches] of cases) {
      expect([step.label, step.watches]).toEqual([step.label, watches]);
    }
  });

  it("reads only markdown for the markdown row, in each shape an entry takes", () => {
    expect(markdownStep({ root: "/nowhere" }).watches).toEqual(["src/**/*.md"]);
    expect(markdownStep({ root: "/nowhere", sources: [".", "./docs/", "README.md", "!docs/gen"] }).watches).toEqual([
      "**/*.md",
      "docs/**/*.md",
      "README.md",
    ]);
  });

  it("replaces a derived default with the caller's, and drops it on null", () => {
    expect(jsxStep({ root: "/nowhere" }, { watches: ["app/**"] }).watches).toEqual(["app/**"]);
    expect(lintStep({ watches: ["x/**"] }).watches).toEqual(["x/**"]);
    expect(Object.hasOwn(jsxStep({ root: "/nowhere" }, { watches: null }), "watches")).toBe(false);
    expect(Object.hasOwn(formatStep({ watches: null }), "watches")).toBe(false);
  });

  it("declares watches on a builder that derives none", () => {
    expect(typecheckStep({ watches: ["src/**"] }).watches).toEqual(["src/**"]);
    expect(browserStep({ watches: ["src/**"] }).watches).toEqual(["src/**"]);
    expect(contrastStep(CONTRAST, { watches: ["css/**"] }).watches).toEqual(["css/**"]);
  });

  it("watches the root and every namespace `exercises` reaches through the graph on every db row, primitives included", () => {
    const watched = ["src/a/**", "src/b/**", "src/c/**", "src/p/**", "db/fixture/**"];

    expect(dbSteps({ root: "db/fixture/", exercises: ["a"], graph: GRAPH }).map((step) => step.watches)).toEqual([watched, watched, watched]);
  });

  it("watches every change for a db row with no `exercises`, or whose root is the project itself", () => {
    expect(dbSteps().map((step) => Object.hasOwn(step, "watches"))).toEqual([false, false, false]);
    expect(dbSteps({ root: "db/fixture" }).map((step) => Object.hasOwn(step, "watches"))).toEqual([false, false, false]);
    expect(dbSteps({ root: "/app", exercises: ["a"], graph: GRAPH }).map((step) => Object.hasOwn(step, "watches"))).toEqual([false, false, false]);
  });

  it("traces the source file its command runs, resolved from the gate's root, and nothing for a bare binary", async () => {
    const [digests, lint, replay] = dbSteps({ forge: ["bun", "run", "./bin.ts"] });
    const root = gateFixtureRoot({ "bin.ts": 'import { a } from "./lib/a";\nexport { a };\n', "lib/a.ts": "export const a = 1;\n" });

    expect(await lint.widen?.(root)).toEqual(["bin.ts", "lib/a.ts"]);
    expect([digests.widen, replay.widen].every((widen) => widen === lint.widen)).toBe(true);
    expect(dbSteps().map((step) => step.widen)).toEqual([undefined, undefined, undefined]);
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses a namespace the graph does not declare, and `exercises` without a graph", () => {
    expect(() => dbSteps({ root: "/app", exercises: ["a", "nope"], graph: GRAPH })).toThrow(
      'dbSteps: `exercises` names "nope", which the namespace graph does not declare',
    );
    expect(() => dbSteps({ root: "db", exercises: ["a"] })).toThrow("needs the `graph`");
  });

  it("puts the lint and the replay in runtime behind workerd, and the digests in static", () => {
    expect(dbSteps().map((step) => [step.label, step.tier, step.requires?.tool])).toEqual([
      ["db:schema:digests", undefined, undefined],
      ["db:lint", "runtime", "workerd"],
      ["db:schema", "runtime", "workerd"],
    ]);
  });

  it("declares no narrowing on any db row, so each runs whole or not at all", () => {
    expect(dbSteps().map((step) => step.narrow)).toEqual([undefined, undefined, undefined]);
  });

  it("passes --root and the forge command to every row", () => {
    expect(dbSteps({ root: "app", forge: ["bun", "x"] }).map((step) => step.cmd.join(" "))).toEqual([
      "bun x db schema check --root app",
      "bun x db lint --root app",
      "bun x db schema check --replay --root app",
    ]);
  });
});
