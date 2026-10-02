import type { PdfArtifact, PdfMarkedRun, PdfNode, PdfPage, PdfScopeFrame, PdfStructureElement, PdfStructureNode, PdfTag } from "./types";

// PDF names a fixed set of structure types and a reader keys its behaviour off them, so a tag with
// no entry here is decoration — which is what keeps a rule out of the reading order.
const TYPES: Readonly<Partial<Record<PdfTag, string>>> = {
  title: "H1",
  subtitle: "H2",
  heading: "H1",
  subheading: "H2",
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
  // Furniture has no structure type whatever its tag says, which is what keeps a running footer's
  // "Page 2 of 8" out of the middle of the prose.
  if (node.artifact !== undefined) return undefined;
  const type = structureType(node.tag);
  if (type === undefined) return undefined;
  // Inside a list item a box is not a picture and the words are not a paragraph: the box is the
  // item's label, which is the one place its ticked state is told rather than drawn.
  if (node.scope?.at(-1)?.kind === "item") return node.tag === "mark" ? "Lbl" : "LBody";
  return isFigure(type) && node.alt === undefined ? undefined : type;
}

const ARTIFACTS: Readonly<Record<PdfArtifact, string>> = { pagination: "Pagination" };

/** The bracket a run opens in the content stream, which is where a reader is told to skip it. @internal */
export function markedBracket(run: PdfMarkedRun): string {
  if (run.type !== undefined) return `/${run.type} << /MCID ${run.mcid} >> BDC`;
  // A bare `BMC` cannot carry a subtype, so furniture takes the dictionary form and decoration —
  // a rule, a drawing with no alternate text — keeps the bare one.
  return run.artifact === undefined ? "/Artifact BMC" : `/Artifact << /Type /${ARTIFACTS[run.artifact]} >> BDC`;
}

/** One page's nodes grouped into the runs a reader announces, in the order they are painted. @internal */
export function markedRuns(page: PdfPage): readonly PdfMarkedRun[] {
  const runs: PdfMarkedRun[] = [];
  let open: PdfTag | undefined;
  page.nodes.forEach((node, at) => {
    const type = typeOf(node);
    const last = runs.at(-1);
    // Grouped by tag rather than type — a label and its answer are two things despite both being
    // `P` — and by link index, without which two adjacent links merge and the second loses its element.
    if (
      last !== undefined &&
      open === node.tag &&
      last.alt === node.alt &&
      last.scope === node.scope &&
      last.artifact === node.artifact &&
      last.link === node.link
    ) {
      last.to = at;
      return;
    }
    open = node.tag;
    runs.push({
      type,
      from: at,
      to: at,
      mcid: type === undefined ? -1 : 0,
      ...(node.alt === undefined ? {} : { alt: node.alt }),
      ...(node.scope === undefined ? {} : { scope: node.scope }),
      ...(node.artifact === undefined ? {} : { artifact: node.artifact }),
      ...(node.link === undefined ? {} : { link: node.link }),
    });
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
          ...(run.scope === undefined ? {} : { scope: run.scope }),
          ...(run.link === undefined ? {} : { link: run.link }),
        };
      }),
  );
}

const CONTAINERS: Readonly<Record<PdfScopeFrame["kind"], string>> = {
  cell: "TD",
  document: "Document",
  item: "LI",
  list: "L",
  row: "TR",
  sect: "Sect",
  table: "Table",
};

const HEADINGS: Readonly<Record<string, number>> = { H1: 1, H2: 2 };

// An attribute object rather than a bare key, which is the form PDF defines for both of these: a
// header cell says which way it governs, and a list says it is not numbered.
const ATTRIBUTES: Readonly<Partial<Record<string, string>>> = {
  L: "/A << /O /List /ListNumbering /None >>",
  TH: "/A << /O /Table /Scope /Column >>",
};

/** The structure type one open grouping becomes, with the attribute object that type takes. @internal */
export function containerOf(frame: PdfScopeFrame): { type: string; attributes?: string } {
  const type = frame.kind === "cell" && frame.header === true ? "TH" : CONTAINERS[frame.kind];
  const attributes = ATTRIBUTES[type];
  return attributes === undefined ? { type } : { type, attributes };
}

// A longest-common-prefix walk over leaves already in paint order, which is what makes reading order
// paint order by construction rather than by a sort that could disagree with the content stream.
/** Every leaf nested under the containers its scope names, in the order the leaves were painted. @internal */
export function nestElements(leaves: readonly PdfStructureElement[]): PdfStructureNode[] {
  const roots: PdfStructureNode[] = [];
  const open: PdfScopeFrame[] = [];
  const lists: PdfStructureNode[][] = [roots];
  for (const leaf of leaves) {
    const scope = leaf.scope ?? [];
    let common = 0;
    while (common < open.length && common < scope.length && open[common] === scope[common]) common += 1;
    open.length = common;
    lists.length = common + 1;
    for (const frame of scope.slice(common)) {
      const node: PdfStructureNode = { ...containerOf(frame), children: [] };
      lists[lists.length - 1]?.push(node);
      open.push(frame);
      lists.push(node.children);
    }
    const { scope: _grouping, ...rest } = leaf;
    lists[lists.length - 1]?.push({ ...rest, children: [] });
  }
  return roots;
}

// A heading opens a section and closes every section at or below its own level, so the nesting is
// the document's own outline rather than a second structure someone has to keep in step with it.
/** The nodes regrouped so each heading owns the run that follows it. @internal */
export function sectioned(nodes: readonly PdfStructureNode[]): PdfStructureNode[] {
  const roots: PdfStructureNode[] = [];
  const open: PdfStructureNode[] = [];
  for (const node of nodes) {
    const level = HEADINGS[node.type];
    if (level === undefined) {
      (open.at(-1)?.children ?? roots).push(node);
      continue;
    }
    while (open.length >= level) open.pop();
    const sect: PdfStructureNode = { type: "Sect", children: [node] };
    (open.at(-1)?.children ?? roots).push(sect);
    open.push(sect);
  }
  return roots;
}

/** The whole nested tree a document declares, rooted in the one `/Document` UA-1 requires. @internal */
export function structureTreeOf(pages: readonly PdfPage[]): PdfStructureNode {
  return { type: "Document", children: sectioned(nestElements(structureElements(pages))) };
}
