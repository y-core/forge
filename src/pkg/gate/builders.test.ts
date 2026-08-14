import { describe, expect, it } from "bun:test";
import {
  browserStep,
  changelogStep,
  contrastStep,
  cssSourcesStep,
  designStep,
  docsStep,
  exportsStep,
  jsxStep,
  lintStep,
  namespaceGraphStep,
  testStep,
  typecheckStep,
} from "./builders";
import { hasChromium } from "./checks/browser";
import { isCheckStep, type Step } from "./steps";

const EXPORTS = { ".": "./src/mod.ts" };

const CHECK_STEPS: readonly Step[] = [
  exportsStep({ root: "/nowhere", packageName: "@scope/pkg", exports: EXPORTS, files: ["src"] }),
  namespaceGraphStep({ root: "/nowhere", exports: EXPORTS, graph: { primitives: [], leaf: [], edges: {} } }),
  jsxStep({ root: "/nowhere" }),
  docsStep({ root: "/nowhere", packageName: "@scope/pkg", exports: EXPORTS }),
  changelogStep({ root: "/nowhere", packageVersion: "1.0.0" }),
  designStep({ root: "/nowhere", packageName: "@scope/pkg", exports: EXPORTS, designDir: "design", cssDir: "css" }),
  contrastStep({
    root: "/nowhere",
    cssDir: "css",
    tokenFiles: ["css/theme.css"],
    mappingFile: "css/theme.css",
    pairs: [],
    criteria: {},
    palettePath: "/nowhere/theme.css",
  }),
  cssSourcesStep({ root: "/nowhere", uiDir: "ui", cssDir: "css", sourceDir: "src", readme: "README.md" }),
];

const COMMAND_STEPS: readonly Step[] = [typecheckStep(), lintStep(), testStep(), browserStep()];

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
      "validate-docs",
      "validate-changelog",
      "validate-design",
      "validate-contrast",
      "validate-css-sources",
    ]);
  });
});

describe("builders — the tool steps", () => {
  it("points the type checker at the whole project, with no source list to drift from lint's", () => {
    expect(typecheckStep().cmd).toEqual(["tsgo", "--noEmit"]);
  });

  it("defaults lint to src/ alone", () => {
    expect(lintStep().cmd).toEqual(["biome", "check", "src/"]);
  });

  it("threads sources through both the lint command and its fixer, so the two cannot diverge", () => {
    const lint = lintStep({ sources: ["src/", "scripts/"] });

    expect(lint.cmd).toEqual(["biome", "check", "src/", "scripts/"]);
    expect(lint.fix).toEqual(["biome", "check", "--write", "src/", "scripts/"]);
  });

  it("gives lint the only fixer, so --fix never rewrites what another step generated", () => {
    expect(COMMAND_STEPS.filter((step) => !isCheckStep(step) && step.fix !== undefined).map((step) => step.label)).toEqual(["lint"]);
  });

  it("tests the whole project when no paths are named", () => {
    expect(testStep().cmd).toEqual(["bun", "test"]);
  });

  it("passes every named test path to one bun test invocation", () => {
    expect(testStep({ sources: ["tests/unit/", "tests/seam/"] }).cmd).toEqual(["bun", "test", "tests/unit/", "tests/seam/"]);
  });

  it("gives the suite steps a wider tail than the tool steps, so late noise cannot bury a failure", () => {
    expect(testStep().tail).toBe(120);
    expect(browserStep().tail).toBe(120);
    expect(typecheckStep().tail).toBe(20);
    expect(lintStep().tail).toBe(20);
  });
});

describe("browserStep()", () => {
  it("is full-only, because it is the one step needing a machine prerequisite", () => {
    expect(browserStep().fullOnly).toBe(true);
  });

  it("names the browser as the prerequisite, not the playwright CLI that is always installed", () => {
    expect(browserStep().requires?.tool).toBe("chromium");
  });

  it("probes for the browser itself rather than spawning a command that could pass vacuously", () => {
    expect(browserStep().requires?.probe).toBe(hasChromium);
  });

  it("hints bun run test:install by default", () => {
    expect(browserStep().requires?.hint).toBe("bun run test:install");
  });

  it("takes a hint of its own, for a project installing the browser some other way", () => {
    expect(browserStep({ hint: "pnpm exec playwright install" }).requires?.hint).toBe("pnpm exec playwright install");
  });
});

describe("builders — fullOnly", () => {
  it("runs every check in a fast run except the changelog", () => {
    expect(CHECK_STEPS.filter((step) => step.fullOnly === true).map((step) => step.label)).toEqual(["validate-changelog"]);
  });

  it("lets a project hold any check back to --full", () => {
    expect(jsxStep({ root: "/nowhere" }, { fullOnly: true }).fullOnly).toBe(true);
  });

  it("lets a project pull the changelog into the fast run, overriding the default", () => {
    expect(changelogStep({ root: "/nowhere", packageVersion: "1.0.0" }, { fullOnly: false }).fullOnly).toBeUndefined();
  });

  it("omits fullOnly rather than writing false, so an every-mode step carries no key at all", () => {
    expect(Object.hasOwn(typecheckStep(), "fullOnly")).toBe(false);
  });
});

describe("builders — config threading", () => {
  it("hands the config it was given to the check, rather than capturing one of its own", async () => {
    const step = changelogStep({ root: "/nowhere/forge-no-such-root", packageVersion: "1.0.0" });
    const result = await step.run();

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => `${finding.file}: ${finding.message}`)).toEqual(["CHANGELOG.md: file does not exist"]);
  });

  it("defers the walk until the runner calls it, so building a table touches no disk", () => {
    expect(() => jsxStep({ root: "/nowhere/forge-no-such-root" })).not.toThrow();
  });
});
