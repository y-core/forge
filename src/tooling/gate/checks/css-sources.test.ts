import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { fail } from "../finding";
import { checkCssSources } from "./css-sources";
import type { CssSourcesCheckConfig } from "./types";

const CLASSES = 'export const cls = "flex gap-2";\n';

const SCAN_ALL = '@source "../ui";\n';

const roots: string[] = [];

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway root holding each `path: contents` pair, directories created as needed. */
function root(tree: Record<string, string>): string {
  const dir = mkdtempSync(resolve(tmpdir(), "forge-css-sources-"));
  roots.push(dir);
  for (const [path, contents] of Object.entries(tree)) {
    const abs = resolve(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, "utf-8");
  }
  return dir;
}

function config(tree: Record<string, string>, extra: Partial<CssSourcesCheckConfig> = {}): CssSourcesCheckConfig {
  return { root: root(tree), uiDir: "src/ui", cssDir: "src/css", sourceDir: "src", readme: "README.md", packageName: "pkg", exports: {}, ...extra };
}

function messages(tree: Record<string, string>, extra: Partial<CssSourcesCheckConfig> = {}): string[] {
  return checkCssSources(config(tree, extra)).findings.map((finding) => finding.message);
}

const AGGREGATE = "Every utility class the library emits must be textually visible to a consumer's Tailwind scan.";

describe("checkCssSources() — the passing tree", () => {
  it("passes a directory the stylesheet scans, and counts what it covered", () => {
    const result = checkCssSources(config({ "src/css/tailwind.css": SCAN_ALL, "src/ui/core/button.ts": CLASSES, "README.md": "# forge\n" }));

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("1 src/ui directories are @source-scanned or registered, and no class string hides behind one.");
  });

  it("refuses a component root holding no directory at all, rather than reporting a green vacuous scan", () => {
    const result = checkCssSources(config({ "src/css/tailwind.css": SCAN_ALL, "README.md": "# forge\n" }));

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([fail("`src/ui` holds no directory — refusing to report a green css-sources gate that scanned nothing")]);
    expect(result.summary).toBe("");
  });
});

describe("checkCssSources() — pass A, where an @source path points", () => {
  it("rejects a path resolving outside the component root", () => {
    const tree = { "src/css/tailwind.css": `@source "../../outside";\n${SCAN_ALL}`, "src/ui/core/button.ts": CLASSES };

    expect(messages(tree)).toEqual([`@source "../../outside" resolves outside src/ui/ (outside)`, AGGREGATE]);
  });

  it("blames the stylesheet that declared it, and says what an outside namespace does instead", () => {
    // `src/ui/core` is present so the walk is non-empty: without it the check refuses for vacuity
    // and never reaches the `@source` finding this case is about.
    const result = checkCssSources(config({ "src/css/tailwind.css": '@source "../../outside";\n', "src/ui/core/button.ts": CLASSES }));

    expect(result.findings[0]).toEqual({
      level: "fail",
      message: `@source "../../outside" resolves outside src/ui/ (outside)`,
      file: "src/css/tailwind.css",
      detail: [
        "The stylesheet scans src/ui/ and nothing else. A namespace outside it ships its own",
        "`sources.css` for the consuming app to import instead.",
      ],
    });
  });

  it("ignores an @source not exclusion, which narrows a scan rather than declaring one", () => {
    const tree = { "src/css/tailwind.css": `${SCAN_ALL}@source not "../ui/**/*.test.ts";\n`, "src/ui/core/button.ts": CLASSES };

    expect(messages(tree)).toEqual([]);
  });
});

