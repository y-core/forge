import { describe, expect, it } from "bun:test";
import {
  buildGraph,
  type EdgeKind,
  findEnumerations,
  isTestSource,
  namespaceOf,
  parseImports,
  resolveSpecifier,
  type SourceFile,
  sectionWindow,
} from "./namespace-graph-parse";

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

describe("isTestSource() — test exclusion (the leaf classification)", () => {
  it("marks the four test suffixes and nothing that merely reads like one", () => {
    const cases = [
      "src/alpha/a.test.ts",
      "src/alpha/a.test.tsx",
      "src/alpha/a.browser.ts",
      "src/alpha/a.browser.tsx",
      "src/alpha/a.ts",
      "src/alpha/a.tsx",
      "src/alpha/testing.ts",
      "src/alpha/browser.ts",
    ];

    expect(cases.map((path) => [path, isTestSource(path)])).toEqual([
      ["src/alpha/a.test.ts", true],
      ["src/alpha/a.test.tsx", true],
      ["src/alpha/a.browser.ts", true],
      ["src/alpha/a.browser.tsx", true],
      ["src/alpha/a.ts", false],
      ["src/alpha/a.tsx", false],
      ["src/alpha/testing.ts", false],
      ["src/alpha/browser.ts", false],
    ]);
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

describe("sectionWindow() — where a guard is allowed to look", () => {
  it("returns null when no line matches the heading, since a section that moved silently is the failure", () => {
    const lines = ["# Namespace design", "## 3. Catalog", "Prose only."];

    expect(sectionWindow(lines, /^### 4a\. /)).toEqual(null);
  });

  it("opens the window on the heading line itself, not the line after it", () => {
    const lines = ["# Namespace design", "Prose.", "### 4a. Classification", "Prose.", "## 5. Next"];

    expect(sectionWindow(lines, /^### 4a\. /)).toEqual({ from: 2, to: 4 });
  });

  it("closes the window at the next `## ` line", () => {
    const lines = ["### 3a. Catalog", "| Subpath | Purpose |", "## 4. Composition", "| Subpath | Category |"];

    expect(sectionWindow(lines, /^### 3a\. /)).toEqual({ from: 0, to: 2 });
  });

  it("closes the window at the end of the document when no `## ` follows", () => {
    const lines = ["# Namespace design", "### 3a. Catalog", "| Subpath | Purpose |"];

    expect(sectionWindow(lines, /^### 3a\. /)).toEqual({ from: 1, to: 3 });
  });

  it("runs past a sibling `###` heading, covering §3b from a window opened on §3a", () => {
    const lines = ["### 3a. Catalog", "Prose.", "### 3b. Sibling", "| Subpath | Category |", "## 4. Composition"];

    expect(sectionWindow(lines, /^### 3a\. /)).toEqual({ from: 0, to: 4 });
  });

  it("opens on the first matching heading when the pattern appears twice", () => {
    const lines = ["### 4a. Classification", "Prose.", "## 5. Next", "### 4a. Classification", "Prose."];

    expect(sectionWindow(lines, /^### 4a\. /)).toEqual({ from: 0, to: 2 });
  });
});

describe("findEnumerations() — the enumerations the data files own", () => {
  it("reports nothing for a document whose sections cite the data files and enumerate nothing", () => {
    const lines = [
      "# Namespace design",
      "## 3. Catalog",
      "### 3a. Subpath catalog",
      "| Subpath | Purpose |",
      "## 4. Composition",
      "### 4a. Classification",
      "Prose citing `EDGES`.",
    ];

    expect(findEnumerations(lines)).toEqual([]);
  });

  it("reports a `| Namespace | Composes |` row inside the §4a window, at the row's own line", () => {
    const lines = [
      "## 3. Catalog",
      "### 3a. Subpath catalog",
      "| Subpath | Purpose |",
      "## 4. Composition",
      "### 4a. Classification",
      "| Namespace | Composes |",
    ];

    expect(findEnumerations(lines)).toEqual([{ kind: "composes-table", line: 6 }]);
  });

  it("reports nothing for the same `| Namespace | Composes |` row placed outside the §4a window", () => {
    const lines = [
      "## 3. Catalog",
      "### 3a. Subpath catalog",
      "| Namespace | Composes |",
      "## 4. Composition",
      "### 4a. Classification",
      "Prose citing `EDGES`.",
    ];

    expect(findEnumerations(lines)).toEqual([]);
  });

  it("reports a `Category` column row inside the §3a window", () => {
    const lines = [
      "## 3. Catalog",
      "### 3a. Subpath catalog",
      "| Subpath | Category |",
      "## 4. Composition",
      "### 4a. Classification",
      "Prose citing `EDGES`.",
    ];

    expect(findEnumerations(lines)).toEqual([{ kind: "classification-column", line: 3 }]);
  });

  it("reports a `Classification` column row inside the §3a window on the same terms", () => {
    const lines = [
      "## 3. Catalog",
      "### 3a. Subpath catalog",
      "| Subpath | Classification |",
      "## 4. Composition",
      "### 4a. Classification",
      "Prose citing `EDGES`.",
    ];

    expect(findEnumerations(lines)).toEqual([{ kind: "classification-column", line: 3 }]);
  });

  it("reports nothing for the same column row placed outside the §3a window", () => {
    const lines = [
      "# Namespace design",
      "| Subpath | Category |",
      "## 3. Catalog",
      "### 3a. Subpath catalog",
      "Prose only.",
      "## 4. Composition",
      "### 4a. Classification",
      "Prose citing `EDGES`.",
    ];

    expect(findEnumerations(lines)).toEqual([]);
  });

  it("reports an absent §4a heading and still runs the §3a checks, since the sections are independent", () => {
    const lines = ["## 3. Catalog", "### 3a. Subpath catalog", "| Subpath | Category |", "## 4. Composition", "Prose only."];

    expect(findEnumerations(lines)).toEqual([
      { kind: "missing-classification-section", line: null },
      { kind: "classification-column", line: 3 },
    ]);
  });

  it("reports an absent §3a heading and no column finding, even for a row later in the document", () => {
    const lines = ["## 4. Composition", "### 4a. Classification", "Prose citing `EDGES`.", "## 5. Catalog", "| Subpath | Category |"];

    expect(findEnumerations(lines)).toEqual([{ kind: "missing-catalog-section", line: null }]);
  });

  it("reports both missing sections, classification before catalog", () => {
    const lines = ["# Namespace design", "## 3. Catalog", "Prose only."];

    expect(findEnumerations(lines)).toEqual([
      { kind: "missing-classification-section", line: null },
      { kind: "missing-catalog-section", line: null },
    ]);
  });

  it("reports both offending rows in one window, ascending by line", () => {
    const lines = [
      "## 3. Catalog",
      "### 3a. Subpath catalog",
      "Prose only.",
      "## 4. Composition",
      "### 4a. Classification",
      "| Namespace | Composes |",
      "Prose.",
      "| Namespace | Composes |",
    ];

    expect(findEnumerations(lines)).toEqual([
      { kind: "composes-table", line: 6 },
      { kind: "composes-table", line: 8 },
    ]);
  });

  it("reports the §4a hit before the §3a hit, whichever line each sits on", () => {
    const lines = [
      "## 3. Catalog",
      "### 3a. Subpath catalog",
      "| Subpath | Category |",
      "## 4. Composition",
      "### 4a. Classification",
      "| Namespace | Composes |",
    ];

    expect(findEnumerations(lines)).toEqual([
      { kind: "composes-table", line: 6 },
      { kind: "classification-column", line: 3 },
    ]);
  });

  it("numbers lines from one and names the offending row, not the heading that opened the window", () => {
    const lines = [
      "# Namespace design",
      "## 3. Catalog",
      "### 3a. Subpath catalog",
      "Prose.",
      "Prose.",
      "| Subpath | Category |",
      "## 4. Composition",
      "### 4a. Classification",
      "Prose.",
      "| Namespace | Composes |",
    ];

    expect(findEnumerations(lines)).toEqual([
      { kind: "composes-table", line: 10 },
      { kind: "classification-column", line: 6 },
    ]);
  });
});
