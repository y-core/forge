import { BORDERS } from "../term/border";
import { PLAIN } from "../term/color";
import { renderGrid } from "../term/grid";
import type { Colorize } from "../term/types";
import type { GridColumn } from "../term/types";
import { wrapLines } from "../term/wrap";
import type { TableOptions, TableRow, TableSection } from "./types";

const BORDER = BORDERS.single;

/** What a section's note, grid and footers are all inset by, so they read as one block. */
const INDENT = "  ";

/** Renders a section title on its own line, with its note dimmed beneath it. */
function heading(section: TableSection, style: Colorize, width: number | undefined): string[] {
  const title = style.bold(section.title);
  if (!section.note) return [title];
  const lines = width === undefined ? [section.note] : wrapLines(section.note, Math.max(1, width - INDENT.length));
  return [title, ...lines.map((line) => `${INDENT}${style.gray(line)}`)];
}

/** The column spec for one grid: row 0's key order, with the named columns marked as wrapping. */
function columnsOf(rows: readonly TableRow[], wrap: readonly string[]): GridColumn[] {
  return Object.keys(rows[0] ?? {}).map((key) => (wrap.includes(key) ? { key, wrap: true } : { key }));
}

/** Renders one grid on its own, with no heading above it. */
export function renderTable(rows: TableRow[], options: TableOptions = {}): string {
  return renderGrid(rows, {
    border: BORDER,
    columns: columnsOf(rows, options.wrap ?? []),
    ...(options.width === undefined ? {} : { maxWidth: options.width }),
  }).join("\n");
}

/** Renders several grids, each under its own heading and with its own column widths. */
export function renderSections(sections: TableSection[], options: TableOptions = {}): string {
  const style = options.style ?? PLAIN;
  const blocks: string[] = [];

  for (const section of sections) {
    const lines = renderGrid(section.rows, {
      border: BORDER,
      columns: columnsOf(section.rows, options.wrap ?? []),
      indent: 2,
      // The indent is inside the width the grid is given, so a section shrinks to the window
      // rather than to the window plus two.
      ...(options.width === undefined ? {} : { maxWidth: options.width }),
    });
    const footers = (section.footers ?? []).map((line) => `${INDENT}${line}`);
    // A section with only a footer still prints: "we looked and found nothing" is the
    // one thing an omitted section cannot say.
    if (lines.length === 0 && footers.length === 0) continue;

    blocks.push([...heading(section, style, options.width), ...lines, ...footers].join("\n"));
  }

  return blocks.join("\n\n");
}
