import { describe, expect, it } from "bun:test";

import type { Chunk, SourceDoc } from "../types";
import { citationTarget, headerOf, relationsOf, resolveDoc } from "./relate";

const SOURCES: SourceDoc[] = [
  { corpus: "canon", tree: "libs", path: "CODE_RULES.md", file: "/c/CODE_RULES.md", weight: 1.3 },
  { corpus: "canon", tree: "libs", path: "TESTING.md", file: "/c/TESTING.md", weight: 1.3 },
  { corpus: "project", path: "docs/TESTING.md", file: "/r/docs/TESTING.md", weight: 1.2 },
];

const DOC = SOURCES[2] as SourceDoc;

const chunk = (id: string, body: string): Chunk => ({
  id,
  section: "1",
  title: "One",
  headingPath: "1. One",
  gloss: "",
  rules: "",
  searchBody: body,
  body,
  ordinal: 0,
  line: 1,
  endLine: 1,
  searchable: true,
});

describe("resolveDoc()", () => {
  it("resolves a spelling that names exactly one document", () => {
    expect(resolveDoc("CODE_RULES.md", SOURCES)).toBe("canon:CODE_RULES.md");
  });

  it("leaves an ambiguous basename unresolved rather than guessing", () => {
    expect(resolveDoc("TESTING.md", SOURCES)).toBeUndefined();
  });

  it("disambiguates by the tree prefix a chunk id already uses", () => {
    expect(resolveDoc("libs/TESTING.md", SOURCES)).toBe("canon:TESTING.md");
  });

  it("resolves a document nobody names to nothing", () => {
    expect(resolveDoc("ABSENT.md", SOURCES)).toBeUndefined();
  });

  it("prefers the citing document's own tree when both trees carry the name", () => {
    const shared: SourceDoc = { corpus: "canon", tree: "shared", path: "TESTING.md", file: "/c/s/TESTING.md", weight: 1.3 };

    expect(resolveDoc("TESTING.md", [...SOURCES, shared], shared)).toBe("canon:TESTING.md");
  });

  it("falls back to the citing document's corpus, so a cross-tree citation resolves at all", () => {
    // A `shared` rule citing a `libs` document has no same-tree candidate. Without this step it
    // lands back among every match and is dropped — and an unresolved edge only warns.
    const shared: SourceDoc = { corpus: "canon", tree: "shared", path: "AGENT_GUIDE.md", file: "/c/s/AGENT_GUIDE.md", weight: 1.3 };

    expect(resolveDoc("TESTING.md", [...SOURCES, shared], shared)).toBe("canon:TESTING.md");
  });

  it("still refuses when the citing document's own corpus is the ambiguous one", () => {
    const second: SourceDoc = { corpus: "canon", tree: "libs", path: "sub/TESTING.md", file: "/c/sub/TESTING.md", weight: 1.3 };

    expect(resolveDoc("TESTING.md", [...SOURCES, second], SOURCES[1])).toBeUndefined();
  });
});

describe("headerOf()", () => {
  it("takes everything before the first level-2 heading", () => {
    expect(headerOf("---\ntitle: X\n---\n\n> Defers to: A.md\n\n## 1. One\n\nBody.")).toContain("Defers to");
    expect(headerOf("---\ntitle: X\n---\n\n## 1. One\n\nBody.")).not.toContain("Body.");
  });
});

