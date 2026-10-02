import { describe, expect, test } from "bun:test";

import { Stack } from "./components";
import { Field, Heading } from "./form";
import { paginate, paginateWithin } from "./paginate";
import type { PdfDocument, PdfElement, PdfLetterhead, PdfNode } from "./types";

const MARK: PdfLetterhead = { name: "Meridian", tagline: "Practice", email: "a@b.example", phone: "+27 21 555 0143" };

function runsOf(nodes: readonly PdfNode[]): string[] {
  return nodes.filter((node) => node.kind === "text").map((node) => node.run);
}

describe("front matter", () => {
  test("sets the title in capitals, ahead of everything else on the page", () => {
    const [page] = paginate({ title: "Declaration of interest", content: [] });
    expect(runsOf(page?.nodes ?? [])[0]).toBe("DECLARATION OF INTEREST");
  });

  test("omits an intro and a subtitle the document does not carry", () => {
    const [bare] = paginate({ title: "Declaration", content: [] });
    const [full] = paginate({ title: "Declaration", intro: "Complete in ink.", subtitle: "Section 21", content: [] });
    expect(runsOf(full?.nodes ?? []).length).toBeGreaterThan(runsOf(bare?.nodes ?? []).length);
    expect(runsOf(full?.nodes ?? [])).toContain("Complete in ink.");
    expect(runsOf(full?.nodes ?? [])).toContain("Section 21");
  });

  test("an intro rendered with no palette emits no ink operator at all, rather than a muted one", () => {
    const [page] = paginate({ title: "Declaration", intro: "Complete in ink.", content: [] });
    expect((page?.nodes ?? []).filter((node) => node.kind === "ink")).toEqual([]);
  });

  test("an intro takes the palette's ink where one names it, and resets the fill after itself", () => {
    const [page] = paginate({ title: "Declaration", intro: "Complete in ink.", content: [] }, { intro: [0.3, 0.3, 0.4] });
    const inks = (page?.nodes ?? []).filter((node) => node.kind === "ink");
    expect(inks.map((node) => node.ink)).toEqual([
      [0.3, 0.3, 0.4],
      [0, 0, 0],
    ]);
  });
});

describe("pagination", () => {
  function filled(rows: number): PdfElement[] {
    return Array.from({ length: rows }, () => Field({ fields: [{ label: "Surname", value: "Du Toit" }] }));
  }

  test("flows a document past the bottom margin onto a second page", () => {
    expect(paginate({ title: "Declaration", content: filled(4) })).toHaveLength(1);
    expect(paginate({ title: "Declaration", content: filled(60) }).length).toBeGreaterThan(1);
  });

  test("moves a section whole rather than orphaning its heading at the foot of a page", () => {
    const doc: PdfDocument = { title: "Declaration", content: [...filled(40), Heading({ children: "Part B" }), ...filled(6)] };
    const pages = paginate(doc);
    const headingPage = pages.findIndex((page) => runsOf(page.nodes).includes("PART B"));
    expect(runsOf(pages[headingPage]?.nodes ?? []).length).toBeGreaterThan(1);
  });

  // A wrapped heading kept its section break only at the top level, so putting a Stack around one
  // silently lost the break — and the wrapper is the ordinary way a section is given a gap.
  test("breaks for a heading a container opens with, exactly as it does for a bare one", () => {
    const opener = [...filled(40), Stack({ children: [Heading({ children: "Part B" }), ...filled(6)] })];
    const bare = paginate({ title: "Declaration", content: [...filled(40), Heading({ children: "Part B" }), ...filled(6)] });
    const wrapped = paginate({ title: "Declaration", content: opener });
    const pageOf = (pages: readonly { nodes: readonly PdfNode[] }[]): number => pages.findIndex((page) => runsOf(page.nodes).includes("PART B"));
    expect(pageOf(wrapped)).toBe(pageOf(bare));
    expect(runsOf(wrapped[pageOf(wrapped)]?.nodes ?? []).length).toBeGreaterThan(1);
  });

  test("does not break for a container that opens with body copy, whatever it holds further down", () => {
    const inner = [Heading({ children: "Part B" }), ...filled(6)];
    const opener = paginate({ title: "Declaration", content: [...filled(40), Stack({ children: inner })] });
    const body = paginate({ title: "Declaration", content: [...filled(40), Stack({ children: [...filled(1), ...inner] })] });
    expect(runsOf(opener[0]?.nodes ?? [])).not.toContain("PART B");
    expect(runsOf(body[0]?.nodes ?? []).length).toBeGreaterThan(runsOf(opener[0]?.nodes ?? []).length);
  });

  test("repeats the letterhead at the head of every page it opens", () => {
    const pages = paginate({ title: "Declaration", letterhead: MARK, content: filled(80) });
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(runsOf(page.nodes)).toContain("Meridian");
  });
});

// The claim is the work, not the answer: a document over the ceiling must stop being laid out there
// rather than be laid out whole and counted afterwards, so the assertions bound pages and nodes both.
describe("a ceiling stops pages being built rather than counting them afterwards", () => {
  const runaway = (): PdfDocument => ({
    title: "Declaration",
    content: Array.from({ length: 4000 }, () => Field({ fields: [{ label: "Surname", value: "Du Toit" }] })),
  });

  test("builds the ceiling's pages and no more, and says it had further to go", () => {
    const within = paginateWithin(runaway(), undefined, undefined, undefined, undefined, 3);
    expect(within.over).toBe(true);
    expect(within.pages).toHaveLength(3);
    expect(within.pages.reduce((total, page) => total + page.nodes.length, 0)).toBeLessThan(
      paginateWithin(runaway(), undefined, undefined, undefined, undefined, 4).pages.reduce((total, page) => total + page.nodes.length, 0),
    );
  });

  test("says nothing was left over where the document fits inside the ceiling", () => {
    const within = paginateWithin({ title: "Declaration", content: [] }, undefined, undefined, undefined, undefined, 3);
    expect(within.over).toBe(false);
    expect(within.pages).toHaveLength(1);
  });

  test("a cursor naming no ceiling opens as many pages as the document asks for", () => {
    expect(paginate(runaway()).length).toBeGreaterThan(3);
  });
});
