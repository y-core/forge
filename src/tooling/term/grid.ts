import { BORDERS } from "./border";
import type { BorderSlot, BorderStyle } from "./types";
import type { DefinitionEntry, DefinitionOptions, GridColumn, GridOptions } from "./types";
import { stringWidth, truncate } from "./width";
import { padAlign, wrapLines } from "./wrap";

function toColumn(spec: string | GridColumn): GridColumn {
  return typeof spec === "string" ? { key: spec } : spec;
}

function headerOf(column: GridColumn): string {
  return column.header ?? column.key;
}

/** The characters a line spends on borders, separators and padding — everything that is not a cell. */
function chromeWidth(count: number, border: BorderStyle, padding: number, gap: number): number {
  const vertical = border.bodyJoin.width > 0 ? border.bodyJoin.width : gap;
  const left = border.bodyLeft.width + padding;
  const right = padding + border.bodyRight.width;
  return left + right + (count - 1) * (padding + vertical + padding);
}

/** Narrowest a wrapping column is worth making: below about a word, wrapping stops being reading. */
const MIN_WRAP = 12;

/** Narrowest a truncating column is worth making: enough for a stem and the ellipsis. */
const MIN_FIXED = 4;

/** Shrinks the widest column still above its floor, repeatedly, until the grid fits `available`. */
function fit(natural: number[], columns: readonly GridColumn[], available: number): number[] {
  const widths = [...natural];
  let over = widths.reduce((sum, w) => sum + w, 0) - available;
  if (over <= 0) return widths;

  const floors = natural.map((width, i) => Math.min(width, columns[i]?.wrap === true ? MIN_WRAP : MIN_FIXED));

  while (over > 0) {
    let target = -1;
    for (let i = 0; i < widths.length; i++) {
      if ((widths[i] as number) <= (floors[i] as number)) continue;
      if (target === -1 || (widths[i] as number) > (widths[target] as number)) target = i;
    }
    if (target === -1) break;
    widths[target] = (widths[target] as number) - 1;
    over--;
  }
  return widths;
}

/** A horizontal rule, or `null` when the style's body slot is zero-width and the line is skipped. */
function rule(slots: [BorderSlot, BorderSlot, BorderSlot, BorderSlot], widths: readonly number[], padding: number, gap: number): string | null {
  const [left, body, join, right] = slots;
  if (body.width === 0) return null;
  const segments = widths.map((w) => body.char.repeat(w + 2 * padding));
  const separator = join.width > 0 ? join.char : body.char.repeat(gap);
  return (left.width > 0 ? left.char : "") + segments.join(separator) + (right.width > 0 ? right.char : "");
}

/**
 * Renders `rows` as an aligned grid, one string per physical line.
 *
 * The single column engine behind every aligned block forge prints: the `forge sync` tables, the
 * `--help` command and flag lists, and the release summary. Each of those was its own padding
 * expression before, and a fifth would have been written the next time one was needed.
 * @public
 */
export function renderGrid(rows: readonly Readonly<Record<string, string>>[], options: GridOptions = {}): string[] {
  if (rows.length === 0) return [];

  const border = options.border ?? BORDERS.markdown;
  const padding = options.padding ?? 1;
  const gap = options.gap ?? 2;
  const indent = " ".repeat(options.indent ?? 0);
  const withHeader = options.header ?? true;

  const declared = (options.columns ?? Object.keys(rows[0] ?? {})).map(toColumn);
  // Which columns a caller *offers* is a question about the data; which of them carry anything is a
  // question about this particular grid, and the header text is not an answer to it.
  const columns = options.dropEmptyColumns === false ? declared : declared.filter((c) => rows.some((row) => (row[c.key] ?? "") !== ""));
  if (columns.length === 0) return [];

  const natural = columns.map((column) =>
    Math.max(withHeader ? stringWidth(headerOf(column)) : 0, ...rows.map((row) => stringWidth(row[column.key] ?? ""))),
  );
  const widths =
    options.maxWidth === undefined
      ? natural
      : fit(natural, columns, Math.max(columns.length, options.maxWidth - indent.length - chromeWidth(columns.length, border, padding, gap)));

  const pad = " ".repeat(padding);
  const separator = pad + (border.bodyJoin.width > 0 ? border.bodyJoin.char : " ".repeat(gap)) + pad;
  const open = (border.bodyLeft.width > 0 ? border.bodyLeft.char : "") + pad;
  const close = pad + (border.bodyRight.width > 0 ? border.bodyRight.char : "");
  // Without a right border there is nothing for the last column's padding to align against, so it
  // would only ever show up as trailing whitespace.
  const finish = (line: string) => indent + (border.bodyRight.width > 0 ? line : line.trimEnd());
  const body = (cells: readonly string[]) =>
    finish(open + cells.map((cell, i) => padAlign(cell, widths[i] ?? 0, columns[i]?.align)).join(separator) + close);

  const lines: string[] = [];
  const top = rule([border.topLeft, border.topBody, border.topJoin, border.topRight], widths, padding, gap);
  if (top !== null) lines.push(indent + top);

  if (withHeader) {
    lines.push(body(columns.map(headerOf)));
    const under = rule([border.joinLeft, border.joinBody, border.joinJoin, border.joinRight], widths, padding, gap);
    if (under !== null) lines.push(indent + under);
  }

  for (const row of rows) {
    const cells = columns.map((column, i) => {
      const raw = row[column.key] ?? "";
      const width = widths[i] ?? 0;
      return column.wrap === true ? wrapLines(raw, width) : [truncate(raw, width).text];
    });
    const height = Math.max(...cells.map((c) => c.length));
    for (let line = 0; line < height; line++) lines.push(body(cells.map((cell) => cell[line] ?? "")));
  }

  const bottom = rule([border.bottomLeft, border.bottomBody, border.bottomJoin, border.bottomRight], widths, padding, gap);
  if (bottom !== null) lines.push(indent + bottom);

  return lines;
}

/**
 * Renders `term` and `description` as two aligned columns, with descriptions wrapping to `width`.
 *
 * The shape `--help` needs twice and the release summary once — a borderless two-column grid — so
 * that a label's own length is data the engine measures rather than padding a caller hard-codes.
 * @public
 */
export function definitionList(entries: readonly DefinitionEntry[], options: DefinitionOptions = {}): string[] {
  return renderGrid(
    entries.map((entry) => ({ term: entry.term, description: entry.description })),
    {
      columns: [{ key: "term" }, { key: "description", wrap: true }],
      border: BORDERS.none,
      header: false,
      padding: 0,
      gap: options.gap ?? 2,
      indent: options.indent ?? 0,
      dropEmptyColumns: false,
      ...(options.width === undefined ? {} : { maxWidth: options.width }),
    },
  );
}
