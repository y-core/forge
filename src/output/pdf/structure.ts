import type { PdfMarkedRun, PdfNode, PdfPage, PdfStructureElement, PdfTag } from "./types";

// PDF names a fixed set of structure types and a reader keys its behaviour off them, so a tag with
// no entry here is decoration — which is what keeps a rule out of the reading order.
const TYPES: Readonly<Partial<Record<PdfTag, string>>> = {
  title: "H1",
  subtitle: "H2",
  heading: "H2",
  intro: "P",
  note: "P",
  label: "P",
  value: "P",
  letterhead: "P",
  link: "Link",
  mark: "Figure",
  artwork: "Figure",
};

/** Whether a structure type carries its meaning in a drawing rather than in the type it sets. @internal */
function isFigure(type: string): boolean {
  return type === "Figure";
}

/** The structure type a tag becomes, or nothing where the tag is decoration. @internal */
export function structureType(tag: PdfTag): string | undefined {
  return TYPES[tag];
}

// A figure with no alternative text is a drawing a reader cannot announce, and a structure tree
// carrying one is worse than no entry at all — so it becomes an artifact instead of a silent gap.
function typeOf(node: PdfNode): string | undefined {
  const type = structureType(node.tag);
  if (type === undefined) return undefined;
  return isFigure(type) && node.alt === undefined ? undefined : type;
}

/** One page's nodes grouped into the runs a reader announces, in the order they are painted. @internal */
export function markedRuns(page: PdfPage): readonly PdfMarkedRun[] {
  const runs: PdfMarkedRun[] = [];
  let open: PdfTag | undefined;
  page.nodes.forEach((node, at) => {
    const type = typeOf(node);
    const last = runs.at(-1);
    // A run is grouped by tag rather than by type: a wrapped paragraph's lines share one tag and are
    // one thing to announce, while a label and the answer beside it are two despite both being `P`.
    if (last !== undefined && open === node.tag && last.alt === node.alt) {
      last.to = at;
      return;
    }
    open = node.tag;
    runs.push({ type, from: at, to: at, mcid: type === undefined ? -1 : 0, ...(node.alt === undefined ? {} : { alt: node.alt }) });
  });
  let mcid = 0;
  for (const run of runs) {
    if (run.type === undefined) continue;
    run.mcid = mcid;
    mcid += 1;
  }
  return runs;
}

// The run's own words, which an outline entry is titled with and a reader of the tree reads back.
function wordsOf(page: PdfPage, run: PdfMarkedRun): string | undefined {
  const runs = page.nodes.slice(run.from, run.to + 1).flatMap((node) => (node.kind === "text" ? [node.run] : []));
  return runs.length === 0 ? undefined : runs.join(" ");
}

/** Every structure element a document declares, each naming the page and the run it covers. @internal */
export function structureElements(pages: readonly PdfPage[]): readonly PdfStructureElement[] {
  return pages.flatMap((page, index) =>
    markedRuns(page)
      .filter((run) => run.type !== undefined)
      .map((run) => {
        const text = wordsOf(page, run);
        return {
          type: run.type ?? "P",
          page: index,
          mcid: run.mcid,
          ...(run.alt === undefined ? {} : { alt: run.alt }),
          ...(text === undefined ? {} : { text }),
        };
      }),
  );
}
