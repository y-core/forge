import { EditorSelection, StateField } from "@codemirror/state";
import type { ChangeSpec, EditorState, SelectionRange, StateCommand, Transaction, TransactionSpec } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";

import { continueList, createMarkdownDraft, MARKDOWN_WRAP_KEYS, reviseMarkdownDraft, wrapSelection } from "../../editing";
import type { EditorDraft, EditorEdit, EditorWrap } from "./types";

interface DraftCell {
  readonly base: EditorDraft | null;
  draft?: EditorDraft;
}

/** Holds the editing core's last draft of the viewport, revised to the current text only when a command reads it. @internal */
export const viewportDraft = StateField.define<DraftCell>({
  create: () => ({ base: null }),
  update: (cell, tr) => (tr.docChanged ? { base: cell.draft ?? cell.base } : cell),
});

/** Answers the editing core's draft of `state`'s text, revising the held draft at most once per text. @internal */
export function draftOf(state: EditorState): EditorDraft {
  const cell = state.field(viewportDraft);
  if (cell.draft === undefined) {
    const text = state.doc.toString();
    cell.draft = cell.base === null ? createMarkdownDraft(text) : reviseMarkdownDraft(cell.base, text);
  }
  return cell.draft;
}

/** Answers the transaction that applies an edit of the editing core under `userEvent`. @internal */
export function editTransaction(edit: EditorEdit, userEvent: string): TransactionSpec {
  return {
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    ...(edit.selection === null ? {} : { selection: { anchor: edit.selection.from, head: edit.selection.to } }),
    userEvent,
  };
}

function rangeEdit(state: EditorState, range: SelectionRange, edit: EditorEdit): { readonly changes: ChangeSpec; readonly range: SelectionRange } {
  const changes = { from: edit.from, to: edit.to, insert: edit.insert };
  if (edit.selection === null) return { changes, range: range.map(state.changes(changes)) };
  return { changes, range: EditorSelection.range(edit.selection.from, edit.selection.to) };
}

/** Applies `editAt` at every selection range, leaving a range it answers null for to `fallback`; declines where no range is edited. */
function runEdits(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  userEvent: string,
  editAt: (range: SelectionRange) => EditorEdit | null,
  fallback: (range: SelectionRange) => EditorEdit | null,
): boolean {
  const edits = state.selection.ranges.map(editAt);
  if (edits.every((edit) => edit === null)) return false;
  let index = 0;
  const spec = state.changeByRange((range) => {
    const edit = edits[index++] ?? fallback(range);
    return edit === null ? { range } : rangeEdit(state, range, edit);
  });
  dispatch(state.update(spec, { scrollIntoView: true, userEvent }));
  return true;
}

function lineBreak(range: SelectionRange): EditorEdit {
  return { from: range.from, to: range.to, insert: "\n", selection: { from: range.from + 1, to: range.from + 1 } };
}

/** Continues the list at each caret on Enter, breaking the line plainly at the others, or declines where no caret ends an item. @internal */
export const continueListCommand: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const draft = draftOf(state);
  return runEdits(state, dispatch, "input", (range) => continueList(draft, range), lineBreak);
};

/** Creates the command that writes `wrap`'s markers around each selection range, or removes them. @internal */
export function wrapCommand(wrap: EditorWrap): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const text = state.doc.toString();
    return runEdits(
      state,
      dispatch,
      "input.format",
      (range) => wrapSelection(text, range, wrap),
      () => null,
    );
  };
}

/** The viewport's list-continuation and formatting keys, bound ahead of CodeMirror's defaults. @internal */
export const viewportKeymap: readonly KeyBinding[] = [
  { key: "Enter", run: continueListCommand },
  ...Object.entries(MARKDOWN_WRAP_KEYS).map(([key, wrap]) => ({ key: `Mod-${key}`, run: wrapCommand(wrap) })),
];
