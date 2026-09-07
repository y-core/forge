import { describe, expect, it } from "bun:test";

import {
  assetManifestStep,
  browserStep,
  changelogStep,
  classGroupsStep,
  classTokensStep,
  contrastStep,
  cssSourcesStep,
  cssTokensStep,
  designScaleStep,
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
import { hasTailwind } from "./checks/design-system";
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
    palettePath: () => "/nowhere/theme.css",
  }),
  cssSourcesStep({ root: "/nowhere", uiDir: "ui", cssDir: "css", sourceDir: "src", readme: "README.md" }),
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
      "validate-docs",
      "validate-changelog",
      "validate-design",
      "validate-contrast",
      "validate-css-sources",
      "validate-asset-manifest",
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

  // Both tools exit 0 on a `warn` diagnostic, so the flag is what makes a green gate mean a clean tree.
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
  it("defaults to the standard tier: it builds its own TypeScript program, so it stays off the fast loop", () => {
    expect(typeAwareLintStep().tier).toBe("standard");
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
  it("defaults to the full tier, because it is the one step needing a machine prerequisite", () => {
    expect(browserStep().tier).toBe("full");
  });

  it("spawns playwright under bun, since node cannot strip types from a forge subpath under node_modules", () => {
    expect(browserStep().cmd).toEqual(["bunx", "--bun", "playwright", "test"]);
  });

  it("names the browser as the prerequisite, not the playwright CLI that is always installed", () => {
    expect(browserStep().requires?.tool).toBe("chromium");
  });

  it("probes for the browser itself rather than spawning a command that could pass vacuously", () => {
    expect(browserStep().requires?.probe).toBe(hasChromium);
  });

  it("names both routes, since a reader who sees it is by definition outside a devbox container", () => {
    expect(browserStep().requires?.hint).toBe("run `bunx playwright install chromium`, or use a devbox container — `devctl up`");
  });

  it("takes a hint of its own, for a project installing the browser some other way", () => {
    expect(browserStep({ hint: "pnpm exec playwright install" }).requires?.hint).toBe("pnpm exec playwright install");
  });
});

describe("builders — tier", () => {
  it("puts every check on the fast tier except the changelog, which defaults to full", () => {
    expect(CHECK_STEPS.filter((step) => step.tier !== undefined).map((step) => [step.label, step.tier])).toEqual([["validate-changelog", "full"]]);
  });

  it("lets a project hold any check back to a higher tier", () => {
    expect(jsxStep({ root: "/nowhere" }, { tier: "full" }).tier).toBe("full");
    expect(jsxStep({ root: "/nowhere" }, { tier: "standard" }).tier).toBe("standard");
  });

  it("lets a project pull the changelog into the fast run, overriding the default", () => {
    expect(changelogStep({ root: "/nowhere", packageVersion: "1.0.0" }, { tier: "fast" }).tier).toBeUndefined();
  });

  it('omits the key rather than writing "fast", so a fast-tier step carries no key at all', () => {
    expect(Object.hasOwn(typecheckStep(), "tier")).toBe(false);
  });
});

describe("builders — conditional on tailwindcss", () => {
  const conditional = () => [
    classGroupsStep({ root: "/nowhere", stylesheet: "css/tailwind.css", table: "src/class-groups.ts" }),
    designScaleStep({ root: "/nowhere", stylesheet: "css/tailwind.css", table: "src/design-scale.ts" }),
    classTokensStep({ root: "/nowhere", sources: ["src/ui"], stylesheet: "css/tailwind.css" }),
    cssTokensStep({ root: "/nowhere", stylesheet: "css/tailwind.css", cssDir: "css" }),
  ];

  it("runs the four design-system steps from the fast tier up, naming tailwindcss and the command that installs it", () => {
    expect(conditional().map((step) => [step.label, step.tier, step.requires?.tool, step.requires?.hint])).toEqual([
      ["validate-class-groups", undefined, "tailwindcss", "run `bun add -d tailwindcss`"],
      ["validate-design-scale", undefined, "tailwindcss", "run `bun add -d tailwindcss`"],
      ["validate-class-tokens", undefined, "tailwindcss", "run `bun add -d tailwindcss`"],
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
  it("hands the config it was given to the check, rather than capturing one of its own", async () => {
    const step = changelogStep({ root: "/nowhere/forge-no-such-root", packageVersion: "1.0.0" });
    const result = await step.run("fast");

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => `${finding.file}: ${finding.message}`)).toEqual(["CHANGELOG.md: file does not exist"]);
  });

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
