import { describe, expect, test } from "bun:test";

import { Divider, PageBreak, Text } from "./components";
import { parsePdfObjects } from "./conform/parse.fixture";
import { Heading } from "./form";
import { Path } from "./graphics";
import { Link } from "./link";
import { createPdfPen } from "./path";
import { createPdfRenderer } from "./renderer";
import type { PdfDocument } from "./types";

// Read back through the conformance parser rather than by regex over the bytes, because the
// compressed leg packs every one of these dictionaries into an `/ObjStm` where no regex reaches it.
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
  /** Every leaf element reachable from the `/StructTreeRoot`, however deeply it is nested. */
  leaves: number[];
  /** What the `/StructTreeRoot` lists directly, which UA-1 requires to be one `/Document`. */
  rootKids: number[];
}

async function extract(bytes: Uint8Array<ArrayBuffer>): Promise<Extracted> {
  const parsed = await parsePdfObjects(bytes);
  const objects = new Map([...parsed.objects].map(([id, object]) => [id, object.dict]));
  const body = (id: number | undefined): string => (id === undefined ? "" : (objects.get(id) ?? ""));
  const streamOf = (id: number | undefined): string => (id === undefined ? "" : decoder.decode(parsed.objects.get(id)?.stream));
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
    const stream = streamOf(reference(page, "Contents"));
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

  // A leaf is an element marking content; a container's `/K` is nothing but references to its
  // children, so the walk stops where `/K` names a marked-content id rather than an object.
  const leaves: number[] = [];
  const walk = (id: number): void => {
    const element = objects.get(id) ?? "";
    if (!element.includes("/K [") || /\/K \[\d+ <</.test(element)) {
      leaves.push(id);
      return;
    }
    for (const kid of (/\/K \[([^\]]*)\]/.exec(element)?.[1] ?? "").matchAll(/(\d+) 0 R/g)) walk(Number(kid[1]));
  };
  for (const kid of rootKids) walk(kid);
  return { objects, pages, parents, mcids, nums, leaves, rootKids };
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
  for (const id of found.leaves) if (!reached.has(id)) failures.push(`element ${id} is a leaf of the tree but no marked run reaches it`);
  for (const [key, listed] of found.nums)
    for (const id of listed) if (!found.leaves.includes(id)) failures.push(`element ${id} under key ${key} is not a leaf of the tree`);
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

async function renderedDocument(compress = false): Promise<Uint8Array<ArrayBuffer>> {
  const rendered = await createPdfRenderer({ tagged: true, compress }).render(DOC);
  if (!rendered.ok) throw new Error(rendered.error.message);
  return rendered.data;
}

// Both legs, because the compressed one is where a packing bug would land: every element moves into
// a container, and a tree that resolved by file offset would resolve to nothing there.
const LEGS = [false, true];

describe("a marked run and the element that owns it point at each other", () => {
  test("the fixture is the one that can exhibit drift: more than one page, a link on each", async () => {
    for (const compress of LEGS) {
      const found = await extract(await renderedDocument(compress));
      expect(found.pages.length).toBeGreaterThan(1);
      expect([...found.objects.values()].filter((object) => object.includes("/S /Link")).length).toBe(2);
      expect([...found.objects.values()].some((object) => object.includes("/S /Figure"))).toBe(true);
    }
  });

  test("every /MCID resolves through its page's /StructParents key to the element at that offset", async () => {
    for (const compress of LEGS) expect(closureFailures(await extract(await renderedDocument(compress)))).toEqual([]);
  });

  test("no element is unreachable from the root, and no marked run is orphaned", async () => {
    for (const compress of LEGS) {
      const found = await extract(await renderedDocument(compress));
      const listed = [...found.nums.values()].flat();
      expect(listed.length).toBe(found.leaves.length);
      expect([...found.mcids.values()].flat().length).toBe(found.leaves.length);
    }
  });

  test("a page's marked ids are the whole run 0..n, so no offset in its array goes unused", async () => {
    for (const compress of LEGS) {
      const found = await extract(await renderedDocument(compress));
      for (const page of found.pages) {
        const ids = found.mcids.get(page) ?? [];
        expect(ids).toEqual(ids.map((_id, at) => at));
      }
    }
  });
});

// Without this the assertion above is an aspiration: a helper that never rejects anything passes a
// drifted file as happily as a sound one. Mutating as text keeps these on the uncompressed leg.
describe("the closure check rejects a tree whose order has been transposed", () => {
  test("swapping two element numbers inside one page's /Nums array is caught", async () => {
    const file = decoder.decode(await renderedDocument());
    const transposed = file.replace(/\/Nums \[0 \[(\d+) 0 R (\d+) 0 R/, "/Nums [0 [$2 0 R $1 0 R");
    expect(transposed).not.toBe(file);
    expect(closureFailures(await extract(Uint8Array.from(transposed, (character) => character.charCodeAt(0))))).not.toEqual([]);
  });

  test("pointing a page's key at another page's array is caught", async () => {
    const file = decoder.decode(await renderedDocument());
    const moved = file.replace(/\/StructParents 0 /, "/StructParents 1 ");
    expect(moved).not.toBe(file);
    expect(closureFailures(await extract(Uint8Array.from(moved, (character) => character.charCodeAt(0))))).not.toEqual([]);
  });
});

/** The types of the tree's leaves, depth first — which is the order a reader announces them in. */
function readingOrder(found: Extracted): { type: string; mcid: number }[] {
  return found.leaves.map((id) => {
    const element = found.objects.get(id) ?? "";
    return { type: /\/S \/(\w+)/.exec(element)?.[1] ?? "", mcid: markOf(element) ?? -1 };
  });
}

describe("the tree is rooted and nested as UA-1 requires", () => {
  test("the root lists exactly one /Document, and declares the next parent-tree key", async () => {
    for (const compress of LEGS) {
      const found = await extract(await renderedDocument(compress));
      expect(found.rootKids).toHaveLength(1);
      expect(found.objects.get(found.rootKids[0] ?? 0)).toContain("/S /Document");
      // Past every key issued, which is more than one per page once an annotation takes one too.
      const declared = Number(/\/ParentTreeNextKey (\d+)/.exec([...found.objects.values()].join("\n"))?.[1]);
      expect(declared).toBeGreaterThanOrEqual(found.pages.length);
    }
  });

  test("a heading opens a section, and the section spanning a page break keeps its leaves on their own pages", async () => {
    const found = await extract(await renderedDocument());
    const sects = [...found.objects.values()].filter((object) => object.includes("/S /Sect"));
    expect(sects.length).toBeGreaterThan(1);
    // The fixture's second heading opens on page two, so a leaf's `/Pg` is its own page and never
    // the one its section began on — which is the claim a container spanning pages has to honour.
    for (const page of found.pages) {
      for (const mcid of found.mcids.get(page) ?? []) {
        expect(found.objects.get(found.nums.get(found.parents.get(page) ?? 0)?.[mcid] ?? 0)).toContain(`/Pg ${page} 0 R`);
      }
    }
  });

  // Nesting is the one change that could reorder what a reader hears while leaving every other
  // assertion here green, so the flattened tree is held against the stream that painted it.
  test("the flattened reading order is the paint order of the display list", async () => {
    for (const compress of LEGS) {
      const found = await extract(await renderedDocument(compress));
      const painted = found.pages.flatMap((page) => (found.mcids.get(page) ?? []).map((mcid) => ({ page, mcid })));
      const announced = readingOrder(found);
      expect(announced.map((leaf) => leaf.mcid)).toEqual(painted.map((run) => run.mcid));
    }
  });
});

describe("a heading level is the one the component was given", () => {
  test("Heading level 1 is an H1 and level 2 an H2, with no level skipped between them", async () => {
    const rendered = await createPdfRenderer({ tagged: true, compress: false }).render({
      title: "Declaration",
      content: [Heading({ children: "Part A" }), Heading({ level: 2, children: "Contact" }), Text({ children: "A line." })],
    });
    if (!rendered.ok) throw new Error(rendered.error.message);
    const found = await extract(rendered.data);
    const levels = readingOrder(found)
      .map((leaf) => /^H(\d)$/.exec(leaf.type)?.[1])
      .filter((level): level is string => level !== undefined)
      .map(Number);
    expect(levels).toEqual([1, 1, 2]);
    expect(levels.every((level, at) => at === 0 || level <= (levels[at - 1] ?? 0) + 1)).toBe(true);
  });
});
