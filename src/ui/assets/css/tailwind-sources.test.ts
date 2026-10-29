import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stylesheetPath } from "../../../tooling/assets/css-declaration";

const { compile } = await import("tailwindcss");

const ROOT = realpathSync(resolve(import.meta.dir, "../../../.."));
const CSS_DIR = resolve(ROOT, "src/ui/assets/css");
const APP_DIR = realpathSync(mkdtempSync(join(tmpdir(), "forge-tailwind-sources-")));
mkdirSync(join(APP_DIR, "node_modules/@y-core"), { recursive: true });
symlinkSync(dirname(fileURLToPath(import.meta.resolve("tailwindcss/index.css"))), join(APP_DIR, "node_modules/tailwindcss"));
symlinkSync(ROOT, join(APP_DIR, "node_modules/@y-core/forge"));

afterAll(() => rmSync(APP_DIR, { recursive: true, force: true }));

const EXCLUDED = "*.{test,browser,fixture}.*";

const loadStylesheet = async (id: string, base: string): Promise<{ path: string; base: string; content: string }> => {
  const path = stylesheetPath(id, base);
  return { path, base: dirname(path), content: readFileSync(path, "utf-8") };
};

const compileApp = (css: string) => compile(css, { base: APP_DIR, loadStylesheet });

describe("tailwind.css", () => {
  it("turns automatic source detection off for the whole build", async () => {
    expect((await compileApp('@import "@y-core/forge/ui/assets/css/tailwind.css";\n')).root).toBe("none");
  });

  it("leaves an app's own @source based at the app's stylesheet", async () => {
    const { sources } = await compileApp('@import "@y-core/forge/ui/assets/css/tailwind.css";\n@source "./src";\n');
    expect(sources.filter((source) => source.base === APP_DIR)).toEqual([{ base: APP_DIR, pattern: "./src", negated: false }]);
  });
});

describe("forge.css", () => {
  it("excludes tests, browser specs and fixtures across all of src/ui", async () => {
    const { sources } = await compileApp('@import "tailwindcss" source(none);\n@import "@y-core/forge/ui/assets/css/forge.css";\n');
    expect(sources.filter((source) => source.negated)).toEqual([{ base: CSS_DIR, pattern: `../../**/${EXCLUDED}`, negated: true }]);
  });
});

for (const namespace of ["auth", "render/htmx", "logging", "app"]) {
  describe(`@y-core/forge/${namespace}/sources.css`, () => {
    const directory = resolve(ROOT, "src", namespace);
    const subpath = `@y-core/forge/${namespace}/sources.css`;

    it("resolves through the export map to the namespace's own directory", () => {
      expect(stylesheetPath(subpath, APP_DIR)).toBe(resolve(directory, "sources.css"));
    });

    it("scans its namespace directory, minus tests, browser specs and fixtures, whatever the app's base", async () => {
      const { root, sources } = await compileApp(`@import "tailwindcss" source(none);\n@import "${subpath}";\n`);
      expect({ root, sources }).toEqual({
        root: "none",
        sources: [
          { base: directory, pattern: "./", negated: false },
          { base: directory, pattern: `./**/${EXCLUDED}`, negated: true },
        ],
      });
    });
  });
}
