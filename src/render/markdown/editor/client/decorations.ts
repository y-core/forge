import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range, TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

import { calloutPattern, viewportDialect } from "./dialect";
import { topLevelUnits } from "./syntax";
import type { DialectSpan, DialectSpanCache, DocumentSpan, EditorSyntaxNode } from "./types";

const TASK_MARKER = /^\[[ xX]\]$/;
const ATX_HEADING = /^ATXHeading([1-6])$/;
const MARKER_NODES = new Set(["EmphasisMark", "StrikethroughMark", "LinkMark", "QuoteMark"]);
const SETEXT_HEADING: Readonly<Record<string, string>> = { SetextHeading1: "cm-md-h1", SetextHeading2: "cm-md-h2" };
const INLINE_CLASS: Readonly<Record<string, string>> = {
  Emphasis: "cm-md-em",
  StrongEmphasis: "cm-md-strong",
  InlineCode: "cm-md-code",
  Strikethrough: "cm-md-strike",
  Link: "cm-md-link",
};

class LinkChipWidget extends WidgetType {
  private readonly _label: string;
  private readonly _target: string;

  constructor(label: string, target: string) {
    super();
    this._label = label;
    this._target = target;
  }

  override eq(other: LinkChipWidget): boolean {
    return other._label === this._label && other._target === this._target;
  }

  toDOM(view: EditorView): HTMLElement {
    const chip = view.dom.ownerDocument.createElement("span");
    chip.className = "cm-md-link-chip";
    chip.textContent = this._label;
    chip.title = this._target;
    return chip;
  }
}

class AttachmentWidget extends WidgetType {
  private readonly _alt: string;

  constructor(alt: string) {
    super();
    this._alt = alt;
  }

  override eq(other: AttachmentWidget): boolean {
    return other._alt === this._alt;
  }

  toDOM(view: EditorView): HTMLElement {
    const chip = view.dom.ownerDocument.createElement("span");
    chip.className = "cm-md-attachment";
    chip.textContent = this._alt;
    return chip;
  }
}

function isEditable(state: EditorState): boolean {
  return state.facet(EditorView.editable) && !state.readOnly;
}

/** Flips the task marker starting at `pos`, or answers null when the state is not editable or no marker starts there. @internal */
export function toggleTaskAt(state: EditorState, pos: number): TransactionSpec | null {
  const marker = state.doc.sliceString(pos, pos + 3);
  if (!isEditable(state) || !TASK_MARKER.test(marker)) return null;
  const checked = marker[1] !== " ";
  return { changes: { from: pos + 1, to: pos + 2, insert: checked ? " " : "x" }, userEvent: "input" };
}

class TaskCheckboxWidget extends WidgetType {
  private readonly _checked: boolean;
  private readonly _editable: boolean;

  constructor(checked: boolean, editable: boolean) {
    super();
    this._checked = checked;
    this._editable = editable;
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return other._checked === this._checked && other._editable === this._editable;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = view.dom.ownerDocument.createElement("input");
    box.type = "checkbox";
    box.className = "cm-md-task";
    box.checked = this._checked;
    box.disabled = !this._editable;
    box.tabIndex = -1;
    box.setAttribute("aria-label", "Task done");
    if (!this._editable) return box;
    box.addEventListener("click", (event) => event.preventDefault());
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const toggle = toggleTaskAt(view.state, view.posAtDOM(box));
      if (toggle) view.dispatch(toggle);
    });
    return box;
  }
}

interface DecorationSink {
  readonly all: Range<Decoration>[];
  readonly atomic: Range<Decoration>[];
}

function addMark(sink: DecorationSink, from: number, to: number, className: string): void {
  if (to > from) sink.all.push(Decoration.mark({ class: className }).range(from, to));
}

function addLines(sink: DecorationSink, state: EditorState, from: number, to: number, className: string): void {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let number = first; number <= last; number += 1) {
    sink.all.push(Decoration.line({ class: className }).range(state.doc.line(number).from));
  }
}

function addReplace(sink: DecorationSink, from: number, to: number, widget: WidgetType): void {
  const range = Decoration.replace({ widget }).range(from, to);
  sink.all.push(range);
  sink.atomic.push(range);
}

/** Locates the `[!kind]` marker opening a blockquote's first line, when the blockquote is a callout. @internal */
export function calloutMarker(
  state: EditorState,
  quote: EditorSyntaxNode,
): { readonly kind: string; readonly from: number; readonly to: number } | undefined {
  const match = calloutPattern(state.facet(viewportDialect))?.exec(state.doc.sliceString(quote.from, state.doc.lineAt(quote.from).to));
  if (!match?.[1]) return undefined;
  return { kind: match[1].toLowerCase(), from: quote.from + match[0].indexOf("["), to: quote.from + match[0].length };
}

/** Reports whether a node lies within the callout marker of the blockquote holding it. @internal */
export function isCalloutMarker(state: EditorState, node: EditorSyntaxNode): boolean {
  const quote = node.parent?.parent;
  if (quote?.name !== "Blockquote") return false;
  const marker = calloutMarker(state, quote);
  return marker !== undefined && marker.from <= node.from && node.to <= marker.to;
}

