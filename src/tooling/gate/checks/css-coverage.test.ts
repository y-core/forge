import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { worktreeFixture } from "../../cli/worktree.fixture";
import { checkCssCoverage } from "./css-coverage";
import { gateFixtureRoot } from "./gate.fixture";

const CLASSES = 'export const cls = "flex gap-2";\n';

const CLASSLESS = "export const answer = 42;\n";

const DETECTION_OFF = '@import "tailwindcss" source(none);\n';

const AUTO_DETECTION = {
  level: "fail",
  message: "automatic source detection is on, so a file no `@source` names is still scanned and the gap stays hidden",
  file: "src/css/app.css",
  detail: ['import Tailwind with `@import "tailwindcss" source(none);` and name every scanned path with `@source`'],
};

const roots: string[] = [];

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const TAILWIND = resolve(import.meta.dir, "../../../../node_modules/tailwindcss");

function repo(files: Record<string, string>): string {
  const root = worktreeFixture({ ".gitignore": "node_modules\n", ...files });
  roots.push(root);
  mkdirSync(join(root, "node_modules"));
  symlinkSync(TAILWIND, join(root, "node_modules/tailwindcss"));
  return root;
}

function uncovered(file: string, line: string) {
  return {
    level: "fail",
    message: "declares utility classes, but no `@source` covers it, so Tailwind generates none of them",
    file,
    detail: [`add to src/css/app.css: ${line}`],
  };
}

async function findingsIn(root: string, sources: readonly string[] = ["src/"]) {
  const result = await checkCssCoverage({ root, stylesheet: "src/css/app.css", sources });
  return result.findings.map(({ level, message, file, detail }) => ({ level, message, file, detail }));
}

async function findingsOf(files: Record<string, string>, sources?: readonly string[]) {
  return findingsIn(repo(files), sources);
}

