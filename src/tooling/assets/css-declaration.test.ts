import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cssSourceMatches, isCssSourceCovered, readCssDeclaration, stylesheetPath } from "./css-declaration";
import type { CssSourceDeclaration } from "./types";

const TAILWIND_INDEX = fileURLToPath(import.meta.resolve("tailwindcss/index.css"));

const MARKS_ITS_OWN_RUN = 'import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./ran", import.meta.url), "");\nexport default {};\n';

const roots: string[] = [];

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const TAILWIND = dirname(TAILWIND_INDEX);

function tree(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "forge-css-declaration-")));
  roots.push(root);
  mkdirSync(join(root, "node_modules"));
  symlinkSync(TAILWIND, join(root, "node_modules/tailwindcss"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents, "utf-8");
  }
  return root;
}

describe("readCssDeclaration", () => {
  const modes = [
    ['@import "tailwindcss" source(none);', "none"],
    ['@import "tailwindcss";', "auto"],
    ['@import "tailwindcss" source("../ui");', "explicit"],
  ] as const;
  for (const [head, mode] of modes) {
    it(`reads \`${head}\` as root mode ${mode}`, async () => {
      const root = tree({ "css/app.css": `${head}\n` });

      expect((await readCssDeclaration(join(root, "css/app.css"))).root).toBe(mode);
    });
  }

  it("never reports an explicit `source(…)` root as one of the `@source` declarations", async () => {
    const root = tree({ "css/app.css": '@import "tailwindcss" source("../ui");\n@source "../lib";\n' });

    expect((await readCssDeclaration(join(root, "css/app.css"))).sources).toEqual([{ base: join(root, "css"), pattern: "../lib", negated: false }]);
  });

  it("returns every source with its base and negation, and every stylesheet loaded, the entry first", async () => {
    const root = tree({
      "css/app.css": '@import "tailwindcss" source(none);\n@import "./nested/more.css";\n@source "../ui";\n@source not "../ui/legacy";\n',
      "css/nested/more.css": '@source "../../lib/**/*.ts";\n',
    });
    const declaration = await readCssDeclaration(join(root, "css/app.css"));

    expect(declaration.sources).toEqual([
      { base: join(root, "css/nested"), pattern: "../../lib/**/*.ts", negated: false },
      { base: join(root, "css"), pattern: "../ui", negated: false },
      { base: join(root, "css"), pattern: "../ui/legacy", negated: true },
    ]);
    expect(declaration.stylesheets[0]).toBe(join(root, "css/app.css"));
    expect([...declaration.stylesheets].sort()).toEqual([join(root, "css/app.css"), join(root, "css/nested/more.css"), TAILWIND_INDEX].sort());
  });

  it("bases a source on the directory of the stylesheet two imports deep, never on the entry's or the importer's", async () => {
    const root = tree({
      "css/app.css": '@import "tailwindcss" source(none);\n@import "./a/one.css";\n',
      "css/a/one.css": '@import "./b/two.css";\n',
      "css/a/b/two.css": '@source "../../../lib";\n',
    });
    const declaration = await readCssDeclaration(join(root, "css/app.css"));

    expect(declaration.sources).toEqual([{ base: join(root, "css/a/b"), pattern: "../../../lib", negated: false }]);
    expect([...declaration.stylesheets].sort()).toEqual(
      [join(root, "css/app.css"), join(root, "css/a/one.css"), join(root, "css/a/b/two.css"), TAILWIND_INDEX].sort(),
    );
  });

  it("reads no source from an `@source inline(…)` safelist", async () => {
    const root = tree({ "css/app.css": '@import "tailwindcss" source(none);\n@source inline("flex");\n' });

    expect((await readCssDeclaration(join(root, "css/app.css"))).sources).toEqual([]);
  });

  for (const directive of ["@plugin", "@config"]) {
    it(`rejects a stylesheet with \`${directive}\`, naming the module and never running it`, async () => {
      const root = tree({ "css/app.css": `@import "tailwindcss" source(none);\n${directive} "./extra.js";\n`, "css/extra.js": MARKS_ITS_OWN_RUN });

      await expect(readCssDeclaration(join(root, "css/app.css"))).rejects.toThrow(
        "`./extra.js` was loaded as a module: a `@source` declaration is read without running `@plugin` or `@config`.",
      );
      expect(existsSync(join(root, "css/ran"))).toBe(false);
    });
  }

  it("rejects a stylesheet importing one that is not on disk, naming the missing path", async () => {
    const root = tree({ "css/app.css": '@import "tailwindcss" source(none);\n@import "./missing.css";\n' });

    await expect(readCssDeclaration(join(root, "css/app.css"))).rejects.toMatchObject({ code: "ENOENT", path: join(root, "css/missing.css") });
  });
});