function decorateNode(sink: DecorationSink, state: EditorState, ref: EditorSyntaxNode, editable: boolean): void {
  const { name, from, to } = ref;
  const heading = ATX_HEADING.exec(name);
  if (heading) {
    sink.all.push(Decoration.line({ class: `cm-md-h${heading[1]}` }).range(state.doc.lineAt(from).from));
    return;
  }
  const setext = SETEXT_HEADING[name];
  if (setext) {
    sink.all.push(Decoration.line({ class: setext }).range(state.doc.lineAt(from).from));
    return;
  }
  const inline = INLINE_CLASS[name];
  if (inline && !(name === "Link" && isCalloutMarker(state, ref))) {
    addMark(sink, from, to, inline);
    return;
  }
  if (name === "HeaderMark" && ref.parent?.name.startsWith("ATXHeading")) {
    addMark(sink, from, state.doc.sliceString(to, to + 1) === " " ? to + 1 : to, "cm-md-marker");
    return;
  }
  if (MARKER_NODES.has(name) || (name === "CodeMark" && ref.parent?.name === "InlineCode")) {
    addMark(sink, from, to, "cm-md-marker");
    return;
  }
  if (name === "TaskMarker") {
    addReplace(sink, from, to, new TaskCheckboxWidget(/[xX]/.test(state.doc.sliceString(from, to)), editable));
    return;
  }
  if (name === "Blockquote") {
    const kind = calloutMarker(state, ref)?.kind;
    addLines(sink, state, from, to, kind ? `cm-md-callout cm-md-callout-${kind}` : "cm-md-quote");
  }
}

function decorateDialect(sink: DecorationSink, spans: readonly DialectSpan[], base: number): void {
  for (const span of spans) {
    const from = base + span.from;
    const to = base + span.to;
    if (span.kind === "embed") addReplace(sink, from, to, new AttachmentWidget(span.alt));
    else if (span.kind === "wikilink") {
      if (span.chip) addReplace(sink, from, to, new LinkChipWidget(span.chip.label, span.chip.target));
      else addMark(sink, from, to, "cm-md-unresolved");
    } else if (span.kind === "highlight") {
      addMark(sink, from, from + 2, "cm-md-marker");
      addMark(sink, from + 2, to - 2, "cm-md-highlight");
      addMark(sink, to - 2, to, "cm-md-marker");
    } else addMark(sink, from, to, span.kind === "tag" ? "cm-md-tag" : "cm-md-due");
  }
}

function insideSpan(spans: readonly DialectSpan[], base: number, from: number, to: number): boolean {
  return spans.some((span) => base + span.from <= from && to <= base + span.to);
}

function topLevelNodesIn(state: EditorState, ranges: readonly DocumentSpan[]): EditorSyntaxNode[] {
  return topLevelUnits(state).filter((node) => ranges.some((range) => node.from <= range.to && range.from <= node.to));
}

/** Builds the markdown decorations over the top-level units the ranges touch, the atomic subset, and the dialect spans it used. @internal */
export function buildDecorations(
  state: EditorState,
  ranges: readonly DocumentSpan[],
  cache: DialectSpanCache = new Map(),
): { readonly all: DecorationSet; readonly atomic: DecorationSet; readonly cache: DialectSpanCache } {
  const sink: DecorationSink = { all: [], atomic: [] };
  const next = new Map<string, readonly DialectSpan[]>();
  const editable = isEditable(state);
  const dialect = state.facet(viewportDialect);
  for (const node of topLevelNodesIn(state, ranges)) {
    const base = state.doc.lineAt(node.from).from;
    const text = state.doc.sliceString(base, node.to);
    const spans = cache.get(text) ?? dialect.spans(text);
    next.set(text, spans);
    const cursor = node.cursor();
    do if (!insideSpan(spans, base, cursor.from, cursor.to)) decorateNode(sink, state, cursor.node, editable);
    while (cursor.next() && cursor.from < node.to);
    decorateDialect(sink, spans, base);
  }
  return { all: Decoration.set(sink.all, true), atomic: Decoration.set(sink.atomic, true), cache: next };
}

class MarkdownDecorations {
  all: DecorationSet;
  atomic: DecorationSet;
  private _cache: DialectSpanCache = new Map();

  constructor(view: EditorView) {
    ({ all: this.all, atomic: this.atomic, cache: this._cache } = buildDecorations(view.state, view.visibleRanges, this._cache));
  }

  update(update: ViewUpdate): void {
    const { startState, state } = update;
    const changed =
      update.docChanged ||
      update.viewportChanged ||
      startState.facet(EditorView.editable) !== state.facet(EditorView.editable) ||
      startState.readOnly !== state.readOnly ||
      syntaxTree(startState) !== syntaxTree(state);
    if (!changed) return;
    ({ all: this.all, atomic: this.atomic, cache: this._cache } = buildDecorations(state, update.view.visibleRanges, this._cache));
  }
}

/** Creates the view plugin that decorates markdown constructs without changing the text. @internal */
export function decorations(): Extension {
  const plugin = ViewPlugin.fromClass(MarkdownDecorations, { decorations: (value) => value.all });
  return [plugin, EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none)];
}
