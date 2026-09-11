import { describe, expect, it } from "bun:test";

import type { Chunk, SourceDoc } from "../types";
import { citationTarget, headerOf, relationsOf, resolveCitation, resolveDoc } from "./relate";

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

describe("resolveCitation()", () => {
  // `resolveDoc` answered `undefined` for both, and the two are different defects: one is a typo or
  // a renamed document, the other is a citation that needs a path.
  it("tells a spelling that names nothing apart from one that names several", () => {
    expect(resolveCitation("ABSENT.md", SOURCES)).toEqual({ kind: "none" });
    expect(resolveCitation("TESTING.md", SOURCES)).toEqual({ kind: "ambiguous", ids: ["canon:TESTING.md", "project:docs/TESTING.md"] });
  });

  it("resolves through the citing document's own tree first", () => {
    expect(resolveCitation("TESTING.md", SOURCES, DOC)).toEqual({ kind: "resolved", id: "project:docs/TESTING.md" });
  });

  // A bare filename in a consumer's own document never means the installed library's copy: they
  // wrote it about their own repository.
  it("puts the installed library last, behind the canon and this repository's own", () => {
    const library: SourceDoc = { corpus: "dependency", path: "forge/TESTING.md", file: "/n/forge/TESTING.md", weight: 1.1 };
    const citing: SourceDoc = { corpus: "dependency", path: "forge/OTHER.md", file: "/n/forge/OTHER.md", weight: 1.1 };

    expect(resolveCitation("TESTING.md", [...SOURCES, library], DOC)).toEqual({ kind: "resolved", id: "project:docs/TESTING.md" });
    // From inside the library, its own corpus wins on the first tier rather than on the last one.
    expect(resolveCitation("TESTING.md", [...SOURCES, library], citing)).toEqual({ kind: "resolved", id: "dependency:forge/TESTING.md" });
  });
});

