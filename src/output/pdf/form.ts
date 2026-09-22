import { columnsElement, fieldsElement, headingElement, noteElement, optionsElement, subheadingElement, ticksElement } from "./form-elements";
import type { FieldProps, HeadingProps, NoteProps, OptionGroupProps, PdfElement, SignatureRowProps, TickListProps } from "./types";

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
