import { describe, expect, it } from "bun:test";

import { findSubpathCitations } from "./docs-parse";

const PKG = "@y-core/forge";

function subpaths(source: string, strict: boolean): string[] {
  return findSubpathCitations(source, PKG, { strict }).map((c) => c.subpath);
}

describe("findSubpathCitations() — lenient scanning (namespace READMEs)", () => {
  it("reads a citation on a genuine import line", () => {
    expect(subpaths('import { Button } from "@y-core/forge/ui/core";', false)).toEqual(["./ui/core"]);
  });

  it("ignores prose, so a README may name a subpath in order to deny it", () => {
    const prose = "There is no top-level `@y-core/forge/storage` barrel — import the client you need.";

    expect(subpaths(prose, false)).toEqual([]);
  });

  it("ignores a citation in a markdown table cell", () => {
    expect(subpaths("| `@y-core/forge/render` | JSX → `HtmlResponse` |", false)).toEqual([]);
  });
});

describe("findSubpathCitations() — strict scanning (governing docs and the root README)", () => {
  it("reads a citation out of a markdown table cell", () => {
    const cited = findSubpathCitations("| `@y-core/forge/render` | JSX → `HtmlResponse` |", PKG, { strict: true });

    expect(cited).toEqual([{ kind: "table", line: 1, raw: "/render", subpath: "./render" }]);
  });

  it("reads a citation out of a bolded markdown link label", () => {
    const line = "**[`@y-core/forge/ui`](src/ui/README.md)** — `ui/core`: JSX component library.";

    expect(subpaths(line, true)).toEqual(["./ui"]);
  });

  it("reads a citation out of running prose", () => {
    expect(subpaths("`renderPage` is imported from `@y-core/forge/render` today.", true)).toEqual(["./render"]);
  });

  it("reports the 1-indexed line each citation sits on", () => {
    const source = ["# Title", "", "| `@y-core/forge/render` |", "", "see `@y-core/forge/ui`"].join("\n");

    expect(findSubpathCitations(source, PKG, { strict: true }).map((c) => c.line)).toEqual([3, 5]);
  });

  it("finds every citation on a single line, not just the first", () => {
    const line = "**`@y-core/forge/storage/db`** · **`@y-core/forge/storage/kv`** · **`@y-core/forge/storage/r2`**";

    expect(subpaths(line, true)).toEqual(["./storage/db", "./storage/kv", "./storage/r2"]);
  });
});

describe("findSubpathCitations() — the shapes that are not citations", () => {
  it("skips a bare package name with no subpath", () => {
    expect(subpaths("forge ships as `@y-core/forge`, source-first.", true)).toEqual([]);
  });

  it("skips a trailing-slash placeholder, which stands for a namespace rather than naming one", () => {
    expect(subpaths("Consumers import from `@y-core/forge/{namespace}`", true)).toEqual([]);
    expect(subpaths("Consumers import from `@y-core/forge/`", true)).toEqual([]);
  });

  it("skips an elided path fragment", () => {
    expect(subpaths("see `@y-core/forge/ui/...` for the rest", true)).toEqual([]);
  });

  it("trims trailing punctuation the match swallows, so a sentence-final subpath still resolves", () => {
    expect(subpaths("Components come from @y-core/forge/ui/core.", true)).toEqual(["./ui/core"]);
    expect(subpaths("@y-core/forge/ui/core- the component library", true)).toEqual(["./ui/core"]);
  });
});

describe("findSubpathCitations() — what the citation is doing", () => {
  const kinds = (source: string) => findSubpathCitations(source, PKG, { strict: true }).map((c) => `${c.subpath}:${c.kind}`);

  it("classifies a table row as listing, not binding", () => {
    expect(kinds("| `@y-core/forge/router` | `src/router/mod.ts` | route helpers |")).toEqual(["./router:table"]);
  });

  it("classifies an indented table row as a table row, because a nested table is still a table", () => {
    expect(kinds("  | `@y-core/forge/router` | route helpers |")).toEqual(["./router:table"]);
  });

  it("classifies a prose sentence as binding", () => {
    expect(kinds("A new browser controller goes to `@y-core/forge/ui/client`.")).toEqual(["./ui/client:prose"]);
  });

  it("classifies a list item as prose, so a bulleted rule binds", () => {
    expect(kinds("- HTTP output belongs in `@y-core/forge/http`.")).toEqual(["./http:prose"]);
  });

  it("reports both kinds when one subpath is listed in a table and bound in prose", () => {
    const source = ["| `@y-core/forge/http` | `src/http/mod.ts` |", "", "Every HTTP output concern goes to `@y-core/forge/http`."].join("\n");

    expect(kinds(source)).toEqual(["./http:table", "./http:prose"]);
  });
});