describe("checkCssSources() — pass B, whether a directory is registered", () => {
  it("rejects a directory no @source path covers and no registry names", () => {
    const tree = {
      "src/css/tailwind.css": '@source "../ui/core";\n',
      "src/ui/core/button.ts": CLASSES,
      "src/ui/widgets/panel.ts": "export const x = 1;\n",
    };

    expect(messages(tree)).toEqual(["no @source path in src/css/ covers it, and it is registered nowhere", AGGREGATE]);
  });

  it("names the directory and the three ways to register it", () => {
    const tree = {
      "src/css/tailwind.css": '@source "../ui/core";\n',
      "src/ui/core/button.ts": CLASSES,
      "src/ui/widgets/panel.ts": "export const x = 1;\n",
    };

    expect(checkCssSources(config(tree)).findings[0]).toEqual({
      level: "fail",
      message: "no @source path in src/css/ covers it, and it is registered nowhere",
      file: "src/ui/widgets",
      detail: [
        'Add `@source "../../widgets";` to the stylesheet if its files declare utility classes and every app needs them,',
        "or register it class-free with the reason it declares none,",
        "or register it consumer-scanned if it is an opt-in surface the app scans itself.",
      ],
    });
  });

  it("rejects an opt-in directory whose README does not publish the line an app must add", () => {
    const tree = {
      "src/css/tailwind.css": '@source "../ui/core";\n',
      "src/ui/core/button.ts": CLASSES,
      "src/ui/gallery/demo.ts": CLASSES,
      "README.md": "# forge\n",
    };
    const consumerScanned = new Map([["gallery", '@source "../node_modules/@y-core/forge/src/ui/gallery";']]);

    expect(messages(tree, { consumerScanned })).toEqual(["is opt-in, but README.md does not publish the line an app must add", AGGREGATE]);
  });

  it("accepts the same directory once the README carries that line verbatim", () => {
    const line = '@source "../node_modules/@y-core/forge/src/ui/gallery";';
    const tree = {
      "src/css/tailwind.css": '@source "../ui/core";\n',
      "src/ui/core/button.ts": CLASSES,
      "src/ui/gallery/demo.ts": CLASSES,
      "README.md": `Add ${line} to your stylesheet.\n`,
    };

    expect(messages(tree, { consumerScanned: new Map([["gallery", line]]) })).toEqual([]);
  });

  it("rejects a class-free registration for a directory that is not on disk", () => {
    const tree = { "src/css/tailwind.css": SCAN_ALL, "src/ui/core/button.ts": CLASSES };

    expect(messages(tree, { classFree: new Map([["ghost", "it ships no markup"]]) })).toEqual([
      "registered class-free, but does not exist on disk",
      AGGREGATE,
    ]);
  });

  it("re-checks a class-free claim against the files it covers, naming the tokens that broke it", () => {
    const tree = { "src/css/tailwind.css": '@source "../ui/core";\n', "src/ui/core/button.ts": CLASSES, "src/ui/assets/tokens.ts": CLASSES };

    expect(checkCssSources(config(tree, { classFree: new Map([["assets", "it ships stylesheets, not markup"]]) })).findings[0]).toEqual({
      level: "fail",
      message: "string literal declares utility classes — flex gap-2",
      file: "src/ui/assets/tokens.ts",
      detail: [
        "in: flex gap-2",
        "Either move the declaration into an @source-scanned directory, or drop this",
        "directory from the class-free registry and give it an @source path.",
      ],
    });
  });

  it("leaves a class-free directory's specs alone, whose class strings are fragments of asserted markup", () => {
    const tree = { "src/css/tailwind.css": '@source "../ui/core";\n', "src/ui/core/button.ts": CLASSES, "src/ui/assets/tokens.test.ts": CLASSES };

    expect(messages(tree, { classFree: new Map([["assets", "it ships stylesheets, not markup"]]) })).toEqual([]);
  });

  it("scans a class-free directory's deployable module and skips the `.fixture.tsx` beside it", () => {
    const tree = {
      "src/css/tailwind.css": '@source "../ui/core";\n',
      "src/ui/core/button.ts": CLASSES,
      "src/ui/assets/tokens.ts": CLASSES,
      "src/ui/assets/tokens.fixture.tsx": CLASSES,
    };

    expect(messages(tree, { classFree: new Map([["assets", "it ships stylesheets, not markup"]]) })).toEqual([
      "string literal declares utility classes — flex gap-2",
      AGGREGATE,
    ]);
  });

  it("checks a file sitting loose at the component root, which no subdirectory registration covers", () => {
    const tree = { "src/css/tailwind.css": '@source "../ui/core";\n', "src/ui/core/button.ts": CLASSES, "src/ui/mod.ts": CLASSES };

    expect(messages(tree)).toEqual(["string literal declares utility classes — flex gap-2", AGGREGATE]);
  });
});

