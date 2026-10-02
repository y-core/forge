import { syntaxTree } from "@codemirror/language";
import { Facet } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";

import { calloutMarker, decorations, isCalloutMarker } from "./decorations";
import { viewportDialect } from "./dialect";
import { topLevelUnits } from "./syntax";
import type { DialectSpan, DialectSpanCache, DocumentSpan, EditorSyntaxNode } from "./types";

/** Whether the marks on the lines the selection touches stay shown, which edit mode turns on. @internal */
export const revealActiveLines = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) });

const HIDE = Decoration.replace({});
const SIMPLE_MARKS = new Set(["EmphasisMark", "StrikethroughMark"]);
const SKIP_INSIDE = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock"]);

class HiddenMarks {
  readonly ranges: Range<Decoration>[] = [];
  private readonly _state: EditorState;
  private readonly _active: ReadonlySet<number>;

  constructor(state: EditorState, active: ReadonlySet<number>) {
    this._state = state;
    this._active = active;
  }

  hide(from: number, to: number): void {
    const doc = this._state.doc;
    for (let pos = from; pos < to;) {
      const line = doc.lineAt(pos);
      const end = Math.min(to, line.to);
      if (end > pos && !this._active.has(line.number)) this.ranges.push(HIDE.range(pos, end));
      pos = line.to + 1;
    }
  }
}

function activeLines(state: EditorState, reveal: boolean): Set<number> {
  const lines = new Set<number>();
  if (!reveal) return lines;
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let n = state.doc.lineAt(range.from).number; n <= last; n += 1) lines.add(n);
  }
  return lines;
}

function within(spans: readonly DocumentSpan[], from: number, to: number): boolean {
  return spans.some((span) => span.from <= from && to <= span.to);
}

function hideDialect(marks: HiddenMarks, span: DialectSpan, base: number): void {
  const from = base + span.from;
  const to = base + span.to;
  if (span.kind === "wikilink" && span.chip === undefined) {
    marks.hide(from, base + span.labelFrom);
    marks.hide(to - 2, to);
  } else if (span.kind === "highlight") {
    marks.hide(from, from + 2);
    marks.hide(to - 2, to);
  }
}

function hideLink(marks: HiddenMarks, link: EditorSyntaxNode): void {
  const [open, close] = link.getChildren("LinkMark");
  if (!open || !close) return;
  marks.hide(open.from, open.to);
  marks.hide(close.from, link.to);
}

function followingSpace(state: EditorState, pos: number): number {
  return state.doc.sliceString(pos, pos + 1) === " " ? pos + 1 : pos;
}

function hideQuoteMark(marks: HiddenMarks, state: EditorState, mark: EditorSyntaxNode): void {
  const after = followingSpace(state, mark.to);
  marks.hide(mark.from, after);
  const marker = mark.parent?.name === "Blockquote" ? calloutMarker(state, mark.parent) : undefined;
  if (marker?.from === after) marks.hide(marker.from, followingSpace(state, marker.to));
}

function hideHeaderMark(marks: HiddenMarks, state: EditorState, mark: EditorSyntaxNode): void {
  const parent = mark.parent?.name ?? "";
  if (parent.startsWith("Setext")) marks.hide(mark.from, mark.to);
  else if (parent.startsWith("ATX")) marks.hide(mark.from, followingSpace(state, mark.to));
}

function hideNodeMarks(marks: HiddenMarks, state: EditorState, node: EditorSyntaxNode): void {
  const { name, from, to } = node;
  if (name === "Link") {
    if (isCalloutMarker(state, node)) return;
    hideLink(marks, node);
  } else if (SIMPLE_MARKS.has(name)) marks.hide(from, to);
  else if (name === "CodeMark" && node.parent?.name === "InlineCode") marks.hide(from, to);
  else if (name === "Escape") marks.hide(from, from + 1);
  else if (name === "QuoteMark") hideQuoteMark(marks, state, node);
}

function hideTree(marks: HiddenMarks, state: EditorState, unit: EditorSyntaxNode, dialect: readonly DocumentSpan[]): void {
  syntaxTree(state).iterate({
    from: unit.from,
    to: unit.to,
    enter: (ref) => {
      if (SKIP_INSIDE.has(ref.name)) return false;
      if (ref.name === "HeaderMark") {
        hideHeaderMark(marks, state, ref.node);
        return true;
      }
      if (within(dialect, ref.from, ref.to)) return false;
      hideNodeMarks(marks, state, ref.node);
      return true;
    },
  });
}

/** Builds the ranges that hide markdown marks over the top-level units the ranges touch, and the dialect spans it used. @internal */
export function buildHiddenMarks(
  state: EditorState,
  reveal: boolean,
  ranges: readonly DocumentSpan[],
  cache: DialectSpanCache = new Map(),
): { readonly hidden: DecorationSet; readonly cache: DialectSpanCache } {
  const marks = new HiddenMarks(state, activeLines(state, reveal));
  const next = new Map<string, readonly DialectSpan[]>();
  const activeDialect = state.facet(viewportDialect);
  for (const unit of topLevelUnits(state)) {
    if (!ranges.some((range) => unit.from <= range.to && range.from <= unit.to)) continue;
    const base = state.doc.lineAt(unit.from).from;
    const text = state.doc.sliceString(base, unit.to);
    const spans = cache.get(text) ?? activeDialect.spans(text);
    next.set(text, spans);
    for (const span of spans) hideDialect(marks, span, base);
    const dialect = spans.map((span) => ({ from: base + span.from, to: base + span.to }));
    hideTree(marks, state, unit, dialect);
  }
  return { hidden: Decoration.set(marks.ranges, true), cache: next };
}

class HybridMarks {
  hidden: DecorationSet;
  private _cache: DialectSpanCache = new Map();

  constructor(view: EditorView) {
    ({ hidden: this.hidden, cache: this._cache } = buildHiddenMarks(
      view.state,
      view.state.facet(revealActiveLines),
      view.visibleRanges,
      this._cache,
    ));
  }

  update(update: ViewUpdate): void {
    const reveal = update.state.facet(revealActiveLines);
    const changed =
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      reveal !== update.startState.facet(revealActiveLines) ||
      syntaxTree(update.startState) !== syntaxTree(update.state);
    if (!changed) return;
    ({ hidden: this.hidden, cache: this._cache } = buildHiddenMarks(update.state, reveal, update.view.visibleRanges, this._cache));
  }
}

/** Creates the rendered layer: the markdown decorations plus the plugin hiding marks off the revealed lines. @internal */
export function hybridRendering(): Extension {
  return [decorations(), ViewPlugin.fromClass(HybridMarks, { decorations: (value) => value.hidden })];
}
