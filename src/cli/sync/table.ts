import { BORDERS } from "../term/border";
import type { Colorize } from "../term/color";
import { PLAIN } from "../term/color";
import { type GridColumn, renderGrid } from "../term/grid";
import { wrapLines } from "../term/wrap";

export type TableRow = Record<string, string>;

/**
 * The border every grid here draws.
 *
 * Box-drawing rather than pipes and hyphens: a section is a closed shape, so where it starts and
 * ends is visible without counting rules, and the corners distinguish a table from the prose
 * around it at a glance. `stringWidth` measures U+2500–257F as one column each, which is what lets
 * the engine lay out its own border correctly.
 */
const BORDER = BORDERS.single;

/** What a section's note, grid and footers are all inset by, so they read as one block. */
const INDENT = "  ";

/** How to render a grid: what to style it with, and what it has to fit in. */
export interface TableOptions {
  /** Styler for the headings. Defaults to `PLAIN`, so output carries no escape sequence unless asked. */
  style?: Colorize;
  /**
   * Columns the grid must fit in. Omitted, it is as wide as its content — which is what every
   * existing caller expects, and what a test asserting exact lines depends on.
   */
  width?: number;
  /**
   * Columns permitted to wrap onto further lines when `width` forces a shrink. Everything else is
   * truncated instead, because a binding name broken across two lines is no longer a name you can
   * search for.
   */
  wrap?: readonly string[];
}

/** One heading, an optional one-line rule that governs every row under it, and the rows. */
export interface TableSection {
  title: string;
  note?: string;
  rows: TableRow[];
  /**
   * Lines printed under the grid — remarks about the section rather than about any
   * binding in it. A statement like "there is no .dev.vars here" is not a row: giving
   * it one means inventing a binding name and an action to put in the columns, and
   * both would be fiction.
   */
  footers?: string[];
}

/**
 * The title on a line of its own, and the note grey beneath it.
 *
 * Two lines rather than one sentence, because they answer different questions: the title says
 * which section this is, and the note says what rule governs every row in it. Run together, the
 * title stopped being findable — it was the first few words of a paragraph that routinely ran past
 * the window. Grey and indented to the grid, the note reads as belonging to the section without
 * competing with either the heading above it or the data below.
 */
function heading(section: TableSection, style: Colorize, width: number | undefined): string[] {
  const title = style.bold(section.title);
  if (!section.note) return [title];
  // Wrapped to the width less its own indent, so it stops where the grid does rather than two
  // columns past it.
  const lines = width === undefined ? [section.note] : wrapLines(section.note, Math.max(1, width - INDENT.length));
  return [title, ...lines.map((line) => `${INDENT}${style.gray(line)}`)];
}

/** The column spec for one grid: row 0's key order, with the named columns marked as wrapping. */
function columnsOf(rows: readonly TableRow[], wrap: readonly string[]): GridColumn[] {
  return Object.keys(rows[0] ?? {}).map((key) => (wrap.includes(key) ? { key, wrap: true } : { key }));
}

/**
 * Render one grid on its own, with no heading above it.
 *
 * Ruled verticals rather than alignment alone, because a cell here routinely contains spaces — a
 * detail, a `"old" → "new"` pair — and with only whitespace between columns the reader has to
 * guess where one ends. The rule under the header separates the column names from the data.
 */
export function renderTable(rows: TableRow[], options: TableOptions = {}): string {
  return renderGrid(rows, {
    border: BORDER,
    columns: columnsOf(rows, options.wrap ?? []),
    ...(options.width === undefined ? {} : { maxWidth: options.width }),
  }).join("\n");
}

/**
 * Render several grids, each under its own heading.
 *
 * Widths are computed per section — one `renderGrid` call each — so a long value in one does not
 * stretch the columns of another: the sections are separate answers, not one table with headings
 * interleaved. A column empty across a whole section is dropped from that section alone, for the
 * same reason. A section with no rows is omitted entirely.
 */
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
