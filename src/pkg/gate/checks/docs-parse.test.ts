import { describe, expect, it } from "bun:test";
import pkg from "../../../../package.json" with { type: "json" };
import { findSubpathCitations, type SubpathCitation, uncitedSubpaths } from "./docs-parse";

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

    expect(cited).toEqual([{ line: 1, raw: "/render", subpath: "./render" }]);
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

function cite(...subpaths: string[]): SubpathCitation[] {
  return subpaths.map((subpath, i) => ({ line: i + 1, raw: subpath.slice(1), subpath }));
}

describe("uncitedSubpaths() — the coverage direction", () => {
  it("returns nothing when every published subpath is cited", () => {
    expect(uncitedSubpaths(["./http", "./result"], cite("./http", "./result"), new Set())).toEqual([]);
  });

  it("returns an uncited subpath that no exemption licenses", () => {
    expect(uncitedSubpaths(["./http", "./result"], cite("./http"), new Set())).toEqual(["./result"]);
  });

  it("returns nothing for a subpath that is uncited but exempt", () => {
    expect(uncitedSubpaths(["./http", "./jsx/register"], cite("./http"), new Set(["./jsx/register"]))).toEqual([]);
  });

  it("sorts several uncited subpaths, so the failure order is stable", () => {
    const published = ["./ui/core", "./app", "./storage/kv", "./result"];

    expect(uncitedSubpaths(published, cite(), new Set())).toEqual(["./app", "./result", "./storage/kv", "./ui/core"]);
  });

  it("reports a subpath once when it is both cited and exempt, never twice", () => {
    expect(uncitedSubpaths(["./jsx/register"], cite("./jsx/register"), new Set(["./jsx/register"]))).toEqual([]);
  });

  it("returns every non-exempt subpath when the document cites none", () => {
    const published = ["./app", "./http", "./jsx/register"];

    expect(uncitedSubpaths(published, [], new Set(["./jsx/register"]))).toEqual(["./app", "./http"]);
  });

  it("ignores an exemption for a subpath that is not published at all", () => {
    expect(uncitedSubpaths(["./http"], cite(), new Set(["./retired", "./http"]))).toEqual([]);
  });

  it("composes with the scanner, reading citations out of a document as written", () => {
    const readme = [
      "# forge",
      "",
      "| Subpath | Purpose |",
      "| `@y-core/forge/http` | Response builders |",
      "",
      "**[`@y-core/forge/result`](src/result/README.md)** — the one `Result` primitive.",
    ].join("\n");
    const citations = findSubpathCitations(readme, PKG, { strict: true });

    expect(uncitedSubpaths(["./http", "./result", "./session"], citations, new Set())).toEqual(["./session"]);
  });
});

describe("uncitedSubpaths() — the exemption guard, in both directions", () => {
  const published = ["./http", "./jsx/jsx-runtime"];
  const citations = cite("./http");

  it("suppresses the row while the subpath is exempt", () => {
    expect(uncitedSubpaths(published, citations, new Set(["./jsx/jsx-runtime"]))).toEqual([]);
  });

  it("reinstates the row the moment the subpath leaves the exemption set", () => {
    expect(uncitedSubpaths(published, citations, new Set())).toEqual(["./jsx/jsx-runtime"]);
  });
});

describe("uncitedSubpaths() — the boundary the caller owns", () => {
  const exportKeys = Object.keys((pkg as { exports: Record<string, unknown> }).exports);
  const exact = exportKeys.filter((key) => !key.includes("*"));

  it("drops every starred key from the caller's set", () => {
    expect(exact.filter((key) => key.includes("*"))).toEqual([]);
  });

  it("keeps every exact key, so the filter narrows nothing else", () => {
    expect(exact).toEqual(exportKeys.filter((key) => !key.includes("*")));
    expect(exportKeys.length - exact.length).toBe(exportKeys.filter((key) => key.includes("*")).length);
  });

  it("has at least one starred key to drop, so the case above cannot pass vacuously", () => {
    expect(exportKeys.filter((key) => key.includes("*")).length).toBeGreaterThan(0);
  });

  it("never returns a pattern key, because none reaches the function", () => {
    expect(uncitedSubpaths(exact, cite(), new Set()).filter((subpath) => subpath.includes("*"))).toEqual([]);
  });
});
