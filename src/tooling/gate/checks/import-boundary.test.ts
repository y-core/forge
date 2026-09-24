import { describe, expect, it } from "bun:test";

import { gateFixtureRoot } from "./gate.fixture";
import { checkImportBoundary, guardedSubpaths, isGuarded } from "./import-boundary";
import type { ImportBoundaryCheckConfig } from "./types";

const BUILD_DIRS = ["src/tooling", "src/ui/assets/build"] as const;

const EXPORTS = {
  "./http": { import: "./src/http/mod.ts", types: "./src/http/mod.ts" },
  "./tooling/assets": { import: "./src/tooling/assets/mod.ts", types: "./src/tooling/assets/mod.ts" },
  "./ui/assets/build": { import: "./src/ui/assets/build/mod.ts", types: "./src/ui/assets/build/mod.ts" },
  "./ui/assets/css/*.css": "./src/ui/assets/css/*.css",
};

// A guarded directory must exist, so each is created with a file the walk does not scan.
const GUARDED_TREES = Object.fromEntries(BUILD_DIRS.map((dir) => [`${dir}/.keep`, ""]));

function project(files: Record<string, string>): ImportBoundaryCheckConfig {
  return {
    root: gateFixtureRoot({ ...GUARDED_TREES, ...files }, "forge-ib-"),
    packageName: "@y-core/forge",
    exports: EXPORTS,
    guarded: BUILD_DIRS,
    sources: ["src"],
  };
}

// A starter-shaped app: a showcase slice the skeleton may not reach, save through its composition root.
function app(files: Record<string, string>, crossings?: readonly string[]): ImportBoundaryCheckConfig {
  return { root: gateFixtureRoot(files, "forge-ib-app-"), guarded: ["src/showcase"], ...(crossings === undefined ? {} : { crossings }) };
}

const SHOWCASE = { "src/showcase/mod.ts": "export const registerShowcase = () => 1;\n" };

describe("isGuarded", () => {
  it("accepts a guarded directory itself and anything under it", () => {
    expect(isGuarded("src/tooling", BUILD_DIRS)).toBe(true);
    expect(isGuarded("src/tooling/gate/checks/exports.ts", BUILD_DIRS)).toBe(true);
    expect(isGuarded("src/ui/assets/build/color.ts", BUILD_DIRS)).toBe(true);
  });

  it("does not mistake a sibling with the same prefix for a guarded directory", () => {
    expect(isGuarded("src/tooling-helpers/thing.ts", BUILD_DIRS)).toBe(false);
    expect(isGuarded("src/ui/assets/glyphs.ts", BUILD_DIRS)).toBe(false);
  });
});

describe("guardedSubpaths", () => {
  it("names every published subpath whose target is guarded, as a consumer spells it", () => {
    const found = guardedSubpaths({ packageName: "@y-core/forge", exports: EXPORTS, guarded: BUILD_DIRS });

    expect([...found.entries()].sort()).toEqual([
      ["@y-core/forge/tooling/assets", "src/tooling/assets/mod.ts"],
      ["@y-core/forge/ui/assets/build", "src/ui/assets/build/mod.ts"],
    ]);
  });

  it("omits an unguarded subpath, so importing it is never reported", () => {
    expect(guardedSubpaths({ packageName: "@y-core/forge", exports: EXPORTS, guarded: BUILD_DIRS }).has("@y-core/forge/http")).toBe(false);
  });

  it("is empty for an application that publishes nothing", () => {
    expect(guardedSubpaths({ exports: EXPORTS, guarded: BUILD_DIRS }).size).toBe(0);
    expect(guardedSubpaths({ packageName: "@y-core/forge", guarded: BUILD_DIRS }).size).toBe(0);
  });

  it("reads a string target, and falls back to `types` for an entry carrying no `import`", () => {
    const found = guardedSubpaths({
      packageName: "pkg",
      exports: { "./a": "./src/tooling/a.ts", "./b": { types: "./src/tooling/b.d.ts" }, "./c": {} },
      guarded: BUILD_DIRS,
    });

    expect([...found.entries()].sort()).toEqual([
      ["pkg/a", "src/tooling/a.ts"],
      ["pkg/b", "src/tooling/b.d.ts"],
    ]);
  });
});

