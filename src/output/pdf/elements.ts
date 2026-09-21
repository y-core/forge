import {
  ANSWER_GUTTER,
  BLANK_DROP,
  BLANK_LEAD,
  BLANK_WEIGHT,
  BOLD_RUN,
  COLUMN_GUTTER,
  GLYPH_WEIGHT,
  HEADED,
  HEADING_LEAD,
  HEADING_LINE,
  HEADING_SIZE,
  HEADING_TRACKING,
  LABEL_GAP,
  LABEL_SIZE,
  LABEL_WIDTH,
  LINE,
  MARK_DROP,
  MARK_INSET,
  MARK_RADIUS,
  MARK_SIZE,
  MARK_WEIGHT,
  MIN_VALUE_WIDTH,
  NOTE_SIZE,
  OPTION_GUTTER,
  PAIR_LEAD,
  ROW_COLUMNS,
  SIGNATURE_GUTTER,
  SIGNATURE_LEAD,
  SIGNATURE_TRAIL,
  SUBHEADING_LEAD,
  TICK_COLUMNS,
  TICK_GAP,
  VALUE_SIZE,
  WIDE_OPTIONS_WIDTH,
} from "./geometry";
import { resolveTracks, spanOf, trackOffsets } from "./tracks";
import type {
  PdfBox,
  PdfBreakLimits,
  PdfCell,
  PdfCursor,
  PdfElement,
  PdfField,
  PdfFragment,
  PdfMark,
  PdfScopeFrame,
  PdfTick,
  PdfTypesetting,
  TextStyle,
} from "./types";
import { BASE14_TYPESETTING } from "./typesetting";

interface Run {
  text: string;
  size: number;
  style?: TextStyle | undefined;
}

interface LaidField {
  x: number;
  valueX: number;
  valueWidth: number;
  above: boolean;
  blank: boolean;
  label: string[];
  value: string[];
}

function element(runs: readonly Run[], fragments: (box: PdfBox, set: PdfTypesetting) => PdfFragment[]): PdfElement {
  return {
    measure(width, set = BASE14_TYPESETTING) {
      const built = fragments({ x: 0, width, height: Number.POSITIVE_INFINITY }, set);
      return {
        preferred: Math.max(...runs.map((run) => set.preferred(run.text, run.size, run.style ?? {})), 0),
        minimum: Math.max(...runs.map((run) => set.minimum(run.text, run.size, run.style ?? {})), 0),
        height: built.reduce((total, fragment) => total + fragment.advance, 0),
      };
    },
    fragments: (box, set = BASE14_TYPESETTING) => fragments(box, set),
  };
}

function section(of: PdfElement): PdfElement {
  return { ...of, startsSection: true };
}

/** The twelve uniform tracks a printed row divides its measure into. @internal */
export function gridTracks(width: number): number[] {
  return resolveTracks(
    Array.from({ length: ROW_COLUMNS }, () => 1),
    width,
    COLUMN_GUTTER,
  );
}

// Every mark is an outline: a fill would print as a solid block wherever the reader has to write.
function drawMark(cursor: PdfCursor, x: number, y: number, mark: PdfMark): void {
  // The box's state is the answer, and it is drawn rather than set — so a reader is told it.
  const drawn = (): void => {
    const bottom = y + MARK_DROP;
    cursor.roundedRect(x, bottom - MARK_SIZE, MARK_SIZE, MARK_RADIUS, MARK_WEIGHT);
    const near = MARK_INSET;
    const far = MARK_SIZE - MARK_INSET;
    if (mark === "ticked") {
      const foot = MARK_SIZE / 2 - 0.5;
      cursor.polyline(
        [
          [x + near, bottom - MARK_SIZE / 2],
          [x + foot, bottom - near],
          [x + far, bottom - far],
        ],
        GLYPH_WEIGHT,
      );
    }
    if (mark === "crossed") {
      cursor.polyline(
        [
          [x + near, bottom - near],
          [x + far, bottom - far],
        ],
        GLYPH_WEIGHT,
      );
      cursor.polyline(
        [
          [x + far, bottom - near],
          [x + near, bottom - far],
        ],
        GLYPH_WEIGHT,
      );
    }
  };
  cursor.tagged("mark", drawn, mark);
}

