import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

// ensureSyntaxTree finishes the parse in place, and only a transaction carries the finished tree into the state syntaxTree reads.
/** The same state with its whole document parsed, as a view holds it once the background parse has caught up. */
export function parsedState(state: EditorState): EditorState {
  ensureSyntaxTree(state, state.doc.length, 10_000);
  return state.update({}).state;
}