describe("relationsOf()", () => {
  it("reads a `> Defers to:` header into one edge per document it names, on the section the prose names", () => {
    const header = "> Defers to: [`CODE_RULES.md`](./CODE_RULES.md) §5c for the budget.";

    expect(relationsOf(DOC, [], header, SOURCES)).toEqual([
      { from: "project:docs/TESTING.md", kind: "defers", raw: "CODE_RULES.md §5c", to: "canon:CODE_RULES.md#5c" },
    ]);
  });

  it("falls back to the document when the deferring prose names no section", () => {
    const header = "> Defers to: [`CODE_RULES.md`](./CODE_RULES.md) for the budget.";

    expect(relationsOf(DOC, [], header, SOURCES)).toEqual([
      { from: "project:docs/TESTING.md", kind: "defers", raw: "CODE_RULES.md", to: "canon:CODE_RULES.md" },
    ]);
  });

  it("reads a §N citation in a chunk into an edge on that section", () => {
    const chunks = [chunk("project:docs/TESTING.md#1", "See `CODE_RULES.md` §5c for the rule.")];

    expect(relationsOf(DOC, chunks, "", SOURCES)).toEqual([
      { from: "project:docs/TESTING.md#1", kind: "cites", raw: "CODE_RULES.md §5c", to: "canon:CODE_RULES.md#5c" },
    ]);
  });

  it("keeps an unresolvable citation with its raw spelling rather than dropping it", () => {
    const chunks = [chunk("project:docs/TESTING.md#1", "See `ABSENT.md` §1.")];

    expect(relationsOf(DOC, chunks, "", SOURCES)).toEqual([{ from: "project:docs/TESTING.md#1", kind: "cites", raw: "ABSENT.md §1" }]);
  });

  it("emits one edge for a citation a section repeats", () => {
    const chunks = [chunk("project:docs/TESTING.md#1", "`CODE_RULES.md` §5c, and again `CODE_RULES.md` §5c.")];

    expect(relationsOf(DOC, chunks, "", SOURCES)).toHaveLength(1);
  });
});

describe("citationTarget()", () => {
  it("builds the chunk id a `DOC.md §N` citation names", () => {
    expect(citationTarget("CODE_RULES.md", "5c", SOURCES)).toBe("canon:CODE_RULES.md#5c");
  });
});

describe("relationsOf() — the governs edges", () => {
  const govern = (body: string) =>
    relationsOf(DOC, [chunk("project:docs/TESTING.md#1", body)], "", SOURCES, "@y-core/forge").filter((r) => r.kind === "governs");

  it("emits nothing without a package name, so the parameter is honestly optional", () => {
    const body = "Every HTTP output concern goes to `@y-core/forge/http`.";

    expect(relationsOf(DOC, [chunk("project:docs/TESTING.md#1", body)], "", SOURCES)).toEqual([]);
  });

  it("binds a subpath a section's prose names, targeting a non-null `code:` id", () => {
    expect(govern("Every HTTP output concern goes to `@y-core/forge/http`.")).toEqual([
      { from: "project:docs/TESTING.md#1", kind: "governs", to: "code:./http", raw: "@y-core/forge/http" },
    ]);
  });

  it("skips a table row, because a row lists a subpath and only prose binds it", () => {
    expect(govern("| `@y-core/forge/http` | `src/http/mod.ts` | response builders |")).toEqual([]);
  });

  it("binds once when one section names a subpath in prose and again in a row", () => {
    const body = ["| `@y-core/forge/http` | `src/http/mod.ts` |", "", "HTTP output belongs in `@y-core/forge/http`."].join("\n");

    expect(govern(body).map((relation) => relation.to)).toEqual(["code:./http"]);
  });

  it("binds each distinct subpath a section names once, in the order the prose names them", () => {
    const body = "`@y-core/forge/http` renders; `@y-core/forge/result` carries the outcome; `@y-core/forge/http` again.";

    expect(govern(body).map((relation) => relation.to)).toEqual(["code:./http", "code:./result"]);
  });

  it("scopes the edge to the chunk, so a citation in one section never binds another", () => {
    const chunks = [chunk("project:docs/TESTING.md#1", "Use `@y-core/forge/http`."), chunk("project:docs/TESTING.md#2", "No subpath here.")];
    const edges = relationsOf(DOC, chunks, "", SOURCES, "@y-core/forge").filter((relation) => relation.kind === "governs");

    expect(edges.map((relation) => relation.from)).toEqual(["project:docs/TESTING.md#1"]);
  });
});
