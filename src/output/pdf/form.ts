import { columnsElement, fieldsElement, headingElement, noteElement, optionsElement, subheadingElement, ticksElement } from "./elements";
import { COLUMN_GUTTER, ROW_COLUMNS } from "./geometry";
import { resolveTracks, spanOf, trackOffsets } from "./tracks";
import type {
  FieldProps,
  HeadingProps,
  NoteProps,
  OptionGroupProps,
  PdfElement,
  PdfGrid,
  PdfGridOptions,
  SignatureRowProps,
  TickListProps,
} from "./types";

/** A section heading, or a sub-heading where `level` says so. @public */
export function Heading(props: HeadingProps): PdfElement {
  return props.level === 2 ? subheadingElement(props.children) : headingElement(props.children);
}

/** One row of the grid: a question, the answer where there is one, and the span it takes. @public */
export function Field(props: FieldProps): PdfElement {
  return fieldsElement(props.fields);
}

/** A paragraph of explanatory copy, which breaks a line at a time rather than whole. @public */
export function Note(props: NoteProps): PdfElement {
  return noteElement(props.children);
}

/** A list of tick lines, set two to a row. @public */
export function TickList(props: TickListProps): PdfElement {
  return ticksElement(props.items);
}

/** A question and the boxes answering it, flowed across the measure. @public */
export function OptionGroup(props: OptionGroupProps): PdfElement {
  return optionsElement(props.label, props.options);
}

/** A row of signature cells, each a label over an answer or a rule to write one on. @public */
export function SignatureRow(props: SignatureRowProps): PdfElement {
  return columnsElement(props.cells);
}

/** Builds a column grid as tracks, so a span is a run of them rather than a count of its own. @public */
export function createPdfGrid(options: PdfGridOptions = {}): PdfGrid {
  const count = options.columns ?? ROW_COLUMNS;
  const gap = options.gap ?? COLUMN_GUTTER;
  const tracks = Array.from({ length: count }, () => 1);
  return {
    columns: count,
    gap,
    tracks,
    widths: (available) => resolveTracks(tracks, available, gap),
    columnX(available, start) {
      const offsets = trackOffsets(resolveTracks(tracks, available, gap), gap);
      return offsets[start - 1] ?? 0;
    },
    spanWidth(available, start, span) {
      return spanOf(resolveTracks(tracks, available, gap), start - 1, span, gap);
    },
  };
}
