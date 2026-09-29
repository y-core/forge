import { describe, expect, it } from "bun:test";

import { buildGraph, findEnumerations, namespaceOf, parseImports, resolveSpecifier } from "./namespace-graph-parse";
import type { EdgeKind, SourceFile } from "./types";

function sites(source: string): [string, EdgeKind][] {
  return parseImports(source).map((ref) => [ref.specifier, ref.kind]);
}

function kindOf(statement: string): [string, EdgeKind] {
  const refs = parseImports(statement);
  const only = refs.length === 1 ? refs[0] : undefined;
  return [statement, only === undefined ? (`expected exactly one site, got ${refs.length}` as EdgeKind) : only.kind];
}

function edges(files: readonly SourceFile[], dirs: readonly string[]) {
  const rows: { from: string; to: string; kind: EdgeKind; file: string; line: number }[] = [];
  for (const [from, targets] of buildGraph(files, dirs)) {
    for (const [to, edge] of targets) rows.push({ from, to, kind: edge.kind, file: edge.file, line: edge.line });
  }
  return rows;
}

describe("parseImports() — kind classification (the leaf/integration ruling)", () => {
  it("calls a site type-only exactly when every binding at it is erased at emit", () => {
    const cases = [
      'import { a } from "./x";',
      'import type { A } from "./x";',
      'import type A from "./x";',
      'import { type A, type B } from "./x";',
      'import { type A, B } from "./x";',
      'import D, { type E } from "./x";',
    ];

    expect(cases.map(kindOf)).toEqual([
      ['import { a } from "./x";', "value"],
      ['import type { A } from "./x";', "type"],
      ['import type A from "./x";', "type"],
      ['import { type A, type B } from "./x";', "type"],
      ['import { type A, B } from "./x";', "value"],
      ['import D, { type E } from "./x";', "value"],
    ]);
  });

  it("calls every re-export form a value edge, since a barrel that forwards a symbol depends on it", () => {
    const cases = ['export { a } from "./x";', 'export * from "./x";', 'export * as ns from "./x";'];

    expect(cases.map(kindOf)).toEqual([
      ['export { a } from "./x";', "value"],
      ['export * from "./x";', "value"],
      ['export * as ns from "./x";', "value"],
    ]);
  });

  it("calls a dynamic import a value edge whichever quote it uses, since the module loads at runtime", () => {
    const cases = ['const m = await import("./x");', "const m = await import(`./x`);"];

    expect(cases.map(kindOf)).toEqual([
      ['const m = await import("./x");', "value"],
      ["const m = await import(`./x`);", "value"],
    ]);
  });

  it("calls a bare side-effect import a value edge", () => {
    expect(kindOf('import "./x";')).toEqual(['import "./x";', "value"]);
  });
});

describe("parseImports() — the three settled rulings (readers who will disagree with them)", () => {
  it("classifies `export type { A }` as a type edge, because it is erased exactly like `import type`", () => {
    expect(kindOf('export type { A } from "./x";')).toEqual(['export type { A } from "./x";', "type"]);
  });

  it("reports the line of the specifier, not the line of the `import` keyword", () => {
    const source = ["import {", "  type A,", '} from "./m";'].join("\n");

    expect(parseImports(source)).toEqual([{ line: 3, specifier: "./m", kind: "type" }]);
  });

  it("classifies `{ type as t }` as a value edge, because it binds a value literally named `type`", () => {
    expect(kindOf('import { type as t } from "./x";')).toEqual(['import { type as t } from "./x";', "value"]);
  });
});

describe("parseImports() — the shapes that must produce no edge (declared leaves)", () => {
  it("ignores an import written inside a line comment", () => {
    expect(parseImports('// import { a } from "./x";')).toEqual([]);
  });

  it("ignores an import written inside a block comment, which is how TSDoc shows an example", () => {
    expect(parseImports('/* import { a } from "./x"; */')).toEqual([]);
  });

  it("ignores an import written inside a template literal", () => {
    const source = ["const snippet = `", "import { a } from './x';", "`;"].join("\n");

    expect(parseImports(source)).toEqual([]);
  });

  it("ignores an import written inside an ordinary string, which is how a fixture holds one", () => {
    expect(parseImports("const snippet = \"import { a } from './x';\";")).toEqual([]);
  });

  it("ignores `import.meta`, which names no module", () => {
    expect(parseImports("const here = import.meta.url;")).toEqual([]);
  });
});