/** A section heading, set in capitals over a rule the width of its measure. @internal */
export function headingElement(heading: string): PdfElement {
  const capitals = heading.toUpperCase();
  return section(
    element([{ text: capitals, size: HEADING_SIZE, style: HEADED }], (box, set) => {
      const lines = set.wrap(capitals, HEADING_SIZE, box.width, HEADED);
      return [
        {
          reserve: HEADING_LEAD + HEADING_LINE * lines.length + 12,
          advance: HEADING_LEAD - HEADING_LINE + HEADING_LINE * lines.length + 12,
          paint(cursor) {
            cursor.y += HEADING_LEAD - HEADING_LINE;
            cursor.tagged("heading", () => {
              cursor.painted(cursor.channel.heading, () => {
                for (const line of lines) {
                  cursor.y += HEADING_LINE;
                  cursor.text(line, box.x, cursor.y, "bold", HEADING_SIZE, HEADING_TRACKING);
                }
              });
            });
            cursor.y += 6;
            cursor.tagged("rule", () => {
              cursor.stroked(cursor.channel.rule, () => {
                cursor.rule(cursor.y);
              });
            });
            cursor.y += 6;
          },
        },
      ];
    }),
  );
}

/** A bold line naming the answers beneath it, so a reader can see which of them are theirs. @internal */
export function subheadingElement(text: string): PdfElement {
  return element([{ text, size: LABEL_SIZE, style: BOLD_RUN }], (box, set) => {
    const lines = set.wrap(text, LABEL_SIZE, box.width, BOLD_RUN);
    const advance = SUBHEADING_LEAD + LINE * lines.length + PAIR_LEAD;
    return [
      {
        reserve: advance,
        advance,
        paint(cursor) {
          cursor.y += SUBHEADING_LEAD;
          cursor.tagged("subheading", () => {
            for (const line of lines) {
              cursor.y += LINE;
              cursor.text(line, box.x, cursor.y, "bold", LABEL_SIZE);
            }
          });
          cursor.y += PAIR_LEAD;
        },
      },
    ];
  });
}

/** A paragraph of explanatory copy, which breaks a line at a time rather than whole. @internal */
export function noteElement(note: string): PdfElement {
  return element([{ text: note, size: NOTE_SIZE }], (box, set) => {
    const fragments: PdfFragment[] = set.wrap(note, NOTE_SIZE, box.width).map((line) => ({
      reserve: LINE,
      advance: LINE,
      paint(cursor) {
        cursor.tagged("note", () => {
          cursor.y += LINE;
          cursor.text(line, box.x, cursor.y, "regular", NOTE_SIZE);
        });
      },
    }));
    fragments.push({
      reserve: 0,
      advance: 4,
      paint(cursor) {
        cursor.y += 4;
      },
    });
    return fragments;
  });
}

function optionWidth(option: PdfTick, set: PdfTypesetting): number {
  return MARK_SIZE + TICK_GAP + set.width(option.label, VALUE_SIZE);
}

/** A question and the boxes answering it, flowed across the measure and wrapped like words. @internal */
export function optionsElement(label: string, options: readonly PdfTick[]): PdfElement {
  const runs = [{ text: label, size: LABEL_SIZE, style: BOLD_RUN }, ...options.map((option) => ({ text: option.label, size: VALUE_SIZE }))];
  return element(runs, (box, set) => {
    const right = box.x + box.width;
    const total = options.reduce((width, option) => width + optionWidth(option, set) + OPTION_GUTTER, -OPTION_GUTTER);
    // Set flush right, the last box ends where every rule on the page ends; anything else starts
    // where a value starts, which is where the eye already is.
    const flush = total <= WIDE_OPTIONS_WIDTH && set.wrap(label, LABEL_SIZE, LABEL_WIDTH, BOLD_RUN).length > 1;
    const valueColumn = box.x + LABEL_WIDTH + LABEL_GAP;
    const valueX = flush ? right - total : valueColumn;
    const labelWidth = (flush ? valueX - ANSWER_GUTTER : valueColumn - LABEL_GAP) - box.x;
    const labelLines = set.wrap(label, LABEL_SIZE, labelWidth, BOLD_RUN);
    const measure = right - valueX;
    const rows: PdfTick[][] = [];
    let row: PdfTick[] = [];
    let used = 0;
    for (const option of options) {
      const width = optionWidth(option, set);
      // A hair of tolerance: a flush row is sized to its own content, and exact arithmetic on the
      // last option would put it on a line of its own.
      if (row.length > 0 && used + width > measure + 0.01) {
        rows.push(row);
        row = [];
        used = 0;
      }
      row.push(option);
      used += width + OPTION_GUTTER;
    }
    if (row.length > 0) rows.push(row);

    const list: PdfScopeFrame = { kind: "list" };
    const advance = Math.max(labelLines.length, rows.length) * LINE + PAIR_LEAD;
    return [
      {
        reserve: advance,
        advance,
        paint(cursor) {
          const top = cursor.y;
          cursor.tagged("label", () => {
            labelLines.forEach((line, index) => {
              cursor.text(line, box.x, top + LINE * (index + 1), "bold", LABEL_SIZE);
            });
          });
          cursor.grouped(list, () => {
            rows.forEach((line, index) => {
              const y = top + LINE * (index + 1);
              let x = valueX;
              for (const option of line) {
                const at = x;
                cursor.grouped({ kind: "item" }, () => {
                  drawMark(cursor, at, y, option.mark);
                  cursor.tagged("value", () => {
                    cursor.text(option.label, at + MARK_SIZE + TICK_GAP, y, "regular", VALUE_SIZE);
                  });
                });
                x += optionWidth(option, set) + OPTION_GUTTER;
              }
            });
          });
          cursor.y = top + advance;
        },
      },
    ];
  });
}