describe("checkImportBoundary — a build-time tree", () => {
  it("passes an unguarded module that imports only unguarded modules", () => {
    const result = checkImportBoundary(
      project({
        "src/http/mod.ts": 'export { html } from "./html";\n',
        "src/http/html.ts": "export const html = 1;\n",
        "src/tooling/assets/mod.ts": 'export { safeJoin } from "./paths";\n',
        "src/tooling/assets/paths.ts": 'import { resolve } from "node:path";\nexport const safeJoin = resolve;\n',
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("2 sources outside `src/tooling`, `src/ui/assets/build` import nothing inside them");
  });

  it("reports a relative import into a guarded directory, with the file, line and resolved target", () => {
    const result = checkImportBoundary(
      project({
        "src/http/mod.ts": '/** doc */\nexport { safeJoin } from "../tooling/assets/paths";\n',
        "src/tooling/assets/paths.ts": "export const safeJoin = 1;\n",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.file).toBe("src/http/mod.ts");
    expect(result.findings[0]?.line).toBe(2);
    expect(result.findings[0]?.message).toBe("import boundary crossed — `../tooling/assets/paths` resolves to `src/tooling/assets/paths.ts`");
  });

  it("tells the author which directories are guarded and how to clear the finding", () => {
    const result = checkImportBoundary(
      project({
        "src/http/mod.ts": 'export { safeJoin } from "../tooling/assets/paths";\n',
        "src/tooling/assets/paths.ts": "export const safeJoin = 1;\n",
      }),
    );

    expect(result.findings[0]?.detail).toEqual([
      "nothing outside `src/tooling`, `src/ui/assets/build` may import from inside them at value",
      "move the importing module inside the guarded tree, or drop the import",
    ]);
  });

  it("resolves a directory specifier through its `mod.ts`", () => {
    const result = checkImportBoundary(
      project({
        "src/http/mod.ts": 'export { safeJoin } from "../tooling/assets";\n',
        "src/tooling/assets/mod.ts": "export const safeJoin = 1;\n",
      }),
    );

    expect(result.findings[0]?.message).toBe("import boundary crossed — `../tooling/assets` resolves to `src/tooling/assets/mod.ts`");
  });

  it("reports a self-import by package name, which resolves to nothing relative", () => {
    const result = checkImportBoundary(
      project({
        "src/http/mod.ts": 'export { hashString } from "@y-core/forge/tooling/assets";\n',
        "src/tooling/assets/mod.ts": "export const hashString = 1;\n",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("import boundary crossed — `@y-core/forge/tooling/assets` resolves to `src/tooling/assets/mod.ts`");
  });

  it("reports a module no barrel exports, which no reachability walk would find", () => {
    const result = checkImportBoundary(
      project({
        "src/http/mod.ts": "export const html = 1;\n",
        "src/ui/orphan.ts": 'import { safeJoin } from "../tooling/assets/paths";\nexport const x = safeJoin;\n',
        "src/tooling/assets/paths.ts": "export const safeJoin = 1;\n",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.file).toBe("src/ui/orphan.ts");
  });

  it("reports a side-effect import and a dynamic one, neither of which binds a name", () => {
    const result = checkImportBoundary(
      project({
        "src/http/mod.ts": 'import "../tooling/assets/paths";\nexport const later = () => import("../tooling/assets/paths");\n',
        "src/tooling/assets/paths.ts": "export const safeJoin = 1;\n",
      }),
    );

    expect(result.findings.map((finding) => finding.line)).toEqual([1, 2]);
  });

  it("allows a type-only import, which is erased before anything is bundled", () => {
    const result = checkImportBoundary(
      project({
        "src/http/mod.ts": 'import type { Paths } from "../tooling/assets/paths";\nexport type P = Paths;\n',
        "src/tooling/assets/paths.ts": "export type Paths = string;\n",
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("allows a spec to import the guarded module it covers, because a spec is not shipped", () => {
    const result = checkImportBoundary(
      project({
        "src/http/mod.ts": "export const html = 1;\n",
        "src/ui/thing.test.ts": 'import { safeJoin } from "../tooling/assets/paths";\nexport const x = safeJoin;\n',
        "src/tooling/assets/paths.ts": "export const safeJoin = 1;\n",
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("allows a `*.fixture.ts` the same import, because `files` excludes one from the tarball", () => {
    const result = checkImportBoundary(
      project({
        "src/http/mod.ts": "export const html = 1;\n",
        "src/ui/thing.fixture.ts": 'import { safeJoin } from "../tooling/assets/paths";\nexport const x = safeJoin;\n',
        "src/tooling/assets/paths.ts": "export const safeJoin = 1;\n",
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("allows a guarded module to import another one, which is the whole point of the container", () => {
    const result = checkImportBoundary(
      project({
        "src/tooling/gate/mod.ts": 'export { safeJoin } from "../assets/paths";\n',
        "src/tooling/assets/paths.ts": "export const safeJoin = 1;\n",
        "src/ui/assets/build/color.ts": 'import { safeJoin } from "../../assets/paths";\nexport const c = safeJoin;\n',
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("refuses a green verdict when the source directory holds nothing", () => {
    const result = checkImportBoundary({ ...project({}), sources: ["src"] });

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toBe("`src` matched no source — refusing to report a green import-boundary gate that scanned nothing");
  });

  it("names every source directory when none of them holds a source", () => {
    const result = checkImportBoundary({ ...project({}), sources: ["src", "lib"] });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      "`src`, `lib` matched no source — refusing to report a green import-boundary gate that scanned nothing",
    ]);
  });

  it("fails on a `sources` entry naming no directory, even beside one that finds files", () => {
    const result = checkImportBoundary({ ...project({ "src/http/mod.ts": "export const a = 1;\n" }), sources: ["src", "lib"] });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["`sources` entry `lib` names no directory under the root"]);
  });
});

describe("checkImportBoundary — a one-way slice with a named crossing", () => {
  it("reports a skeleton view importing the slice, naming the `.tsx` target", () => {
    const result = checkImportBoundary(
      app({ ...SHOWCASE, "src/views/layout.tsx": 'import { registerShowcase } from "../showcase/mod";\nexport const l = registerShowcase;\n' }),
    );

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.file).toBe("src/views/layout.tsx");
    expect(result.findings[0]?.message).toBe("import boundary crossed — `../showcase/mod` resolves to `src/showcase/mod.ts`");
  });

  it("resolves a `.tsx` target inside the slice to its file", () => {
    const result = checkImportBoundary(
      app({
        "src/showcase/views/page.tsx": "export const Page = () => 1;\n",
        "src/views/layout.tsx": 'import { Page } from "../showcase/views/page";\nexport const l = Page;\n',
      }),
    );

    expect(result.findings[0]?.message).toBe("import boundary crossed — `../showcase/views/page` resolves to `src/showcase/views/page.tsx`");
  });

  it("passes the composition root when it is named as the crossing", () => {
    const result = checkImportBoundary(
      app(
        {
          ...SHOWCASE,
          "src/views/layout.tsx": "export const Layout = () => 1;\n",
          "src/router.tsx": 'import { registerShowcase } from "./showcase/mod";\nexport const r = registerShowcase;\n',
        },
        ["src/router.tsx"],
      ),
    );

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary).toBe("1 sources outside `src/showcase` import nothing inside them, save `src/router.tsx`");
  });

  it("does not stretch a crossing to another file with the same basename", () => {
    const result = checkImportBoundary(
      app(
        {
          ...SHOWCASE,
          "src/router.tsx": "export const r = 1;\n",
          "src/admin/router.tsx": 'import { registerShowcase } from "../showcase/mod";\nexport const r = registerShowcase;\n',
        },
        ["src/router.tsx"],
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.file).toBe("src/admin/router.tsx");
  });

  it("passes the slice importing the skeleton, because the boundary runs one way", () => {
    const result = checkImportBoundary(
      app({
        "src/views/layout.tsx": "export const Layout = () => 1;\n",
        "src/showcase/views/page.tsx": 'import { Layout } from "../../views/layout";\nexport const Page = Layout;\n',
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("passes a skeleton module importing only a type from the slice", () => {
    const result = checkImportBoundary(
      app({
        "src/showcase/model/demo.ts": "export type Demo = string;\n",
        "src/views/layout.tsx": 'import type { Demo } from "../showcase/model/demo";\nexport type D = Demo;\n',
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("fails a crossing that names no scanned file, so a renamed composition root cannot leave a dead exemption", () => {
    const result = checkImportBoundary(app({ ...SHOWCASE, "src/app.tsx": "export const a = 1;\n" }, ["src/router.tsx"]));

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toBe("crossing `src/router.tsx` names no source the walk judges");
  });

  it("fails a crossing that sits inside the guarded tree, which the walk never judges", () => {
    const result = checkImportBoundary(app({ ...SHOWCASE, "src/app.tsx": "export const a = 1;\n" }, ["src/showcase/mod.ts"]));

    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toBe("crossing `src/showcase/mod.ts` names no source the walk judges");
  });

  it("names the crossings in the finding a non-crossing file raises", () => {
    const result = checkImportBoundary(
      app(
        {
          ...SHOWCASE,
          "src/router.tsx": 'import { registerShowcase } from "./showcase/mod";\nexport const r = registerShowcase;\n',
          "src/views/layout.tsx": 'import { registerShowcase } from "../showcase/mod";\nexport const l = registerShowcase;\n',
        },
        ["src/router.tsx"],
      ),
    );

    expect(result.findings.map((finding) => [finding.file, finding.detail])).toEqual([
      [
        "src/views/layout.tsx",
        [
          "nothing outside `src/showcase`, or the named crossing(s) `src/router.tsx`, may import from inside them at value",
          "move the importing module inside the guarded tree, or drop the import",
        ],
      ],
    ]);
  });

  it("passes every file named as a crossing, and lists them all in the summary", () => {
    const importer = 'import { registerShowcase } from "./showcase/mod";\nexport const r = registerShowcase;\n';
    const result = checkImportBoundary(
      app({ ...SHOWCASE, "src/router.tsx": importer, "src/worker.ts": importer }, ["src/router.tsx", "src/worker.ts"]),
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("0 sources outside `src/showcase` import nothing inside them, save `src/router.tsx`, `src/worker.ts`");
  });

  it("reports a stale crossing as a finding on no file, with the spelling a crossing needs", () => {
    const result = checkImportBoundary(app({ ...SHOWCASE, "src/app.tsx": "export const a = 1;\n" }, ["src/router.tsx"]));

    expect(result.findings).toEqual([
      {
        level: "fail",
        message: "crossing `src/router.tsx` names no source the walk judges",
        detail: [
          "a crossing must be a scanned file outside every guarded directory, spelled as the walk reports it — root-relative, with its extension",
        ],
      },
    ]);
  });

  it("does not exempt a crossing spelled with a leading `./`, and fails it as stale", () => {
    const result = checkImportBoundary(
      app({ ...SHOWCASE, "src/router.tsx": 'import { registerShowcase } from "./showcase/mod";\nexport const r = registerShowcase;\n' }, [
        "./src/router.tsx",
      ]),
    );

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => [finding.file, finding.message])).toEqual([
      ["src/router.tsx", "import boundary crossed — `./showcase/mod` resolves to `src/showcase/mod.ts`"],
      [undefined, "crossing `./src/router.tsx` names no source the walk judges"],
    ]);
  });

  it("does not exempt a crossing spelled without its extension, and fails it as stale", () => {
    const result = checkImportBoundary(
      app({ ...SHOWCASE, "src/router.tsx": 'import { registerShowcase } from "./showcase/mod";\nexport const r = registerShowcase;\n' }, [
        "src/router",
      ]),
    );

    expect(result.findings.map((finding) => [finding.file, finding.message])).toEqual([
      ["src/router.tsx", "import boundary crossed — `./showcase/mod` resolves to `src/showcase/mod.ts`"],
      [undefined, "crossing `src/router` names no source the walk judges"],
    ]);
  });

  it("does not stretch a crossing naming a directory over the files inside it", () => {
    const result = checkImportBoundary(
      app({ ...SHOWCASE, "src/views/layout.tsx": 'import { registerShowcase } from "../showcase/mod";\nexport const l = registerShowcase;\n' }, [
        "src/views",
      ]),
    );

    expect(result.findings.map((finding) => [finding.file, finding.message])).toEqual([
      ["src/views/layout.tsx", "import boundary crossed — `../showcase/mod` resolves to `src/showcase/mod.ts`"],
      [undefined, "crossing `src/views` names no source the walk judges"],
    ]);
  });

  it("fails a crossing that names a spec, which the walk never scans", () => {
    const result = checkImportBoundary(
      app({ ...SHOWCASE, "src/router.tsx": "export const r = 1;\n", "src/router.test.tsx": "export const t = 1;\n" }, ["src/router.test.tsx"]),
    );

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["crossing `src/router.test.tsx` names no source the walk judges"]);
  });
});

describe("checkImportBoundary — a guarded entry that would guard nothing", () => {
  const VIEW_IMPORTS_SHOWCASE = {
    ...SHOWCASE,
    "src/views/x.ts": 'import { registerShowcase } from "../showcase/mod";\nexport const x = registerShowcase;\n',
  };

  function guarding(guarded: readonly string[]): ImportBoundaryCheckConfig {
    return { root: gateFixtureRoot(VIEW_IMPORTS_SHOWCASE, "forge-ib-guard-"), guarded };
  }

  const SPELLING = ["a guarded directory must be root-relative, spelled as the walk reports it — no leading `./`, no trailing `/`, no `..`"];

  it("fails the outside import under the canonical spelling", () => {
    const result = checkImportBoundary(guarding(["src/showcase"]));

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => [finding.file, finding.message])).toEqual([
      ["src/views/x.ts", "import boundary crossed — `../showcase/mod` resolves to `src/showcase/mod.ts`"],
    ]);
  });

  it("passes the outside import under the canonical spelling once it is named as a crossing", () => {
    const result = checkImportBoundary({ ...guarding(["src/showcase"]), crossings: ["src/views/x.ts"] });

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("fails a guarded entry with a trailing `/`", () => {
    const result = checkImportBoundary(guarding(["src/showcase/"]));

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      { level: "fail", message: "guarded `src/showcase/` is not spelled as the walk reports it", detail: SPELLING },
    ]);
  });

  it("fails a guarded entry with a leading `./`", () => {
    const result = checkImportBoundary(guarding(["./src/showcase"]));

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      { level: "fail", message: "guarded `./src/showcase` is not spelled as the walk reports it", detail: SPELLING },
    ]);
  });

  it("fails a guarded entry holding a `..` segment", () => {
    const result = checkImportBoundary(guarding(["src/views/../showcase"]));

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["guarded `src/views/../showcase` is not spelled as the walk reports it"]);
  });

  it("fails an absolute guarded entry, even one naming the right directory", () => {
    const config = guarding([]);
    const result = checkImportBoundary({ ...config, guarded: [`${config.root}/src/showcase`] });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual([
      `guarded \`${config.root}/src/showcase\` is not spelled as the walk reports it`,
    ]);
  });

  it("fails a guarded entry naming no directory under the root", () => {
    const result = checkImportBoundary(guarding(["src/showcas"]));

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      {
        level: "fail",
        message: "guarded `src/showcas` names no directory under the root",
        detail: ["a guarded directory must exist, or the boundary it declares holds nothing"],
      },
    ]);
  });

  it("fails an empty guarded list rather than passing a boundary that guards nothing", () => {
    const result = checkImportBoundary(guarding([]));

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      {
        level: "fail",
        message: "`guarded` names no directory",
        detail: ["an import boundary that guards nothing holds nothing, so an empty list fails rather than passing"],
      },
    ]);
  });

  it("fails a guarded entry naming a file rather than a directory", () => {
    const result = checkImportBoundary(guarding(["src/showcase/mod.ts"]));

    expect(result.findings.map((finding) => finding.message)).toEqual(["guarded `src/showcase/mod.ts` names no directory under the root"]);
  });
});
