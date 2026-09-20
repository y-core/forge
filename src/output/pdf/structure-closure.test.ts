import { describe, expect, test } from "bun:test";

import { Divider, PageBreak, Text } from "./components";
import { Heading } from "./form";
import { Path } from "./graphics";
import { Link } from "./link";
import { createPdfPen } from "./path";
import { createPdfRenderer } from "./renderer";
import type { PdfDocument } from "./types";

// This namespace writes PDF and never reads one, so the file is reached by extraction rather than by
// a parser: the assertions below need four objects out of it, not a document model.
const decoder = new TextDecoder("latin1");

interface Extracted {
  /** Every object's body, by the number a reference names it with. */
  objects: Map<number, string>;
  /** Each page object's number, in document order. */
  pages: number[];
  /** The `/StructParents` key each page declares, by page object number. */
  parents: Map<number, number>;
  /** The marked-content ids a page's content stream opens, in the order it opens them. */
  mcids: Map<number, number[]>;
  /** The `StructElem` numbers a `/StructParents` key resolves to, in `/Nums` order. */
  nums: Map<number, number[]>;
  /** Every element the `/StructTreeRoot` lists as a kid. */
  rootKids: number[];
}

function extract(bytes: Uint8Array): Extracted {
  const file = decoder.decode(bytes);
  const objects = new Map([...file.matchAll(/(\d+) 0 obj\n([\S\s]*?)\nendobj/g)].map((found) => [Number(found[1]), found[2] ?? ""]));
  const body = (id: number | undefined): string => (id === undefined ? "" : (objects.get(id) ?? ""));
  const reference = (from: string, key: string): number | undefined => {
    const found = new RegExp(`/${key} (\\d+) 0 R`).exec(from)?.[1];
    return found === undefined ? undefined : Number(found);
  };

  const pages: number[] = [];
  const parents = new Map<number, number>();
  const mcids = new Map<number, number[]>();
  for (const [id, page] of objects) {
    if (!page.startsWith("<< /Type /Page ")) continue;
    pages.push(id);
    const key = /\/StructParents (\d+)/.exec(page)?.[1];
    if (key !== undefined) parents.set(id, Number(key));
    const stream = body(reference(page, "Contents"));
    mcids.set(
      id,
      [...stream.matchAll(/\/MCID (\d+) >> BDC/g)].map((found) => Number(found[1])),
    );
  }
  pages.sort((a, b) => a - b);

  const catalog = [...objects.values()].find((object) => object.startsWith("<< /Type /Catalog"));
  const root = body(reference(catalog ?? "", "StructTreeRoot"));
  const tree = body(reference(root, "ParentTree"));
  const nums = new Map(
    [...tree.matchAll(/(\d+) \[([^\]]*)\]/g)].map((found) => [
      Number(found[1]),
      [...(found[2] ?? "").matchAll(/(\d+) 0 R/g)].map((listed) => Number(listed[1])),
    ]),
  );
  const rootKids = [...(/\/K \[([^\]]*)\]/.exec(root)?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((found) => Number(found[1]));
  return { objects, pages, parents, mcids, nums, rootKids };
}