const BASE = { "src/css/tailwind.css": SCAN_ALL, "src/ui/core/button.ts": CLASSES, "README.md": "# forge\n" };

const SHIPPED_NS = {
  ...BASE,
  "src/ns/mod.ts": "export {};\n",
  "src/ns/card.tsx": CLASSES,
  "src/ns/sources.css": '@source "./";\n',
  "src/ns/README.md": 'Add @import "pkg/ns/sources.css"; to your stylesheet.\n',
};

const NS_EXPORTS = { "./ns/sources.css": "./src/ns/sources.css" };

function findings(tree: Record<string, string>, extra: Partial<CssSourcesCheckConfig> = {}) {
  return checkCssSources(config(tree, extra)).findings;
}

describe("checkCssSources() — pass C, whether a namespace outside the component root ships its classes", () => {
  it("passes a namespace whose sources.css covers it, is exported, and is published in its README", () => {
    const result = checkCssSources(config(SHIPPED_NS, { exports: NS_EXPORTS }));

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("accepts an exports entry in object form whose import condition names the sources.css", () => {
    expect(findings(SHIPPED_NS, { exports: { "./ns/sources.css": { import: "./src/ns/sources.css" } } })).toEqual([]);
  });

  it("blames the nearest barrel directory when no sources.css sits above a class-declaring file, listing the file", () => {
    const tree = { ...BASE, "src/ns/mod.ts": "export {};\n", "src/ns/parts/card.tsx": CLASSES };

    expect(findings(tree)).toEqual([
      {
        level: "fail",
        message: "renders utility classes, but no sources.css above it ships them to the consuming app",
        file: "src/ns",
        detail: [
          "src/ns/parts/card.tsx",
          'Ship src/ns/sources.css with `@source "./";`, export it from package.json,',
          "and put its `@import` line in src/ns/README.md.",
        ],
      },
      fail(AGGREGATE),
    ]);
  });

  it("blames the file's own directory when no barrel sits above it either", () => {
    const tree = { ...BASE, "src/loose/parts/card.tsx": CLASSES };

    expect(findings(tree)[0]).toEqual({
      level: "fail",
      message: "renders utility classes, but no sources.css above it ships them to the consuming app",
      file: "src/loose/parts",
      detail: [
        "src/loose/parts/card.tsx",
        'Ship src/loose/parts/sources.css with `@source "./";`, export it from package.json,',
        "and put its `@import` line in src/loose/parts/README.md.",
      ],
    });
  });

  it("never takes a sources.css or barrel at the source root itself as a namespace's", () => {
    const tree = { ...BASE, "src/sources.css": '@source "./";\n', "src/mod.ts": "export {};\n", "src/loose/card.tsx": CLASSES };

    expect(findings(tree)[0]?.file).toBe("src/loose");
  });

  it("ignores a class string in a spec, which a consuming app never scans", () => {
    expect(findings({ ...BASE, "src/ns/mod.ts": "export {};\n", "src/ns/card.test.tsx": CLASSES })).toEqual([]);
  });

  it("raises nothing for a namespace that declares no utility classes and ships no sources.css", () => {
    expect(findings({ ...BASE, "src/plain/mod.ts": 'export const label = "Save changes";\n' })).toEqual([]);
  });

  it("rejects a sources.css whose @source paths miss a class-declaring file, listing only the missed one", () => {
    const tree = { ...SHIPPED_NS, "src/ns/other/panel.tsx": CLASSES, "src/ns/sources.css": '@source "./other";\n' };

    expect(findings(tree, { exports: NS_EXPORTS })).toEqual([
      {
        level: "fail",
        message: "its sources.css does not cover every class-declaring file under it",
        file: "src/ns",
        detail: ["src/ns/card.tsx", "Add an @source path to src/ns/sources.css that reaches them."],
      },
      fail(AGGREGATE),
    ]);
  });

  it("does not count an @source not exclusion as cover", () => {
    const tree = { ...SHIPPED_NS, "src/ns/sources.css": '@source not "./";\n' };

    expect(findings(tree, { exports: NS_EXPORTS }).map((finding) => finding.message)).toEqual([
      "its sources.css does not cover every class-declaring file under it",
      AGGREGATE,
    ]);
  });

  it("rejects a sources.css package.json does not export", () => {
    expect(findings(SHIPPED_NS)).toEqual([
      {
        level: "fail",
        message: 'its sources.css is not exported as "./ns/sources.css"',
        file: "src/ns",
        detail: ['Map "./ns/sources.css" to "./src/ns/sources.css" in package.json exports.'],
      },
      fail(AGGREGATE),
    ]);
  });

  it("rejects an export of the subpath that points at another file, in string or object form", () => {
    const cases: CssSourcesCheckConfig["exports"][] = [
      { "./ns/sources.css": "./src/other/sources.css" },
      { "./ns/sources.css": { import: "./src/other/sources.css", types: "./src/ns/sources.css" } },
    ];

    for (const exports of cases) {
      expect(findings(SHIPPED_NS, { exports }).map((finding) => finding.message)).toEqual([
        'its sources.css is not exported as "./ns/sources.css"',
        AGGREGATE,
      ]);
    }
  });

  it("rejects a README that does not carry the @import line verbatim", () => {
    expect(findings({ ...SHIPPED_NS, "src/ns/README.md": "# ns\n" }, { exports: NS_EXPORTS })).toEqual([
      {
        level: "fail",
        message: "its README.md does not publish the line that imports its sources.css",
        file: "src/ns",
        detail: ['Expected verbatim: @import "pkg/ns/sources.css"'],
      },
      fail(AGGREGATE),
    ]);
  });

  it("rejects a namespace that ships a sources.css but no README at all", () => {
    const { "src/ns/README.md": _readme, ...tree } = SHIPPED_NS;

    expect(findings(tree, { exports: NS_EXPORTS }).map((finding) => finding.message)).toEqual([
      "its README.md does not publish the line that imports its sources.css",
      AGGREGATE,
    ]);
  });

  it("names the package in the expected @import line", () => {
    const tree = { ...SHIPPED_NS, "src/ns/README.md": '@import "@scope/lib/ns/sources.css";\n' };

    expect(findings(tree, { exports: NS_EXPORTS, packageName: "@scope/lib" })).toEqual([]);
    expect(findings(tree, { exports: NS_EXPORTS })[0]?.detail).toEqual(['Expected verbatim: @import "pkg/ns/sources.css"']);
  });

  it("lets a nested barrel be covered by the sources.css of the namespace above it", () => {
    const tree = { ...SHIPPED_NS, "src/ns/web/mod.ts": "export {};\n", "src/ns/web/widget.tsx": CLASSES };

    expect(findings(tree, { exports: NS_EXPORTS })).toEqual([]);
  });

  it("checks a nested renderer's own subpath and its own README", () => {
    const tree = {
      ...BASE,
      "src/family/one/mod.ts": "export {};\n",
      "src/family/one/render.ts": CLASSES,
      "src/family/one/sources.css": '@source "./";\n',
      "src/family/one/README.md": '@import "pkg/family/one/sources.css";\n',
    };

    expect(findings(tree, { exports: { "./family/one/sources.css": "./src/family/one/sources.css" } })).toEqual([]);
  });

  it("does not accept a nested renderer's @import line published only in its parent's README", () => {
    const tree = {
      ...BASE,
      "src/family/README.md": '@import "pkg/family/one/sources.css";\n',
      "src/family/one/mod.ts": "export {};\n",
      "src/family/one/render.ts": CLASSES,
      "src/family/one/sources.css": '@source "./";\n',
    };

    expect(findings(tree, { exports: { "./family/one/sources.css": "./src/family/one/sources.css" } })).toEqual([
      {
        level: "fail",
        message: "its README.md does not publish the line that imports its sources.css",
        file: "src/family/one",
        detail: ['Expected verbatim: @import "pkg/family/one/sources.css"'],
      },
      fail(AGGREGATE),
    ]);
  });

  it("blames a nested renderer's own barrel, not its family, when neither ships a sources.css", () => {
    const tree = { ...BASE, "src/family/one/mod.ts": "export {};\n", "src/family/one/render.ts": CLASSES };

    expect(findings(tree).map((finding) => finding.file)).toEqual(["src/family/one", undefined]);
  });
});
