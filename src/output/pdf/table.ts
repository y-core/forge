import { resolveTracks, trackOffsets } from "./tracks";
import type { PdfBox, PdfCursor, PdfElement, PdfFragment, PdfTrack, PdfTypesetting, TableProps } from "./types";

interface Laid {
  boxes: PdfBox[];
  rowHeight(cells: readonly PdfElement[]): number;
  paintRow(cursor: PdfCursor, cells: readonly PdfElement[]): void;
}

// One resolution for the whole table, not one per row: a column that measured itself row by row
// would step in and out as the content changed, which is the defect a table exists to avoid.
function lay(box: PdfBox, tracks: readonly PdfTrack[], gap: number, set?: PdfTypesetting): Laid {
  const widths = resolveTracks(tracks, box.width, gap);
  const offsets = trackOffsets(widths, gap);
  const boxes = widths.map((width, index) => ({ x: box.x + (offsets[index] ?? 0), width, height: box.height }));
  const rowHeight = (cells: readonly PdfElement[]): number =>
    Math.max(...cells.map((cell, index) => cell.measure(boxes[index]?.width ?? box.width, set).height), 0);
  return {
    boxes,
    rowHeight,
    paintRow(cursor, cells) {
      const top = cursor.y;
      cells.forEach((cell, index) => {
        const own = boxes[index];
        if (own === undefined) return;
        cursor.y = top;
        for (const fragment of cell.fragments(own, set)) fragment.paint(cursor);
      });
      cursor.y = top + rowHeight(cells);
    },
  };
}

/** A grid whose columns agree across every row, whose header repeats, and whose rows never split. @public */
export function Table(props: TableProps): PdfElement {
  const gap = props.gap ?? 0;
  const columns = Math.max(props.header?.length ?? 0, ...props.rows.map((row) => row.length), 0);
  const tracks = props.tracks ?? Array.from({ length: columns }, () => 1);

  return {
    measure(width, set) {
      const laid = lay({ x: 0, width, height: Number.POSITIVE_INFINITY }, tracks, gap, set);
      const header = props.header === undefined ? 0 : laid.rowHeight(props.header);
      return {
        preferred: width,
        minimum: props.rows.flat().reduce((most, cell) => Math.max(most, cell.measure(width, set).minimum), 0),
        height: header + props.rows.reduce((total, row) => total + laid.rowHeight(row), 0),
      };
    },
    fragments(box, set) {
      const laid = lay(box, tracks, gap, set);
      const header = props.header;
      const headerHeight = header === undefined ? 0 : laid.rowHeight(header);
      const fragments: PdfFragment[] = [];
      let painted = -1;

      if (header !== undefined) {
        fragments.push({
          reserve: headerHeight + (laid.rowHeight(props.rows[0] ?? []) || 0),
          advance: headerHeight,
          paint(cursor) {
            painted = cursor.pages.length;
            laid.paintRow(cursor, header);
          },
        });
      }

      for (const row of props.rows) {
        const advance = laid.rowHeight(row);
        fragments.push({
          // A row moves whole: one reserve for the whole of it, so the break falls between rows.
          reserve: advance,
          advance,
          paint(cursor) {
            if (header !== undefined && cursor.pages.length !== painted) {
              painted = cursor.pages.length;
              laid.paintRow(cursor, header);
            }
            laid.paintRow(cursor, row);
          },
        });
      }
      return fragments;
    },
  };
}
