import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { canonical, fileURLToPathish, hasTailwind, loadDesignSystem } from "./design-system";

/** A throwaway root holding each `name: contents` pair, and the absolute path of `entry` within it. */
function stylesheet(files: Record<string, string>, entry: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), "forge-design-system-"));
  for (const [name, contents] of Object.entries(files)) writeFileSync(resolve(dir, name), contents, "utf-8");
  return resolve(dir, entry);
}

describe("hasTailwind()", () => {
  it("finds the optional peer this repository installs", () => {
    expect(hasTailwind()).toBe(true);
  });
});

describe("fileURLToPathish()", () => {
  it("takes the path out of a file URL", () => {
    expect(fileURLToPathish("file:///tmp/node_modules/tailwindcss/index.css")).toBe("/tmp/node_modules/tailwindcss/index.css");
  });

  it("leaves a plain absolute path alone", () => {
    expect(fileURLToPathish("/tmp/node_modules/tailwindcss/index.css")).toBe("/tmp/node_modules/tailwindcss/index.css");
  });

  it("leaves a path that merely contains the scheme alone, matching on the prefix only", () => {
    expect(fileURLToPathish("/tmp/file://weird/index.css")).toBe("/tmp/file://weird/index.css");
  });

  it("returns a percent-encoded path for a URL whose directory holds a space", () => {
    expect(fileURLToPathish("file:///tmp/my dir/index.css")).toBe("/tmp/my%20dir/index.css");
  });
});

describe("canonical()", () => {
  it("strips the layout a formatter chose, keeping the content", () => {
    expect(canonical("export const A = [\n  1,\n  2,\n];\n")).toBe("exportconstA=[1,2];");
  });

  it("drops the trailing comma before a closing bracket or brace, which is layout too", () => {
    expect(canonical("{ a: [1,], b: 2, }")).toBe("{a:[1],b:2}");
  });

  it("leaves a source with neither to strip untouched", () => {
    expect(canonical("exportconstA=[1,2];")).toBe("exportconstA=[1,2];");
  });
});

describe("loadDesignSystem()", () => {
  it.skipIf(!hasTailwind())("compiles a stylesheet importing tailwindcss into the theme it declares", async () => {
    const entry = stylesheet({ "entry.css": '@import "tailwindcss";\n@theme {\n  --color-brand: #123456;\n}\n' }, "entry.css");

    const ds = await loadDesignSystem(entry);

    expect([...ds.theme.entries()].find(([key]) => key === "--color-brand")?.[1].value).toBe("#123456");
    expect(ds.candidatesToCss(["text-brand"])[0]).toBe(".text-brand {\n  color: var(--color-brand);\n}\n");
  });

  it.skipIf(!hasTailwind())("resolves a relative @import against the importing file's own directory", async () => {
    const entry = stylesheet(
      { "entry.css": '@import "tailwindcss";\n@import "./tokens.css";\n', "tokens.css": "@theme {\n  --color-brand: #123456;\n}\n" },
      "entry.css",
    );

    const ds = await loadDesignSystem(entry);

    expect(ds.candidatesToCss(["text-brand"])[0]).toBe(".text-brand {\n  color: var(--color-brand);\n}\n");
  });

  it.skipIf(!hasTailwind())("returns null for a candidate the compiled system produces no CSS for", async () => {
    const entry = stylesheet({ "entry.css": '@import "tailwindcss";\n' }, "entry.css");

    const ds = await loadDesignSystem(entry);

    expect(ds.candidatesToCss(["text-brand"])).toEqual([null]);
  });

  it.skipIf(!hasTailwind())("parses a candidate into the utility root and value the AST is built from", async () => {
    const entry = stylesheet({ "entry.css": '@import "tailwindcss";\n' }, "entry.css");

    const ds = await loadDesignSystem(entry);

    expect([...ds.parseCandidate("flex")].map((parsed) => ({ kind: parsed.kind, root: parsed.root }))).toEqual([
      { kind: "static", root: "flex" },
      { kind: "functional", root: "flex" },
    ]);
    expect(ds.candidatesToAst(["flex"])[0]).toEqual([
      { kind: "rule", selector: ".flex", nodes: [{ kind: "declaration", property: "display", value: "flex", important: false }] },
    ]);
  });

  it.skipIf(!hasTailwind())("throws rather than stubbing when the stylesheet loads a plugin", async () => {
    const entry = stylesheet({ "entry.css": '@import "tailwindcss";\n@plugin "./thing.js";\n' }, "entry.css");

    expect(loadDesignSystem(entry)).rejects.toThrow(
      "`./thing.js` was loaded as a module: this design system is expected to use no `@plugin` or `@config`.",
    );
  });

  it.skipIf(!hasTailwind())("throws when the entry stylesheet does not exist, rather than compiling an empty system", async () => {
    expect(loadDesignSystem(resolve(tmpdir(), "forge-design-system-absent", "entry.css"))).rejects.toThrow("ENOENT");
  });
});