describe("checkCssCoverage — passing", () => {
  it("passes a stylesheet with detection off whose sources cover every class-declaring file", async () => {
    const result = await checkCssCoverage({
      root: repo({
        "src/css/app.css": `${DETECTION_OFF}@source "../ui";\n`,
        "src/ui/card.tsx": CLASSES,
        "src/ui/card.test.tsx": CLASSES,
        "src/lib/math.ts": CLASSLESS,
      }),
      stylesheet: "src/css/app.css",
      sources: ["src/"],
    });

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("covers a file through an imported stylesheet whose `@source` is relative to its own directory", async () => {
    const findings = await findingsOf({
      "src/css/app.css": `${DETECTION_OFF}@import "./parts/ui.css";\n`,
      "src/css/parts/ui.css": '@source "../../ui";\n',
      "src/ui/card.tsx": CLASSES,
    });

    expect(findings).toEqual([]);
  });

  it("never judges a test, browser spec or fixture file, however uncovered", async () => {
    const findings = await findingsOf({
      "src/css/app.css": `${DETECTION_OFF}@source "../ui";\n`,
      "src/ui/card.tsx": CLASSES,
      "src/pages/home.test.ts": CLASSES,
      "src/pages/home.test.tsx": CLASSES,
      "src/pages/home.browser.ts": CLASSES,
      "src/pages/home.browser.tsx": CLASSES,
      "src/pages/home.fixture.ts": CLASSES,
      "src/pages/home.fixture.tsx": CLASSES,
    });

    expect(findings).toEqual([]);
  });

  it("never judges a file a `!`-prefixed config source excludes", async () => {
    const findings = await findingsOf(
      { "src/css/app.css": `${DETECTION_OFF}@source "../ui";\n`, "src/ui/card.tsx": CLASSES, "src/vendor/widget.tsx": CLASSES },
      ["src/", "!src/vendor"],
    );

    expect(findings).toEqual([]);
  });
});

describe("checkCssCoverage — the root mode", () => {
  it("claims only the counts in the summary of a failing result", async () => {
    const result = await checkCssCoverage({
      root: repo({ "src/css/app.css": '@import "tailwindcss";\n@source "../ui";\n', "src/ui/card.tsx": CLASSES, "src/lib/page.tsx": CLASSES }),
      stylesheet: "src/css/app.css",
      sources: ["src/"],
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toBe("2 source files against 1 `@source` declarations");
  });

  it("fails a stylesheet that leaves automatic detection on", async () => {
    const findings = await findingsOf({ "src/css/app.css": '@import "tailwindcss";\n@source "../ui";\n', "src/ui/card.tsx": CLASSES });

    expect(findings).toEqual([AUTO_DETECTION]);
  });

  it("fails an explicit `source(…)` root as detection, and counts nothing it scans as covered", async () => {
    const findings = await findingsOf({ "src/css/app.css": '@import "tailwindcss" source("../ui");\n', "src/ui/card.tsx": CLASSES });

    expect(findings).toEqual([AUTO_DETECTION, uncovered("src/ui/card.tsx", '@source "../ui";')]);
  });
});

describe("checkCssCoverage — uncovered files", () => {
  it("fails each uncovered class-declaring file, a `@source not` exclusion included", async () => {
    const findings = await findingsOf({
      "src/css/app.css": `${DETECTION_OFF}@source "../ui";\n@source not "../ui/legacy";\n`,
      "src/ui/card.tsx": CLASSES,
      "src/ui/legacy/old.tsx": CLASSES,
      "src/pages/home.tsx": CLASSES,
      "src/pages/home.test.tsx": CLASSES,
    });

    expect(findings).toEqual([
      uncovered("src/pages/home.tsx", '@source "../pages";'),
      uncovered("src/ui/legacy/old.tsx", '@source "../ui/legacy";'),
    ]);
  });

  it("fails a file a glob source misses even though a bare directory source there would cover it", async () => {
    const findings = await findingsOf({
      "src/css/app.css": `${DETECTION_OFF}@source "../ui/**/*.tsx";\n`,
      "src/ui/card.tsx": CLASSES,
      "src/ui/recipes.ts": CLASSES,
    });

    expect(findings).toEqual([uncovered("src/ui/recipes.ts", '@source "../ui";')]);
  });

  it("suggests the line relative to the entry stylesheet, not to the imported one that declares the sources", async () => {
    const findings = await findingsOf({
      "src/css/app.css": `${DETECTION_OFF}@import "./parts/ui.css";\n`,
      "src/css/parts/ui.css": '@source "../../ui";\n',
      "src/ui/card.tsx": CLASSES,
      "src/lib/recipes.ts": CLASSES,
    });

    expect(findings).toEqual([uncovered("src/lib/recipes.ts", '@source "../lib";')]);
  });

  const suggestions = [
    { file: "src/css/tokens.ts", line: '@source ".";' },
    { file: "src/css/parts/tokens.ts", line: '@source "./parts";' },
    { file: "src/features/a/b/view.tsx", line: '@source "../features/a/b";' },
    { file: "app/view.tsx", line: '@source "../../app";' },
  ];
  for (const { file, line } of suggestions) {
    it(`names \`${file}\` with the line \`${line}\`, and that line clears it`, async () => {
      const root = repo({ "src/css/app.css": `${DETECTION_OFF}@source "../ui";\n`, "src/ui/card.tsx": CLASSES, [file]: CLASSES });

      expect(await findingsIn(root, ["src/", "app/"])).toEqual([uncovered(file, line)]);

      const stylesheet = join(root, "src/css/app.css");
      writeFileSync(stylesheet, `${readFileSync(stylesheet, "utf-8")}${line}\n`);

      expect(await findingsIn(root, ["src/", "app/"])).toEqual([]);
    });
  }
});

describe("checkCssCoverage — scan breadth", () => {
  it("warns on a scanned directory none of whose source files declares a class, and still passes", async () => {
    const result = await checkCssCoverage({
      root: repo({
        "src/css/app.css": `${DETECTION_OFF}@source "../ui";\n@source "../lib";\n`,
        "src/ui/card.tsx": CLASSES,
        "src/lib/math.ts": CLASSLESS,
      }),
      stylesheet: "src/css/app.css",
      sources: ["src/"],
    });

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([
      {
        level: "warn",
        message: "is scanned by `@source`, but no source file it matches declares a utility class — scan breadth to cut",
        file: "src/lib",
        detail: ['@source "../lib" in src/css/'],
      },
    ]);
  });

  it("warns on a directory whose only class declarations are in test files", async () => {
    const findings = await findingsOf({
      "src/css/app.css": `${DETECTION_OFF}@source "../ui";\n@source "../lib";\n`,
      "src/ui/card.tsx": CLASSES,
      "src/lib/math.ts": CLASSLESS,
      "src/lib/math.test.ts": CLASSES,
    });

    expect(findings.map(({ level, file }) => [level, file])).toEqual([["warn", "src/lib"]]);
  });

  it("warns on a glob source none of whose matched files declares a class", async () => {
    const findings = await findingsOf({
      "src/css/app.css": `${DETECTION_OFF}@source "../ui";\n@source "../lib/**/*.ts";\n`,
      "src/ui/card.tsx": CLASSES,
      "src/lib/math.ts": CLASSLESS,
    });

    expect(findings.map(({ level, file, detail }) => [level, file, detail])).toEqual([
      ["warn", "src/lib/**/*.ts", ['@source "../lib/**/*.ts" in src/css/']],
    ]);
  });

  it("does not warn on a glob source that matches a class-declaring file", async () => {
    const findings = await findingsOf({
      "src/css/app.css": `${DETECTION_OFF}@source "../**/*.tsx";\n`,
      "src/ui/card.tsx": CLASSES,
      "src/lib/math.ts": CLASSLESS,
    });

    expect(findings).toEqual([]);
  });

  it("names the declaring stylesheet's directory for a classless source an imported stylesheet adds", async () => {
    const findings = await findingsOf({
      "src/css/app.css": `${DETECTION_OFF}@source "../ui";\n@import "./parts/lib.css";\n`,
      "src/css/parts/lib.css": '@source "../../lib";\n',
      "src/ui/card.tsx": CLASSES,
      "src/lib/math.ts": CLASSLESS,
    });

    expect(findings.filter(({ level }) => level === "warn").map(({ file, detail }) => [file, detail])).toEqual([
      ["src/lib", ['@source "../../lib" in src/css/parts/']],
    ]);
  });
});

describe("checkCssCoverage — refusals", () => {
  it("fails a root outside any git work tree without reading the stylesheet", async () => {
    const root = gateFixtureRoot({ "src/css/app.css": `${DETECTION_OFF}@plugin "./unloadable.js";\n`, "src/ui/card.tsx": CLASSES });
    roots.push(root);
    const result = await checkCssCoverage({ root, stylesheet: "src/css/app.css", sources: ["src/"] });

    expect(result).toEqual({
      ok: false,
      findings: [{ level: "fail", message: "is not inside a git work tree, so there is no file list to match `@source` against", file: "." }],
      summary: "",
    });
  });

  it("refuses a green gate when the config sources match no source file, without reading the stylesheet", async () => {
    const result = await checkCssCoverage({
      root: repo({ "src/css/app.css": `${DETECTION_OFF}@plugin "./unloadable.js";\n`, "src/ui/card.tsx": CLASSES }),
      stylesheet: "src/css/app.css",
      sources: ["docs/"],
    });

    expect(result).toEqual({
      ok: false,
      findings: [{ level: "fail", message: "`docs/` matched no source — refusing to report a green css-coverage gate that scanned nothing" }],
      summary: "",
    });
  });

  it("rejects a stylesheet that loads a `@plugin`, naming the module", async () => {
    const root = repo({ "src/css/app.css": `${DETECTION_OFF}@plugin "./unloadable.js";\n`, "src/ui/card.tsx": CLASSES });

    await expect(checkCssCoverage({ root, stylesheet: "src/css/app.css", sources: ["src/"] })).rejects.toThrow(
      "`./unloadable.js` was loaded as a module",
    );
  });
});