describe("resolveCitation() — a citation made from the installed library", () => {
  const README: SourceDoc = { corpus: "dependency", path: "forge/src/ui/README.md", file: "/n/forge/src/ui/README.md", weight: 0.7 };
  const LIBRARY_DOC: SourceDoc = { corpus: "dependency", path: "forge/ERROR_HANDLING.md", file: "/n/forge/ERROR_HANDLING.md", weight: 0.95 };
  const CONSUMER_DOC: SourceDoc = { corpus: "project", path: "docs/ERROR_HANDLING.md", file: "/r/docs/ERROR_HANDLING.md", weight: 1.2 };
  const CANON_DOC: SourceDoc = { corpus: "canon", tree: "shared", path: "ERROR_HANDLING.md", file: "/c/s/ERROR_HANDLING.md", weight: 1.3 };

  it("never lands on the consumer's same-named document", () => {
    expect(resolveCitation("docs/ERROR_HANDLING.md", [CONSUMER_DOC], README)).toEqual({ kind: "none" });
  });

  it("strips the prefix a relative href left, so the library's own copy matches", () => {
    expect(resolveCitation("docs/ERROR_HANDLING.md", [CONSUMER_DOC, LIBRARY_DOC], README)).toEqual({
      kind: "resolved",
      id: "dependency:forge/ERROR_HANDLING.md",
    });
  });

  it("prefers the library's copy over the canon's when the stripped spelling names both", () => {
    expect(resolveCitation("docs/ERROR_HANDLING.md", [CONSUMER_DOC, LIBRARY_DOC, CANON_DOC], README)).toEqual({
      kind: "resolved",
      id: "dependency:forge/ERROR_HANDLING.md",
    });
  });

  it("still resolves a tree-qualified canon spelling, which needs no stripping", () => {
    const canon: SourceDoc = { corpus: "canon", tree: "apps", path: "WORKERS_PLATFORM.md", file: "/c/a/WORKERS_PLATFORM.md", weight: 1.3 };

    expect(resolveCitation("apps/WORKERS_PLATFORM.md", [canon], README)).toEqual({ kind: "resolved", id: "canon:WORKERS_PLATFORM.md" });
  });

  it("leaves a citation from this repository's own document alone", () => {
    expect(resolveCitation("docs/TESTING.md", SOURCES, DOC)).toEqual({ kind: "resolved", id: "project:docs/TESTING.md" });
  });

  // A consumer carrying its own `src/ui/README.md` matches the same spelling twice, and each side
  // settles on its own copy at the first tier rather than reporting an ambiguity.
  it("settles a README spelling both corpora carry, per corpus", () => {
    const own: SourceDoc = { corpus: "project", path: "src/ui/README.md", file: "/r/src/ui/README.md", weight: 0.9 };

    expect(resolveCitation("ui/README.md", [own, README], README)).toEqual({ kind: "resolved", id: "dependency:forge/src/ui/README.md" });
    expect(resolveCitation("ui/README.md", [own, README], DOC)).toEqual({ kind: "resolved", id: "project:src/ui/README.md" });
  });

  it("resolves a bare README.md cited from the canon to the repository's root README", () => {
    const root: SourceDoc = { corpus: "project", path: "README.md", file: "/r/README.md", weight: 0.9 };

    expect(resolveCitation("README.md", [root], SOURCES[0])).toEqual({ kind: "resolved", id: "project:README.md" });
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

  it("ignores a document the Owns paragraph mentions but the deferral does not name", () => {
    const header = "> Owns the prose in `TESTING.md` and `CODE_RULES.md`.\n>\n> Defers to: `ABSENT.md` for form.";

    expect(relationsOf(DOC, [], header, SOURCES)).toEqual([{ from: "project:docs/TESTING.md", kind: "defers", raw: "ABSENT.md" }]);
  });

  it("reads a deferral that wraps across lines to the end of its clause", () => {
    const header = [
      "> Owns nothing.",
      ">",
      "> Defers to: [`CODE_RULES.md`](./CODE_RULES.md) §5c for the",
      "> budget, and `libs/TESTING.md`",
      "> for the gate.",
      ">",
      "> Not a deferral: `ABSENT.md`.",
    ].join("\n");

    expect(relationsOf(DOC, [], header, SOURCES)).toEqual([
      { from: "project:docs/TESTING.md", kind: "defers", raw: "CODE_RULES.md §5c", to: "canon:CODE_RULES.md#5c" },
      { from: "project:docs/TESTING.md", kind: "defers", raw: "libs/TESTING.md", to: "canon:TESTING.md" },
    ]);
  });

  // `DEFERRED_DOC` captures one leading segment, so `src/ui/README.md` arrives as `ui/README.md`
  // and the served `<package>/src/...` spelling matches it through the `endsWith` arm.
  it("resolves a deferral naming a namespace README of the installed library", () => {
    const readme: SourceDoc = { corpus: "dependency", path: "forge/src/ui/README.md", file: "/n/forge/src/ui/README.md", weight: 0.7 };
    const citing: SourceDoc = { corpus: "dependency", path: "forge/UI_SSR_COMPONENTS.md", file: "/n/forge/UI_SSR_COMPONENTS.md", weight: 0.95 };

    expect(relationsOf(citing, [], "> Defers to: `src/ui/README.md` for the signatures.", [readme])).toEqual([
      { from: "dependency:forge/UI_SSR_COMPONENTS.md", kind: "defers", raw: "ui/README.md", to: "dependency:forge/src/ui/README.md" },
    ]);
  });

  it("emits one edge for a deferral written as a markdown link to a namespace README", () => {
    const readme: SourceDoc = { corpus: "dependency", path: "forge/src/auth/README.md", file: "/n/forge/src/auth/README.md", weight: 0.7 };
    const citing: SourceDoc = { corpus: "dependency", path: "forge/AUTH_MOUNTING.md", file: "/n/forge/AUTH_MOUNTING.md", weight: 0.95 };
    const header = "> Defers to: [`src/auth/README.md`](../src/auth/README.md) for the surface.";

    expect(relationsOf(citing, [], header, [readme])).toEqual([
      { from: "dependency:forge/AUTH_MOUNTING.md", kind: "defers", raw: "auth/README.md", to: "dependency:forge/src/auth/README.md" },
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

  // A bare `find` returned the first match in discovery order, and `discover` puts the canon first
  // — so every filename spelled in two corpora resolved to the canon's copy, whoever cited it.
  it("settles a colliding filename by the citing document, not by discovery order", () => {
    expect(citationTarget("TESTING.md", "3b", SOURCES, DOC)).toBe("project:docs/TESTING.md#3b");
    expect(citationTarget("TESTING.md", "3b", SOURCES)).toBeUndefined();
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