/** The marked-content id an element's `/K` carries, whichever of its two shapes the element is in. */
function markOf(element: string): number | undefined {
  // A link's kids are `[n << /Type /OBJR … >>]` and everything else's are a bare `n`, so a pattern
  // written for one shape silently skips the other — and the link leg is the one that drifts.
  const found = /\/K \[?(\d+)/.exec(element)?.[1];
  return found === undefined ? undefined : Number(found);
}

/** Every way a marked run and the element that owns it fail to point at each other. */
function closureFailures(found: Extracted): string[] {
  const failures: string[] = [];
  const reached = new Set<number>();
  for (const page of found.pages) {
    const key = found.parents.get(page);
    if (key === undefined) {
      failures.push(`page ${page} declares no /StructParents`);
      continue;
    }
    const listed = found.nums.get(key) ?? [];
    for (const mcid of found.mcids.get(page) ?? []) {
      // The invariant is positional: a reader finds the element for `/MCID n` at offset n of the
      // array its page's key resolves to. An existence check passes straight through a transposition.
      const id = listed[mcid];
      if (id === undefined) {
        failures.push(`page ${page}: /MCID ${mcid} has no element at offset ${mcid} of /Nums ${key}`);
        continue;
      }
      reached.add(id);
      const element = found.objects.get(id) ?? "";
      if (markOf(element) !== mcid) failures.push(`page ${page}: element ${id} at offset ${mcid} marks ${String(markOf(element))}`);
      if (!element.includes(`/Pg ${page} 0 R`)) failures.push(`page ${page}: element ${id} names another page`);
    }
  }
  for (const id of found.rootKids) if (!reached.has(id)) failures.push(`element ${id} is listed by the root but no marked run reaches it`);
  for (const [key, listed] of found.nums)
    for (const id of listed) if (!found.rootKids.includes(id)) failures.push(`element ${id} under key ${key} is not a kid of the root`);
  return failures;
}

const pen = createPdfPen().move(0, 0).line(40, 0).line(40, 20).close();

// More than one page, because a single page cannot exhibit the index drift this closes; and one of
// each leg that indexes separately — a link, an artifact, and a drawing a reader announces.
const DOC: PdfDocument = {
  title: "Declaration of interest",
  content: [
    Heading({ children: "Declaration of interest" }),
    Text({ children: "The undersigned declares the following interests." }),
    Path({ commands: pen.commands(), height: 20, alt: "The Meridian mark", stroke: [0, 0, 0] }),
    Divider(),
    Link({ to: { uri: "https://example.test/terms" }, children: [Text({ children: "the terms of this declaration" })] }),
    PageBreak(),
    Heading({ children: "Interests" }),
    Link({ to: { uri: "https://example.test/register" }, children: [Text({ children: "the public register" })] }),
    Text({ children: "No further interest is declared." }),
    Divider(),
  ],
};

async function renderedDocument(): Promise<Uint8Array> {
  const rendered = await createPdfRenderer({ tagged: true, compress: false }).render(DOC);
  if (!rendered.ok) throw new Error(rendered.error.message);
  return rendered.data;
}

describe("a marked run and the element that owns it point at each other", () => {
  test("the fixture is the one that can exhibit drift: more than one page, a link on each", async () => {
    const found = extract(await renderedDocument());
    expect(found.pages.length).toBeGreaterThan(1);
    expect([...found.objects.values()].filter((object) => object.includes("/S /Link")).length).toBe(2);
    expect([...found.objects.values()].some((object) => object.includes("/S /Figure"))).toBe(true);
  });

  test("every /MCID resolves through its page's /StructParents key to the element at that offset", async () => {
    expect(closureFailures(extract(await renderedDocument()))).toEqual([]);
  });

  test("no element is unreachable from the root, and no marked run is orphaned", async () => {
    const found = extract(await renderedDocument());
    const listed = [...found.nums.values()].flat();
    expect(listed.length).toBe(found.rootKids.length);
    expect([...found.mcids.values()].flat().length).toBe(found.rootKids.length);
  });

  test("a page's marked ids are the whole run 0..n, so no offset in its array goes unused", async () => {
    const found = extract(await renderedDocument());
    for (const page of found.pages) {
      const ids = found.mcids.get(page) ?? [];
      expect(ids).toEqual(ids.map((_id, at) => at));
    }
  });
});

// Without this the assertion above is an aspiration: a helper that never rejects anything passes a
// file whose legs have drifted just as happily as one whose legs have not.
describe("the closure check rejects a tree whose order has been transposed", () => {
  test("swapping two element numbers inside one page's /Nums array is caught", async () => {
    const file = decoder.decode(await renderedDocument());
    const transposed = file.replace(/\/Nums \[0 \[(\d+) 0 R (\d+) 0 R/, "/Nums [0 [$2 0 R $1 0 R");
    expect(transposed).not.toBe(file);
    expect(closureFailures(extract(Uint8Array.from(transposed, (character) => character.charCodeAt(0))))).not.toEqual([]);
  });

  test("pointing a page's key at another page's array is caught", async () => {
    const file = decoder.decode(await renderedDocument());
    const moved = file.replace(/\/StructParents 0 /, "/StructParents 1 ");
    expect(moved).not.toBe(file);
    expect(closureFailures(extract(Uint8Array.from(moved, (character) => character.charCodeAt(0))))).not.toEqual([]);
  });
});