describe("readCssDeclaration — a package `@import`", () => {
  const HEAD = '@import "tailwindcss" source(none);\n';

  it("resolves a package from the importing stylesheet's own node_modules, by its `style` export", async () => {
    const root = tree({
      "css/app.css": `${HEAD}@import "acme";\n`,
      "node_modules/acme/package.json": JSON.stringify({ exports: { ".": { import: "./lib.mjs", style: "./dist/acme.css" } } }),
      "node_modules/acme/dist/acme.css": '@source "../src";\n',
    });
    const declaration = await readCssDeclaration(join(root, "css/app.css"));

    expect(declaration.stylesheets).toContain(join(root, "node_modules/acme/dist/acme.css"));
    expect(declaration.sources).toEqual([{ base: join(root, "node_modules/acme/dist"), pattern: "../src", negated: false }]);
  });

  it("resolves a subpath through a `*` pattern in the package's exports", async () => {
    const root = tree({
      "css/app.css": `${HEAD}@import "@scope/kit/css/theme.css";\n`,
      "node_modules/@scope/kit/package.json": JSON.stringify({ exports: { "./css/*.css": "./src/css/*.css" } }),
      "node_modules/@scope/kit/src/css/theme.css": "@theme { --color-x: red; }\n",
    });

    expect((await readCssDeclaration(join(root, "css/app.css"))).stylesheets).toContain(join(root, "node_modules/@scope/kit/src/css/theme.css"));
  });

  it("falls back to the `style` field of a package with no exports", async () => {
    const root = tree({
      "css/app.css": `${HEAD}@import "plain";\n`,
      "node_modules/plain/package.json": JSON.stringify({ style: "plain.css" }),
      "node_modules/plain/plain.css": "@theme { --color-y: blue; }\n",
    });

    expect((await readCssDeclaration(join(root, "css/app.css"))).stylesheets).toContain(join(root, "node_modules/plain/plain.css"));
  });

  it("rejects a package the importing stylesheet cannot reach", async () => {
    const root = tree({ "css/app.css": `${HEAD}@import "absent/x.css";\n` });

    await expect(readCssDeclaration(join(root, "css/app.css"))).rejects.toThrow('`@import "absent/x.css"` resolves to no stylesheet');
  });
});

