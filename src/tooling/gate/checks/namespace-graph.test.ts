import { describe, expect, it } from "bun:test";

import { fail } from "../finding";
import { gateFixtureRoot } from "./gate.fixture";
import { checkNamespaceGraph, resolveNamespaces, validateNoEnumeration, validateNoMutualValuePairs } from "./namespace-graph";
import type { DeclaredGraph, EdgeKind, ExportsMap } from "./types";

const DOC = "docs/NAMESPACES.md";

const EXPORTS: ExportsMap = { "./alpha": "./src/alpha/mod.ts", "./beta": "./src/beta/mod.ts" };

const EMPTY_GRAPH: DeclaredGraph = { primitives: [], leaf: [], edges: {} };

describe("resolveNamespaces() — the namespace set is derived, never listed", () => {
  it("takes the directory of every mod.ts the exports map names", () => {
    const map = { ".": "./src/app/mod.ts", "./http": "./src/http/mod.ts" };

    expect(resolveNamespaces(map)).toEqual(["app", "http"]);
  });

  it("attributes a sub-namespace separately from its parent", () => {
    const map = { "./storage/db": "./src/storage/db/mod.ts", "./storage/kv": "./src/storage/kv/mod.ts" };

    expect(resolveNamespaces(map)).toEqual(["storage/db", "storage/kv"]);
  });

  it("ignores a directory that owns no export subpath", () => {
    const map = { "./assets": "./src/assets/mod.ts" };

    expect(resolveNamespaces(map)).toEqual(["assets"]);
  });

  it("includes a sealed-internal barrel that owns no subpath at all", () => {
    const map = { "./http": "./src/http/mod.ts" };

    expect(resolveNamespaces(map, ["src/crypto/mod.ts"])).toEqual(["crypto", "http"]);
  });

  it("ignores an exports entry that is not a barrel", () => {
    const map = { "./css": "./src/ui/assets/css/forge.css", "./http": "./src/http/mod.ts" };

    expect(resolveNamespaces(map)).toEqual(["http"]);
  });

  it("honours a source root other than src/", () => {
    const map = { "./http": "./lib/http/mod.ts" };

    expect(resolveNamespaces(map, [], "lib")).toEqual(["http"]);
  });

  it("resolves a target written without the leading ./", () => {
    expect(resolveNamespaces({ "./http": "src/http/mod.ts" })).toEqual(["http"]);
  });
});

