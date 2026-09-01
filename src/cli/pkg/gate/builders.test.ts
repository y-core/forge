import { describe, expect, it } from "bun:test";

import {
  browserStep,
  changelogStep,
  contrastStep,
  cssSourcesStep,
  designStep,
  docsStep,
  exportsStep,
  formatStep,
  jsxStep,
  lintStep,
  namespaceGraphStep,
  testStep,
  typeAwareLintStep,
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
    expect(typecheckStep().cmd).toEqual(["tsc", "--noEmit"]);
  });

  it("defaults lint to src/ alone", () => {
    expect(lintStep().cmd).toEqual(["oxlint", "--deny-warnings", "src/"]);
  });

  it("defaults format to src/ alone", () => {
    expect(formatStep().cmd).toEqual(["oxfmt", "--check", "src/"]);
  });

  // Both tools exit 0 on a `warn` diagnostic, so the flag is what makes a green gate mean a clean
  // tree. The fixer must not carry it: a warning it has no safe fix for would make `--fix` exit
  // non-zero.
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

  it("gives the suite steps a wider tail than the tool steps, so late noise cannot bury a failure", () => {
    expect(testStep().tail).toBe(120);
    expect(browserStep().tail).toBe(120);
    expect(typecheckStep().tail).toBe(20);
    expect(lintStep().tail).toBe(20);
    expect(formatStep().tail).toBe(20);
  });
});

describe("typeAwareLintStep()", () => {
  it("is full-only: it builds its own TypeScript program, so it stays off the fast loop", () => {
    expect(typeAwareLintStep().fullOnly).toBe(true);
  });

  // The type-aware run is a superset of the syntax run, so it is the only one that can tell a stale
  // directive from one only a type-aware rule redeems. The check rides here for that reason.
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
