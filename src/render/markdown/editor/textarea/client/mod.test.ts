import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { importClosure } from "../../../../../tooling/assets/closure";
import { parseImports } from "../../../../../tooling/gate/checks/namespace-graph-parse";

const ROOT = new URL("../../../../../../", import.meta.url).pathname;

const TEXTAREA_ENTRY = "./src/render/markdown/editor/textarea/client/mod.ts";

function codemirrorSpecifiers(files: readonly string[]): string[] {
  return files.flatMap((file) =>
    parseImports(readFileSync(join(ROOT, file), "utf-8"))
      .map(({ specifier }) => specifier)
      .filter((specifier) => specifier.startsWith("@codemirror/")),
  );
}

describe("render/markdown/editor/textarea/client import closure", () => {
  it("resolves no @codemirror/* module", async () => {
    expect(codemirrorSpecifiers(await importClosure(ROOT, [TEXTAREA_ENTRY]))).toEqual([]);
  });

  it("reaches nothing in the viewport namespace", async () => {
    const closure = await importClosure(ROOT, [TEXTAREA_ENTRY]);
    expect(closure.filter((file) => file.startsWith("src/render/markdown/editor/client/"))).toEqual([]);
  });

  it("reaches the editing core and the DOM helpers", async () => {
    const closure = await importClosure(ROOT, [TEXTAREA_ENTRY]);
    expect(closure).toContain("src/render/markdown/editing.ts");
    expect(closure).toContain("src/ui/client/dom.ts");
  });

  it("finds @codemirror/* imports in the viewport's closure", async () => {
    const closure = await importClosure(ROOT, ["./src/render/markdown/editor/client/mod.ts"]);
    expect(codemirrorSpecifiers(closure).length).toBeGreaterThan(0);
  });
});