describe("validateNoMutualValuePairs()", () => {
  const edges = (value: Record<string, Record<string, EdgeKind>>) => value;

  it("passes a pair whose one direction is type-only", () => {
    expect(validateNoMutualValuePairs(edges({ logging: { "storage/kv": "type" }, "storage/kv": { logging: "value" } }))).toEqual([]);
  });

  it("fails a pair carrying a value edge in both directions", () => {
    const findings = validateNoMutualValuePairs(edges({ a: { b: "value" }, b: { a: "value" } }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe("fail");
    expect(findings[0]?.message).toContain("`a` → `b` and `b` → `a` are both `value` edges");
  });

  it("reports an offending pair once, naming the alphabetically first namespace first", () => {
    const findings = validateNoMutualValuePairs(edges({ zed: { alpha: "value" }, alpha: { zed: "value" } }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("edges alpha ↔ zed");
  });

  it("passes a graph with no mutual naming at all", () => {
    expect(validateNoMutualValuePairs(edges({ a: { b: "value" }, b: { c: "value" } }))).toEqual([]);
  });
});

describe("validateNoEnumeration()", () => {
  const NS = ["alpha", "beta"];

  it("reports nothing for a document carrying no enumeration, with no headings needed", () => {
    expect(validateNoEnumeration(["Prose only.", "| Concern | Home |", "| CSRF | `form` |"], DOC, NS)).toEqual([]);
  });

  it("names a returned `Namespace | Composes` table at its own line", () => {
    const lines = ["Prose.", "| Subpath | Barrel |", "Prose.", "| Namespace | Composes |", ""];
    const findings = validateNoEnumeration(lines, DOC, NS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe(DOC);
    expect(findings[0]?.line).toBe(4);
    expect(findings[0]?.message).toContain("the `| Namespace | Composes |` table is back");
  });

  it("names a returned namespace catalogue at the row that names a namespace", () => {
    const findings = validateNoEnumeration(["Prose.", "| Subpath | Barrel |", "| `./alpha` | `src/alpha/mod.ts` |"], DOC, NS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe(DOC);
    expect(findings[0]?.line).toBe(3);
    expect(findings[0]?.message).toContain("a namespace catalogue is back");
  });

  it("names a returned classification column at its own line", () => {
    const findings = validateNoEnumeration(["Prose.", "| Subpath | Category |"], DOC, NS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(2);
    expect(findings[0]?.message).toContain("the catalog's classification column is back");
  });
});

describe("checkNamespaceGraph() — the vacuity refusal", () => {
  it("refuses an exports map that derives no namespace at all", () => {
    const result = checkNamespaceGraph({ root: ".", exports: {}, graph: { primitives: [], leaf: [], edges: {} } });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      fail("`src` resolved no namespace from the export map — refusing to report a green namespace-graph gate that scanned nothing"),
    ]);
    expect(result.summary).toBe("");
  });

  it("refuses a walk that matched no source, even where the export map names namespaces", () => {
    const root = gateFixtureRoot({ "src/alpha/README.md": "# alpha\n", "README.md": "# forge\n" });
    const result = checkNamespaceGraph({ root, exports: EXPORTS, graph: EMPTY_GRAPH });

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([fail("`src` matched no source — refusing to report a green namespace-graph gate that scanned nothing")]);
    expect(result.summary).toBe("");
  });
});

describe("checkNamespaceGraph() — the walk over a tree carrying a real violation", () => {
  it("reports an undeclared cross-namespace edge against the importing file and its specifier's line", () => {
    const root = gateFixtureRoot({
      "src/alpha/mod.ts": 'export { a } from "./a";\n',
      "src/alpha/a.ts": ["export const a = 1;", 'import { b } from "../beta/b";', "export const c = b;"].join("\n"),
      "src/beta/mod.ts": 'export { b } from "./b";\n',
      "src/beta/b.ts": "export const b = 2;\n",
    });

    const result = checkNamespaceGraph({ root, exports: EXPORTS, graph: EMPTY_GRAPH });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => [finding.file, finding.line])).toEqual([["src/alpha/a.ts", 2]]);
    expect(result.findings[0]?.message).toContain("`alpha` imports `beta` but `EDGES` declares no such edge");
  });

  it("passes the same tree once the edge is declared with the kind the import has", () => {
    const root = gateFixtureRoot({
      "src/alpha/mod.ts": 'export { a } from "./a";\n',
      "src/alpha/a.ts": 'import { b } from "../beta/b";\nexport const a = b;\n',
      "src/beta/mod.ts": 'export { b } from "./b";\n',
      "src/beta/b.ts": "export const b = 2;\n",
    });

    const result = checkNamespaceGraph({ root, exports: EXPORTS, graph: { primitives: [], leaf: [], edges: { alpha: { beta: "value" } } } });

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("finds a violating file nested below the namespace directory, so the walk must recurse", () => {
    const root = gateFixtureRoot({
      "src/alpha/mod.ts": "export const m = 1;\n",
      "src/alpha/deep/nested/a.ts": 'import { b } from "../../../beta/b";\nexport const a = b;\n',
      "src/beta/mod.ts": "export const m = 2;\n",
      "src/beta/b.ts": "export const b = 2;\n",
    });

    const result = checkNamespaceGraph({ root, exports: EXPORTS, graph: EMPTY_GRAPH });

    expect(result.findings.map((finding) => finding.file)).toEqual(["src/alpha/deep/nested/a.ts"]);
  });

  it("raises no edge for the same import written in a test file, which ships to nobody", () => {
    const root = gateFixtureRoot({
      "src/alpha/mod.ts": "export const m = 1;\n",
      "src/alpha/a.test.ts": 'import { b } from "../beta/b";\nexport const a = b;\n',
      "src/beta/mod.ts": "export const m = 2;\n",
      "src/beta/b.ts": "export const b = 2;\n",
    });

    expect(checkNamespaceGraph({ root, exports: EXPORTS, graph: EMPTY_GRAPH }).findings).toEqual([]);
  });
});

describe("checkNamespaceGraph() — the document guarded against a returning catalogue", () => {
  const tree = (doc: string) =>
    gateFixtureRoot({ "src/alpha/mod.ts": "export const m = 1;\n", "src/beta/mod.ts": "export const m = 2;\n", [DOC]: doc });

  it("fails a document whose table names a namespace's barrel, at that row", () => {
    const root = tree("# Namespaces\n\n| Barrel |\n| `src/alpha/mod.ts` |\n");
    const result = checkNamespaceGraph({ root, exports: EXPORTS, graph: EMPTY_GRAPH, enumerationDoc: DOC });

    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => [finding.file, finding.line])).toEqual([[DOC, 4]]);
  });

  it("passes the same document once the barrel is named in prose", () => {
    const root = tree("# Namespaces\n\nThe barrel is `src/alpha/mod.ts`.\n");

    expect(checkNamespaceGraph({ root, exports: EXPORTS, graph: EMPTY_GRAPH, enumerationDoc: DOC }).findings).toEqual([]);
  });
});
