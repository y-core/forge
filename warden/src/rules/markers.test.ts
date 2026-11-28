import { afterAll, describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

import { gateFixtureRoot } from "../../../src/tooling/gate/checks/gate.fixture";
import type { SourceDoc } from "../types";
import { collectMarkers } from "./markers";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function scan(markdown: string, doc: Partial<SourceDoc> = {}) {
  const path = doc.path ?? "docs/RULES.md";
  const root = gateFixtureRoot({ [path]: markdown }, "warden-markers-");
  roots.push(root);
  return collectMarkers(root, [{ corpus: "project", path, file: join(root, path), weight: 1, ...doc }]);
}

function opens(markdown: string): boolean[] {
  return scan(["## 1. Rules", "", markdown].join("\n")).sites.map((site) => site.opensBlock);
}

describe("collectMarkers() — where a marker sits", () => {
  it("gives a marker the numbered section it sits under, and its line and file", () => {
    const { sites } = scan(["## 1. Rules", "", "### 1a. Colour", "", "<!-- rule:forge-colour --> Because tokens theme."].join("\n"));

    expect(sites).toEqual([
      {
        id: "forge-colour",
        corpus: "project",
        path: "docs/RULES.md",
        file: "docs/RULES.md",
        line: 5,
        section: "1a",
        opensBlock: true,
        block: "Because tokens theme.",
      },
    ]);
  });

  it("leaves the section undefined for a marker above the first numbered heading", () => {
    expect(scan(["# Rules", "", "<!-- rule:forge-colour --> Prose."].join("\n")).sites[0]?.section).toBeUndefined();
  });

  it("carries a canon document's tree and canon-relative path", () => {
    const root = gateFixtureRoot({ "canon/libs/TESTING.md": "## 3. Tests\n\n<!-- rule:libs-testing-x --> Prose.\n" }, "warden-markers-");
    roots.push(root);
    const doc: SourceDoc = { corpus: "canon", tree: "libs", path: "TESTING.md", file: join(root, "canon/libs/TESTING.md"), weight: 1.3 };

    expect(collectMarkers(root, [doc]).sites[0]).toMatchObject({
      corpus: "canon",
      tree: "libs",
      path: "TESTING.md",
      file: "canon/libs/TESTING.md",
    });
  });
});

describe("collectMarkers() — opensBlock", () => {
  it("is true for a marker opening a paragraph, and false for one after its first sentence", () => {
    expect(opens("<!-- rule:forge-a --> The rationale.")).toEqual([true]);
    expect(opens("**Never do a.** <!-- rule:forge-a --> The rationale.")).toEqual([false]);
  });

  it("is false for a marker on a paragraph's second line", () => {
    expect(opens(["The first line.", "<!-- rule:forge-a --> The second."].join("\n"))).toEqual([false]);
  });

  it("is true for a marker opening a list item, and false for one after its text", () => {
    expect(opens("- <!-- rule:forge-a --> The rationale.")).toEqual([true]);
    expect(opens("1. Never do a. <!-- rule:forge-a -->")).toEqual([false]);
  });

  it("is true for a marker opening a table cell, and false for one after the cell's text", () => {
    expect(opens("| Colour | <!-- rule:forge-a --> Tokens only |")).toEqual([true]);
    expect(opens("| Colour | Tokens only. <!-- rule:forge-a --> |")).toEqual([false]);
  });

  it("counts inline code as text, so a marker after a code span does not open its block", () => {
    expect(opens("| Wrong | `Toast` <!-- rule:forge-a --> |")).toEqual([false]);
    expect(opens("`Toast` is wrong. <!-- rule:forge-a -->")).toEqual([false]);
    expect(opens("- `Toast` <!-- rule:forge-a -->")).toEqual([false]);
  });

  it("lets two markers open one block together", () => {
    expect(opens("<!-- rule:forge-a --> <!-- rule:forge-b --> The rationale.")).toEqual([true, true]);
  });
});

function blocks(markdown: string): string[] {
  return scan(["## 1. Rules", "", markdown].join("\n")).sites.map((site) => site.block);
}

describe("collectMarkers() — block", () => {
  it("runs a paragraph's block to its blank line, joining its lines", () => {
    expect(blocks(["<!-- rule:forge-a --> The first line,", "and the second.", "", "Another paragraph."].join("\n"))).toEqual([
      "The first line, and the second.",
    ]);
  });

  it("ends a list item's block at the next item, and a table cell's at its pipe", () => {
    expect(blocks(["- <!-- rule:forge-a --> The first item", "  continued.", "- The second item."].join("\n"))).toEqual([
      "The first item continued.",
    ]);
    expect(blocks("| Colour | <!-- rule:forge-a --> Tokens only | Next cell |")).toEqual(["Tokens only"]);
  });

  it("drops code-span backticks, keeping the code", () => {
    expect(blocks("<!-- rule:forge-a --> Use `bg-card` here.")).toEqual(["Use bg-card here."]);
  });

  it("gives two markers opening one block together the same block", () => {
    expect(blocks("<!-- rule:forge-a --> <!-- rule:forge-b --> The rationale.")).toEqual(["The rationale.", "The rationale."]);
  });
});

describe("collectMarkers() — code", () => {
  it("skips a marker in a fence, in an indented block and in inline code", () => {
    const markdown = [
      "## 1. Rules",
      "",
      "```md",
      "<!-- rule:forge-fenced -->",
      "```",
      "",
      "    <!-- rule:forge-indented -->",
      "",
      "Write `<!-- rule:forge-inline -->` to mark one.",
      "",
      "<!-- rule:forge-real --> Prose.",
    ].join("\n");

    expect(scan(markdown).sites.map((site) => site.id)).toEqual(["forge-real"]);
  });

  it("reports a marker split across lines, and never as a site", () => {
    const { sites, split } = scan(["## 1. Rules", "", "Prose. <!--", "rule:forge-split --> More."].join("\n"));

    expect(sites).toEqual([]);
    expect(split).toEqual([{ id: "forge-split", file: "docs/RULES.md", line: 3 }]);
  });
});