/** A list of tick lines, set two to a row, each row breaking whole. @internal */
export function ticksElement(items: readonly PdfTick[]): PdfElement {
  return element(
    items.map((item) => ({ text: item.label, size: VALUE_SIZE })),
    (box, set) => {
      const span = box.width / TICK_COLUMNS;
      const width = span - COLUMN_GUTTER - MARK_SIZE - TICK_GAP;
      const laid = items.map((item) => ({ mark: item.mark, lines: set.wrap(item.label, VALUE_SIZE, width) }));
      const fragments: PdfFragment[] = [];
      // Two items to a row is a layout fact with no structural meaning, so the row never becomes an
      // element: the list is one `/L` across every fragment, and each item is a sibling `/LI`.
      const list: PdfScopeFrame = { kind: "list" };
      for (let index = 0; index < laid.length; index += TICK_COLUMNS) {
        const row = laid.slice(index, index + TICK_COLUMNS);
        const advance = row.reduce((most, cell) => Math.max(most, cell.lines.length), 0) * LINE + PAIR_LEAD;
        fragments.push({
          reserve: advance,
          advance,
          paint(cursor) {
            const top = cursor.y;
            cursor.grouped(list, () => {
              row.forEach((cell, column) => {
                const x = box.x + span * column;
                cursor.grouped({ kind: "item" }, () => {
                  drawMark(cursor, x, top + LINE, cell.mark);
                  cursor.tagged("value", () => {
                    cell.lines.forEach((line, at) => {
                      cursor.text(line, x + MARK_SIZE + TICK_GAP, top + LINE * (at + 1), "regular", VALUE_SIZE);
                    });
                  });
                });
              });
            });
            cursor.y = top + advance;
          },
        });
      }
      return fragments;
    },
  );
}

/** A row of signature cells, each a label over an answer or a rule to write one on. @internal */
export function columnsElement(cells: readonly PdfCell[]): PdfElement {
  const runs = cells.flatMap((cell) => [
    { text: cell.label, size: LABEL_SIZE, style: BOLD_RUN },
    ...("blank" in cell ? [] : [{ text: cell.value, size: VALUE_SIZE }]),
  ]);
  return element(runs, (box, set) => {
    if (cells.length === 0) return [];
    const span = box.width / cells.length;
    const laid = cells.map((cell, column) => {
      // The last cell runs to the margin: a gutter subtracted from every cell ends the right-hand
      // rule short of the edge the rest of the page is set to.
      const width = column === cells.length - 1 ? box.x + box.width - (box.x + span * column) : span - SIGNATURE_GUTTER;
      return {
        width,
        label: set.wrap(cell.label, LABEL_SIZE, width, BOLD_RUN),
        value: "blank" in cell ? [] : set.wrap(cell.value, VALUE_SIZE, width),
        blank: "blank" in cell,
      };
    });
    const rows = laid.reduce((most, cell) => Math.max(most, cell.label.length + Math.max(cell.value.length, 1)), 0);
    const advance = rows * LINE + SIGNATURE_LEAD + SIGNATURE_TRAIL;
    return [
      {
        reserve: advance,
        advance,
        paint(cursor) {
          const top = cursor.y;
          laid.forEach((cell, index) => {
            const x = box.x + span * index;
            cursor.tagged("label", () => {
              cell.label.forEach((line, row) => {
                cursor.text(line, x, top + LINE * (row + 1), "bold", LABEL_SIZE);
              });
            });
            cursor.tagged("value", () => {
              cell.value.forEach((line, row) => {
                cursor.text(line, x, top + LINE * (cell.label.length + row + 1) + SIGNATURE_LEAD, "regular", VALUE_SIZE);
              });
              if (cell.blank) cursor.segment(x, top + LINE * (cell.label.length + 1) + SIGNATURE_LEAD + BLANK_DROP, cell.width, BLANK_WEIGHT);
            });
          });
          cursor.y = top + advance;
        },
      },
    ];
  });
}

