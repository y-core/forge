import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkPackaging, fixtureName, moduleImports } from "./packaging";
import type { ExportsMap, PackagingCheckConfig } from "./types";

/** A throwaway root holding exactly the files given, each mapped to its contents. */
function fixtureRoot(tree: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-packaging-"));
  for (const [path, contents] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents, "utf-8");
  }
  return root;
}

const EXPORTS: ExportsMap = { "./ui": { import: "./src/ui/mod.ts", types: "./src/ui/mod.ts" } };

const FILES = ["src/ui/", "!**/*.test.ts"];

const run = (tree: Record<string, string>, overrides: Partial<PackagingCheckConfig> = {}) =>
  checkPackaging({ root: fixtureRoot(tree), sources: ["src"], files: FILES, exports: EXPORTS, ...overrides });

const files = (tree: Record<string, string>, overrides: Partial<PackagingCheckConfig> = {}) =>
  run(tree, overrides).findings.map((finding) => finding.file);

describe("checkPackaging()", () => {
  it("passes a module the exports map reaches through its barrel", () => {
    expect(
      files({
        "src/ui/mod.ts": `export { button } from "./button";`,
        "src/ui/button.ts": "export const button = 1;",
        "src/ui/button.test.ts": `import { button } from "./button";`,
      }),
    ).toEqual([]);
  });

  it("reports a module only a test imports that the tarball still carries", () => {
    expect(
      files({
        "src/ui/mod.ts": "export const nothing = 1;",
        "src/ui/fixture.ts": "export const fixture = 1;",
        "src/ui/fixture.test.ts": `import { fixture } from "./fixture";`,
      }),
    ).toEqual(["src/ui/fixture.ts"]);
  });

  it("passes the same module once the `files` array excludes it", () => {
    expect(
      files(
        {
          "src/ui/mod.ts": "export const nothing = 1;",
          "src/ui/fixture.ts": "export const fixture = 1;",
          "src/ui/fixture.test.ts": `import { fixture } from "./fixture";`,
        },
        { files: [...FILES, "!src/ui/fixture.ts"] },
      ),
    ).toEqual([]);
  });

  it("counts a dynamic import as reaching a module, since a lazy panel is reached by nothing else", () => {
    expect(
      files({
        "src/ui/mod.ts": `export const load = () => import("./panel");`,
        "src/ui/panel.ts": "export const panel = 1;",
        "src/ui/panel.test.ts": `import { panel } from "./panel";`,
      }),
    ).toEqual([]);
  });

  it("counts an `entries` module as an entry, since a bin script is reachable without being an export", () => {
    expect(
      files(
        {
          "src/ui/mod.ts": "export const nothing = 1;",
          "src/ui/cli.ts": `import { work } from "./work";`,
          "src/ui/work.ts": "export const work = 1;",
          "src/ui/work.test.ts": `import { work } from "./work";`,
        },
        { entries: ["./src/ui/cli.ts"] },
      ),
    ).toEqual([]);
  });

  it("asks nothing of a module nothing imports at all — that is the exports check's subject", () => {
    expect(files({ "src/ui/mod.ts": "export const nothing = 1;", "src/ui/orphan.ts": "export const orphan = 1;" })).toEqual([]);
  });

  it("refuses to report green when it walked nothing", () => {
    const result = run({ "README.md": "" }, { sources: ["src"] });
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toContain("refusing to report a green packaging gate");
  });

  it("fails on a `sources` entry naming no directory, even beside one that finds files", () => {
    const result = run({ "src/ui/mod.ts": "export const nothing = 1;" }, { sources: ["src", "lib"] });
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.message)).toEqual(["`sources` entry `lib` names no directory under the root"]);
  });

  it("names the exclusion to add in its remedy", () => {
    const result = run({
      "src/ui/mod.ts": "export const nothing = 1;",
      "src/ui/fixture.ts": "export const fixture = 1;",
      "src/ui/fixture.test.ts": `import { fixture } from "./fixture";`,
    });
    expect(result.findings[0]?.detail).toEqual([
      "imported by: src/ui/fixture.test.ts",
      "rename it `fixture.fixture.ts` — the `files` array excludes every `*.fixture.ts` and nothing else",
    ]);
  });
});

describe("moduleImports()", () => {
  it("resolves a directory specifier to its barrel", () => {
    const root = fixtureRoot({ "src/ui/mod.ts": `import { core } from "../core";`, "src/core/mod.ts": "export const core = 1;" });
    expect(moduleImports(root, "src/ui/mod.ts", new Set(["src/ui/mod.ts", "src/core/mod.ts"]))).toEqual(["src/core/mod.ts"]);
  });

  it("drops a bare specifier, which no walked module answers", () => {
    const root = fixtureRoot({ "src/ui/mod.ts": `import * as v from "some-package";` });
    expect(moduleImports(root, "src/ui/mod.ts", new Set(["src/ui/mod.ts"]))).toEqual([]);
  });
});

describe("fixtureName()", () => {
  it("names the convention's spelling for a module, keeping a .tsx extension", () => {
    expect(fixtureName("src/ui/gallery/coverage.ts")).toBe("coverage.fixture.ts");
    expect(fixtureName("src/ui/gallery/demos.tsx")).toBe("demos.fixture.tsx");
  });
});