describe("parseImports() — the scanner must not go blind (the drift gate itself)", () => {
  it("still finds a real import below a regex literal whose character class holds a quote", () => {
    const source = [`const re = /["']/g;`, 'import { a } from "./x";'].join("\n");

    expect(parseImports(source)).toEqual([{ line: 2, specifier: "./x", kind: "value" }]);
  });

  it("finds both of two adjacent imports written without semicolons", () => {
    const source = ['import { a } from "./x"', 'import { b } from "./y"'].join("\n");

    expect(sites(source)).toEqual([
      ["./x", "value"],
      ["./y", "value"],
    ]);
  });

  it("does not stitch a bare import and the next statement into one phantom site", () => {
    const source = ['import "./x"', 'import { b } from "./y"'].join("\n");

    expect(sites(source)).toEqual([
      ["./x", "value"],
      ["./y", "value"],
    ]);
  });

  it("reports a bare specifier rather than dropping it, since externality is resolveSpecifier's ruling", () => {
    expect(sites('import { v } from "valibot";')).toEqual([["valibot", "value"]]);
  });
});

describe("parseImports() — a comment inside the statement (the masked interior the clause must cross)", () => {
  it("finds the site through a comment in every place one may be written between `import` and its specifier", () => {
    const cases = [
      'import { a /* x */ } from "./x";',
      'import { a } from /* x */ "./x";',
      'export { a /* x */ } from "./x";',
      'import d /* x */, { a } from "./x";',
      ["import {", "  /** What a is. */", "  a,", '} from "./x";'].join("\n"),
    ];

    expect(cases.map(sites)).toEqual([[["./x", "value"]], [["./x", "value"]], [["./x", "value"]], [["./x", "value"]], [["./x", "value"]]]);
  });

  it("keeps a commented type-only clause a type edge, since the comment erases with the bindings around it", () => {
    expect(sites('import type { A /* x */ } from "./x";')).toEqual([["./x", "type"]]);
  });

  it("reads a member commented with the word `type` as a value, since prose binds nothing", () => {
    expect(sites('import { /* type */ A } from "./x";')).toEqual([["./x", "value"]]);
  });
});

describe("namespaceOf() — attribution (nested namespaces)", () => {
  it("attributes a file to the longest matching namespace, so a nested one is not merged into its parent", () => {
    expect(namespaceOf("src/core/one/x.ts", ["core", "core/one"])).toEqual("core/one");
  });

  it("attributes a path that is exactly a namespace directory to that namespace", () => {
    expect(namespaceOf("src/alpha", ["alpha", "beta"])).toEqual("alpha");
  });

  it("returns null for a file under src that belongs to no declared namespace", () => {
    expect(namespaceOf("src/gamma/x.ts", ["alpha", "beta"])).toEqual(null);
  });

  it("returns null for a file outside src, which is never part of the namespace graph", () => {
    expect(namespaceOf("config/alpha/x.ts", ["alpha"])).toEqual(null);
  });
});

describe("resolveSpecifier() — specifier arithmetic (pure string computation)", () => {
  it("resolves a parent-relative specifier into the sibling directory it names", () => {
    expect(resolveSpecifier("src/alpha/x.ts", "../beta/y")).toEqual("src/beta/y");
  });

  it("resolves a same-directory specifier against the importing file's directory", () => {
    expect(resolveSpecifier("src/alpha/x.ts", "./y")).toEqual("src/alpha/y");
  });

  it("normalises repeated parent segments rather than leaving them in the attributed path", () => {
    expect(resolveSpecifier("src/alpha/deep/nested/x.ts", "../../../beta/y")).toEqual("src/beta/y");
  });

  it("strips a module extension, since attribution is a directory question and not a file one", () => {
    const cases: [string, string][] = [
      ["./y.ts", "src/alpha/y"],
      ["./y.tsx", "src/alpha/y"],
      ["./y.js", "src/alpha/y"],
    ];

    expect(cases.map(([specifier]) => resolveSpecifier("src/alpha/x.ts", specifier))).toEqual(cases.map(([, expected]) => expected));
  });

  it("returns null for every bare specifier, which is external and never a namespace edge", () => {
    const cases = ["valibot", "@scope/pkg", "node:path"];

    expect(cases.map((specifier) => resolveSpecifier("src/alpha/x.ts", specifier))).toEqual([null, null, null]);
  });
});

