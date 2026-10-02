import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const chip = { border: "1px solid var(--border)", borderRadius: "0.25rem", padding: "0 0.25rem", color: "var(--foreground)" };

/** The editor's look, drawn only from forge's theme variables so it follows the page's light and dark modes. @internal */
export const editorTheme: Extension = EditorView.theme({
  "&": { color: "var(--foreground)", backgroundColor: "transparent", font: "inherit" },
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "2px" },
  ".cm-content": { fontFamily: "inherit", caretColor: "var(--foreground)", padding: "0.5rem 0" },
  ".cm-cursor, .cm-dropCursor": { borderInlineStartColor: "var(--foreground)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "var(--accent)" },
  ".cm-md-h1": { fontSize: "var(--md-h1-size)", fontWeight: "var(--md-h1-weight)" },
  ".cm-md-h2": { fontSize: "var(--md-h2-size)", fontWeight: "var(--md-h2-weight)" },
  ".cm-md-h3": { fontSize: "var(--md-h3-size)", fontWeight: "var(--md-h3-weight)" },
  ".cm-md-h4": { fontSize: "var(--md-h4-size)", fontWeight: "var(--md-h4-weight)" },
  ".cm-md-h5": { fontSize: "var(--md-h5-size)", fontWeight: "var(--md-h5-weight)" },
  ".cm-md-h6": { fontSize: "var(--md-h6-size)", fontWeight: "var(--md-h6-weight)" },
  ".cm-md-em": { fontStyle: "italic" },
  ".cm-md-strong": { fontWeight: "700" },
  ".cm-md-strike": { textDecoration: "line-through" },
  ".cm-md-code": { fontFamily: "var(--md-code-font)", backgroundColor: "var(--muted)" },
  ".cm-md-link": { color: "var(--primary)", textDecoration: "underline" },
  ".cm-md-quote": { borderInlineStart: "3px solid var(--border)", paddingInlineStart: "0.5rem" },
  ".cm-md-marker": { color: "var(--muted-foreground)" },
  ".cm-md-highlight": { backgroundColor: "var(--accent)" },
  ".cm-md-link-chip": { ...chip, color: "var(--primary)" },
  ".cm-md-attachment": chip,
  ".cm-md-unresolved": { color: "var(--muted-foreground)", textDecoration: "underline dotted" },
  ".cm-md-tag": { color: "var(--primary)" },
  ".cm-md-due": { color: "var(--primary)", fontVariantNumeric: "tabular-nums" },
  ".cm-md-task": { accentColor: "var(--primary)", marginInlineEnd: "0.25rem", verticalAlign: "middle" },
  ".cm-md-callout": { borderInlineStart: "3px solid var(--border)", paddingInlineStart: "0.5rem" },
});