describe("cssSourceMatches", () => {
  const source = (pattern: string, base = "/app/css"): CssSourceDeclaration => ({ base, pattern, negated: false });

  const cases = [
    { name: "a file deep beneath a directory source", source: source("../ui"), path: "/app/ui/deep/card.tsx", expected: true },
    { name: "the directory a directory source names", source: source("../ui"), path: "/app/ui", expected: true },
    { name: "a sibling sharing a directory source's prefix", source: source("../ui"), path: "/app/ui-kit/card.tsx", expected: false },
    { name: "the parent of a directory source", source: source("../ui"), path: "/app/card.tsx", expected: false },
    { name: "the one file a bare file source names", source: source("../ui/card.tsx"), path: "/app/ui/card.tsx", expected: true },
    { name: "a sibling of a bare file source", source: source("../ui/card.tsx"), path: "/app/ui/list.tsx", expected: false },
    { name: "a `**` glob's match at any depth", source: source("../lib/**/*.ts"), path: "/app/lib/a/b.ts", expected: true },
    { name: "a `**` glob's extension mismatch", source: source("../lib/**/*.ts"), path: "/app/lib/a/b.tsx", expected: false },
    { name: "a `*` glob's match in its own directory", source: source("../ui/*.tsx"), path: "/app/ui/card.tsx", expected: true },
    { name: "a `*` glob's non-match one directory down", source: source("../ui/*.tsx"), path: "/app/ui/deep/card.tsx", expected: false },
    { name: "a brace glob's second alternative", source: source("../ui/*.{ts,tsx}"), path: "/app/ui/card.tsx", expected: true },
    {
      name: "a source resolved from a nested stylesheet's own base",
      source: source("../../lib", "/app/css/nested"),
      path: "/app/lib/x.ts",
      expected: true,
    },
    {
      name: "the same pattern from that base, missing the entry-relative path",
      source: source("../../lib", "/app/css/nested"),
      path: "/lib/x.ts",
      expected: false,
    },
  ];
  for (const { name, source: declared, path, expected } of cases) {
    it(`${expected ? "matches" : "does not match"} ${name}`, () => {
      expect(cssSourceMatches(declared, path)).toBe(expected);
    });
  }
});

describe("isCssSourceCovered", () => {
  const ui: CssSourceDeclaration = { base: "/app/css", pattern: "../ui", negated: false };
  const notLegacy: CssSourceDeclaration = { base: "/app/css", pattern: "../ui/legacy", negated: true };
  const legacyGlob: CssSourceDeclaration = { base: "/app/css", pattern: "../ui/legacy/**/*.tsx", negated: false };
  const notStories: CssSourceDeclaration = { base: "/app/css", pattern: "../ui/**/*.stories.tsx", negated: true };

  const cases = [
    { name: "covers a file a source names and no `@source not` excludes", sources: [ui, notLegacy], path: "/app/ui/card.tsx", expected: true },
    { name: "honours `@source not`", sources: [ui, notLegacy], path: "/app/ui/legacy/card.tsx", expected: false },
    {
      name: "lets `@source not` win when it is declared before the source",
      sources: [notLegacy, ui],
      path: "/app/ui/legacy/card.tsx",
      expected: false,
    },
    {
      name: "lets `@source not` win over a second, narrower source",
      sources: [ui, legacyGlob, notLegacy],
      path: "/app/ui/legacy/card.tsx",
      expected: false,
    },
    { name: "excludes by a negated glob and only by its match", sources: [ui, notStories], path: "/app/ui/card.stories.tsx", expected: false },
    { name: "keeps a file a negated glob does not match", sources: [ui, notStories], path: "/app/ui/card.tsx", expected: true },
    { name: "covers nothing with only a `@source not`", sources: [notLegacy], path: "/app/ui/card.tsx", expected: false },
    { name: "covers nothing outside every source", sources: [ui, notLegacy], path: "/app/lib/card.tsx", expected: false },
    { name: "covers nothing with no source declared", sources: [], path: "/app/ui/card.tsx", expected: false },
  ];
  for (const { name, sources, path, expected } of cases) {
    it(name, () => {
      expect(isCssSourceCovered(sources, path)).toBe(expected);
    });
  }
});

describe("stylesheetPath", () => {
  it("resolves a scoped package id through the importing stylesheet's node_modules", () => {
    const root = tree({ "node_modules/@acme/kit/package.json": '{ "style": "kit.css" }', "node_modules/@acme/kit/kit.css": "" });

    expect(stylesheetPath("@acme/kit", join(root, "css"))).toBe(join(root, "node_modules/@acme/kit/kit.css"));
  });

  it("resolves an unscoped package id to its real path", () => {
    expect(stylesheetPath("tailwindcss", tree({}))).toBe(realpathSync(TAILWIND_INDEX));
  });

  for (const id of ["./tokens.css", "../tokens.css", "/tmp/tokens.css"]) {
    it(`resolves \`${id}\` as a path from the importing stylesheet's directory`, () => {
      expect(stylesheetPath(id, "/srv/app/css")).toBe(resolve("/srv/app/css", id));
    });
  }
});