describe("buildGraph() — edge recording (the declared-edge check)", () => {
  it("records an edge between two different namespaces with the site that produced it", () => {
    const files: SourceFile[] = [{ path: "src/alpha/a.ts", source: 'import { b } from "../beta/b";' }];

    expect(edges(files, ["alpha", "beta"])).toEqual([{ from: "alpha", to: "beta", kind: "value", file: "src/alpha/a.ts", line: 1 }]);
  });

  it("drops a self-edge, since a namespace importing its own files says nothing about coupling", () => {
    const files: SourceFile[] = [{ path: "src/alpha/a.ts", source: 'import { b } from "./b";' }];

    expect(edges(files, ["alpha", "beta"])).toEqual([]);
  });

  it("records an edge between two nested namespaces attributed by longest prefix", () => {
    const files: SourceFile[] = [{ path: "src/core/one/a.ts", source: 'import { b } from "../two/b";' }];

    expect(edges(files, ["core", "core/one", "core/two"])).toEqual([
      { from: "core/one", to: "core/two", kind: "value", file: "src/core/one/a.ts", line: 1 },
    ]);
  });

  it("excludes test files, so a fixture import cannot invent an edge a shipped module never has", () => {
    const files: SourceFile[] = [{ path: "src/alpha/a.test.ts", source: 'import { b } from "../beta/b";' }];

    expect(edges(files, ["alpha", "beta"])).toEqual([]);
  });

  it("returns no edge for a file outside every declared namespace", () => {
    const files: SourceFile[] = [{ path: "config/tool.ts", source: 'import { b } from "../src/beta/b";' }];

    expect(edges(files, ["alpha", "beta"])).toEqual([]);
  });
});

describe("buildGraph() — kind is the AND over every site (the reader chasing the message)", () => {
  it("promotes a type edge to a value edge and moves the reported site onto the value import", () => {
    const files: SourceFile[] = [
      { path: "src/alpha/a.ts", source: ['import type { B } from "../beta/b";', 'import { c } from "../beta/c";'].join("\n") },
    ];

    expect(edges(files, ["alpha", "beta"])).toEqual([{ from: "alpha", to: "beta", kind: "value", file: "src/alpha/a.ts", line: 2 }]);
  });

  it("keeps a value edge a value edge when a later site is type-only, and does not move the site", () => {
    const files: SourceFile[] = [
      { path: "src/alpha/a.ts", source: ['import { b } from "../beta/b";', 'import type { C } from "../beta/c";'].join("\n") },
    ];

    expect(edges(files, ["alpha", "beta"])).toEqual([{ from: "alpha", to: "beta", kind: "value", file: "src/alpha/a.ts", line: 1 }]);
  });

  it("keeps the first contributing site when two value sites agree on the kind", () => {
    const files: SourceFile[] = [
      { path: "src/alpha/a.ts", source: ['import { b } from "../beta/b";', 'import { c } from "../beta/c";'].join("\n") },
    ];

    expect(edges(files, ["alpha", "beta"])).toEqual([{ from: "alpha", to: "beta", kind: "value", file: "src/alpha/a.ts", line: 1 }]);
  });

  it("keeps the first contributing site when every site is type-only, and the edge stays a type edge", () => {
    const files: SourceFile[] = [
      { path: "src/alpha/a.ts", source: ['import type { B } from "../beta/b";', 'import type { C } from "../beta/c";'].join("\n") },
    ];

    expect(edges(files, ["alpha", "beta"])).toEqual([{ from: "alpha", to: "beta", kind: "type", file: "src/alpha/a.ts", line: 1 }]);
  });

  it("promotes a type edge across files, moving the reported site into the file that imports a value", () => {
    const files: SourceFile[] = [
      { path: "src/alpha/a.ts", source: 'import type { B } from "../beta/b";' },
      { path: "src/alpha/z.ts", source: ["", 'import { c } from "../beta/c";'].join("\n") },
    ];

    expect(edges(files, ["alpha", "beta"])).toEqual([{ from: "alpha", to: "beta", kind: "value", file: "src/alpha/z.ts", line: 2 }]);
  });

  it("keeps edges to different targets independent of one another", () => {
    const files: SourceFile[] = [
      { path: "src/alpha/a.ts", source: ['import type { B } from "../beta/b";', 'import { g } from "../gamma/g";'].join("\n") },
    ];

    expect(edges(files, ["alpha", "beta", "gamma"])).toEqual([
      { from: "alpha", to: "beta", kind: "type", file: "src/alpha/a.ts", line: 1 },
      { from: "alpha", to: "gamma", kind: "value", file: "src/alpha/a.ts", line: 2 },
    ]);
  });
});

