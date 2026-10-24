import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { fileURLToPathish, isBareSpecifier } from "../../../tooling/gate/checks/design-system";

const { compile } = await import("tailwindcss");

const ROOT = resolve(import.meta.dir, "../../../..");
const CSS_DIR = resolve(ROOT, "src/ui/assets/css");
const APP_DIR = "/srv/consumer-app";

const EXCLUDED = "*.{test,browser,fixture}.*";

const resolvePackage = (id: string): string => fileURLToPathish(import.meta.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : id));

const loadStylesheet = async (id: string, base: string): Promise<{ path: string; base: string; content: string }> => {
  const path = isBareSpecifier(id) ? resolvePackage(id) : resolve(base, id);
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
      expect(resolvePackage(subpath)).toBe(resolve(directory, "sources.css"));
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