// Where each field sits: the column it asked for, or the next one free where it asked for none.
function placements(fields: readonly PdfField[]): { start: number; columns: number }[] {
  let next = 1;
  return fields.map((field) => {
    const columns = field.span ?? ROW_COLUMNS;
    const start = field.start ?? next;
    next = start + columns;
    return { start, columns };
  });
}

// A column sized for the document's longest label leaves a run of white after a short one, which
// reads as a missing answer, so the label takes what it measures and no more.
function labelColumn(label: string, width: number, set: PdfTypesetting): number {
  return Math.min(LABEL_WIDTH, set.width(label, LABEL_SIZE, BOLD_RUN), width - LABEL_GAP - MIN_VALUE_WIDTH);
}

function standsAbove(field: PdfField, width: number, set: PdfTypesetting): boolean {
  if (field.labels === "above") return true;
  if (width - LABEL_GAP - MIN_VALUE_WIDTH < set.width(field.label, LABEL_SIZE, BOLD_RUN) && width - LABEL_WIDTH - LABEL_GAP < MIN_VALUE_WIDTH)
    return true;
  return set.wrap(field.label, LABEL_SIZE, LABEL_WIDTH, BOLD_RUN).length > 2;
}

function layOut(fields: readonly PdfField[], box: PdfBox, set: PdfTypesetting): LaidField[] {
  const placed = placements(fields);
  const widths = gridTracks(box.width);
  const offsets = trackOffsets(widths, COLUMN_GUTTER);
  return fields.map((field, index) => {
    const { start, columns } = placed[index] ?? { start: 1, columns: ROW_COLUMNS };
    const x = box.x + (offsets[start - 1] ?? 0);
    const width = spanOf(widths, start - 1, columns, COLUMN_GUTTER);
    const above = standsAbove(field, width, set);
    const column = above ? width : labelColumn(field.label, width, set);
    return {
      x,
      valueX: above ? x : x + column + LABEL_GAP,
      valueWidth: above ? width : width - column - LABEL_GAP,
      above,
      blank: field.value === undefined,
      label: set.wrap(field.label, LABEL_SIZE, column, BOLD_RUN),
      value: field.value === undefined ? [] : set.wrap(field.value, VALUE_SIZE, above ? width : width - column - LABEL_GAP),
    };
  });
}

/** One row of fields, each set at its own span of the grid, label beside its answer or above it. @internal */
export function fieldsElement(fields: readonly PdfField[]): PdfElement {
  const runs = fields.flatMap((field) => [
    { text: field.label, size: LABEL_SIZE, style: BOLD_RUN },
    ...(field.value === undefined ? [] : [{ text: field.value, size: VALUE_SIZE }]),
  ]);
  return element(runs, (box, set) => {
    if (fields.length === 0) return [];
    const laid = layOut(fields, box, set);
    const lines = (cell: LaidField): number =>
      cell.above ? cell.label.length + Math.max(cell.value.length, 1) : Math.max(cell.label.length, cell.value.length, 1);
    const rows = laid.reduce((most, cell) => Math.max(most, lines(cell)), 0);
    const advance = rows * LINE + (laid.some((cell) => cell.blank) ? BLANK_LEAD : PAIR_LEAD);
    return [
      {
        reserve: advance,
        advance,
        paint(cursor) {
          const top = cursor.y;
          for (const cell of laid) {
            const valueFrom = cell.above ? cell.label.length : 0;
            cursor.tagged("label", () => {
              cell.label.forEach((line, index) => {
                cursor.text(line, cell.x, top + LINE * (index + 1), "bold", LABEL_SIZE);
              });
            });
            cursor.tagged("value", () => {
              cell.value.forEach((line, index) => {
                cursor.text(line, cell.valueX, top + LINE * (valueFrom + index + 1), "regular", VALUE_SIZE);
              });
              if (cell.blank) cursor.segment(cell.valueX, top + LINE * (valueFrom + 1) + BLANK_DROP, cell.valueWidth, BLANK_WEIGHT);
            });
          }
          cursor.y = top + advance;
        },
      },
    ];
  });
}

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