describe("findEnumerations() — the enumerations the data files or a namespace's README own", () => {
  const NS = ["app", "ui/core", "crypto"];

  it("reports nothing for a document whose tables name no namespace path", () => {
    const lines = ["# Namespace design", "| Concern | Correct home |", "| --- | --- |", "| CSRF | `form` |"];

    expect(findEnumerations(lines, NS)).toEqual([]);
  });

  it("reports a `| Namespace | Composes |` row at its own line in any section, not only the classification one", () => {
    const lines = ["## 4. Composition", "Prose.", "## 5. Growth", "| Namespace | Composes |"];

    expect(findEnumerations(lines, NS)).toEqual([{ kind: "composes-table", line: 4 }]);
  });

  it("reports a `Category` column row at its own line with no catalog heading anywhere", () => {
    const lines = ["# Namespace design", "Prose.", "| Subpath | Category |"];

    expect(findEnumerations(lines, NS)).toEqual([{ kind: "classification-column", line: 3 }]);
  });

  it("reports a row naming a package subpath and its barrel as a catalogue at that row", () => {
    const lines = ["Prose.", "| `@y-core/forge/app` | `src/app/mod.ts` | bootstrap |"];

    expect(findEnumerations(lines, NS)).toEqual([{ kind: "catalog-table", line: 2 }]);
  });

  it("reports a row naming only a package subpath, since the subpath alone restates the catalogue", () => {
    expect(findEnumerations(["| `@y-core/forge/ui/core` | components |"], NS)).toEqual([{ kind: "catalog-table", line: 1 }]);
  });

  it("reports a sealed-internal source directory in a row, so an internal-namespaces table is caught too", () => {
    const lines = ["### 3b. Internal Namespaces", "| `src/crypto/` | HMAC | `auth` |"];

    expect(findEnumerations(lines, NS)).toEqual([{ kind: "catalog-table", line: 2 }]);
  });

  it("reports one catalogue per table, at its first naming row, and a second table separately", () => {
    const lines = [
      "| Subpath | Purpose |",
      "| `src/app/` | bootstrap |",
      "| `src/ui/core/` | components |",
      "| `src/crypto/` | HMAC |",
      "Prose between the tables.",
      "| `src/app/` | bootstrap |",
    ];

    expect(findEnumerations(lines, NS)).toEqual([
      { kind: "catalog-table", line: 2 },
      { kind: "catalog-table", line: 6 },
    ]);
  });

  it("reports nothing for a namespace path written in prose rather than a table row", () => {
    expect(findEnumerations(["The barrel is `src/app/mod.ts`."], NS)).toEqual([]);
  });

  it("reports nothing for a row naming a namespace bare, which is how a growth ruling names its home", () => {
    expect(findEnumerations(["| `Timeline` | shipped | lives in `ui/core` |"], NS)).toEqual([]);
  });

  it("reports nothing for a directory that only begins with a namespace's name", () => {
    expect(findEnumerations(["| `src/apple/x.ts` | fruit |"], NS)).toEqual([]);
  });

  it("reports nothing for a row naming a directory outside the namespace set", () => {
    expect(findEnumerations(["| `src/tooling/root/` | helpers |"], NS)).toEqual([]);
  });

  it("reports no missing section for a document with no headings at all", () => {
    expect(findEnumerations(["Prose only.", "More prose."], NS)).toEqual([]);
  });

  it("returns mixed kinds in ascending line order", () => {
    const lines = ["| Subpath | Category |", "Prose.", "| `src/app/` | bootstrap |", "Prose.", "| Namespace | Composes |"];

    expect(findEnumerations(lines, NS)).toEqual([
      { kind: "classification-column", line: 1 },
      { kind: "catalog-table", line: 3 },
      { kind: "composes-table", line: 5 },
    ]);
  });

  it("reads namespace paths under the source root it is given", () => {
    const lines = ["| `lib/app/mod.ts` | bootstrap |", "Prose.", "| `src/app/mod.ts` | bootstrap |"];

    expect(findEnumerations(lines, NS, "lib")).toEqual([{ kind: "catalog-table", line: 1 }]);
  });

  it("reports no catalogue when the namespace set is empty", () => {
    expect(findEnumerations(["| `src/app/` | bootstrap |"], [])).toEqual([]);
  });
});
