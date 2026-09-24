import type { PdfBox, PdfBreakLimits, PdfCursor, PdfElement, PdfFragment } from "./types";

// Deciding the split before anything is painted is what keeps a placement final: an orphan rule
// applied afterwards would have to undo one, and undone placements are unreproducible bugs.
function splitAt(fragments: readonly PdfFragment[], y: number, bottom: number): number {
  let at = y;
  for (const [index, fragment] of fragments.entries()) {
    if (at + fragment.reserve > bottom) return index;
    at += fragment.advance;
  }
  return fragments.length;
}

// Where the break falls once the limits have moved it, or nothing where they do not apply.
function limitedSplit(fragments: readonly PdfFragment[], cursor: PdfCursor, box: PdfBox, orphans: number, widows: number): number | undefined {
  if (orphans === 0 && widows === 0) return undefined;
  const natural = splitAt(fragments, cursor.y, cursor.pageTop + box.height);
  if (natural >= fragments.length) return undefined;
  const carried = fragments.length - natural < widows ? fragments.length - widows : natural;
  return carried < orphans ? 0 : carried;
}

/** One element painted against the baseline the element before it left, breaking where it must. @internal */
export function place(cursor: PdfCursor, of: PdfElement, box: PdfBox, limits: PdfBreakLimits = {}): void {
  const fragments = of.fragments(box, cursor.typesetting);
  const orphans = limits.orphans ?? 0;
  const widows = limits.widows ?? 0;

  const split = limitedSplit(fragments, cursor, box, orphans, widows);
  if (split !== undefined) {
    for (const fragment of fragments.slice(0, split)) fragment.paint(cursor);
    // The rest are carried whole: opening the page here is what makes the limit hold, since leaving
    // them to `reserve` would put back exactly the lines the limit just moved.
    if (split > 0 || cursor.y > cursor.pageTop) cursor.newPage();
    for (const fragment of fragments.slice(split)) {
      cursor.reserve(fragment.reserve);
      fragment.paint(cursor);
    }
    return;
  }

  for (const fragment of fragments) {
    cursor.reserve(fragment.reserve);
    fragment.paint(cursor);
  }
}
