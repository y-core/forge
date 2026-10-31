import type { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

import type { createMarkdownDraft, wrapSelection } from "../../editing";

/** The timer functions autosave runs on, injectable for tests. */
export interface AutosaveTimers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** How `createAutosave` decides when to save. */
export interface AutosaveOptions {
  readonly save: () => void;
  readonly timers: AutosaveTimers;
  readonly debounceMs?: number | undefined;
  readonly maxWaitMs?: number | undefined;
}

/** The debounced save loop one editor session runs. */
export interface Autosave {
  touch(): void;
  flush(): void;
  cancel(): void;
  dispose(): void;
  dirty(): boolean;
}

/** Whether the viewport takes typing or only shows the text. */
export type ViewportMode = "edit" | "view";

/** Whether the viewport shows the raw text, hides markdown marks off the cursor's line, or shows the dialect's read-only HTML. */
export type ViewportRendering = "raw" | "styled" | "html";

/** A source line and the client Y its top sits at. */
export interface ViewportAnchor {
  readonly line: number;
  readonly top: number;
}

/** A dialect construct found in one unit's text, with offsets relative to that text; a wiki link with a `chip` is drawn as one. */
export type DialectSpan =
  | { readonly kind: "tag" | "highlight" | "due"; readonly from: number; readonly to: number }
  | {
      readonly kind: "wikilink";
      readonly from: number;
      readonly to: number;
      readonly labelFrom: number;
      readonly chip: { readonly label: string; readonly target: string } | undefined;
    }
  | { readonly kind: "embed"; readonly from: number; readonly to: number; readonly alt: string };

/** The markdown dialect the viewport decorates: where its constructs sit in a unit, which callout kinds it reads, its own styles, and the HTML it renders. */
export interface ViewportDialect {
  readonly spans: (text: string) => readonly DialectSpan[];
  readonly calloutKinds: readonly string[];
  readonly theme?: Extension | undefined;
  /** The whole document as `renderMarkdownHtml` writes it under an allowlist schema with `lineAnchors: true`; the `html` rendering needs it. */
  readonly html?: ((markdown: string) => string) | undefined;
}

/** How `mountMarkdownViewport` opens the viewport; with no `dialect` it decorates CommonMark and GFM alone. */
export interface ViewportOptions {
  readonly markdown: string;
  readonly mode: ViewportMode;
  readonly rendering: ViewportRendering;
  readonly label: string;
  readonly scroller: HTMLElement;
  readonly onChange: () => void;
  readonly dialect?: ViewportDialect | undefined;
  /** Runs with the `html` rendering's container each time new HTML is written into it. */
  readonly onHtml?: ((container: HTMLElement) => void) | undefined;
}

/** How `ViewportController.replace` treats the reader's selection. */
export interface ViewportReplaceOptions {
  /** Maps the selection through the change rather than returning the cursor to the start. */
  readonly preserveSelection?: boolean | undefined;
}

/** The only surface through which the app drives the viewport, which is created once and never re-created. */
export interface ViewportController {
  setMode(mode: ViewportMode): void;
  setRendering(rendering: ViewportRendering): void;
  topAnchor(): ViewportAnchor;
  scrollTo(anchor: ViewportAnchor): void;
  getMarkdown(): string;
  /** Swaps in new text as one change that undo never reverts and `onChange` never reports. */
  replace(markdown: string, options?: ViewportReplaceOptions): void;
  destroy(): void;
}

/** The `html` rendering's light-DOM document, shown through the viewport's shadow root. @internal */
export interface HtmlSurface {
  readonly container: HTMLElement;
  /** Writes `markdown`'s HTML unless it is the text written last. */
  render(markdown: string): void;
  show(shown: boolean): void;
  laidOut(): boolean;
  topAnchor(scroller: HTMLElement): ViewportAnchor;
  scrollTo(scroller: HTMLElement, anchor: ViewportAnchor): void;
  destroy(): void;
}

/** A span of the document, as CodeMirror's visible ranges are. @internal */
export interface DocumentSpan {
  readonly from: number;
  readonly to: number;
}

/** One replaced span of the old text and what stands in for it. @internal */
export interface TextChange extends DocumentSpan {
  readonly insert: string;
}

/** The dialect spans of each unit decorated last pass, keyed by the unit text. @internal */
export type DialectSpanCache = ReadonlyMap<string, readonly DialectSpan[]>;

/** A node of the editor's markdown syntax tree, typed off `syntaxTree` so no parser package is imported. @internal */
export type EditorSyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/** The editing core's draft, typed off `createMarkdownDraft` so the editor imports nothing from the core but its functions. @internal */
export type EditorDraft = ReturnType<typeof createMarkdownDraft>;

/** One edit the editing core answers. @internal */
export type EditorEdit = NonNullable<ReturnType<typeof wrapSelection>>;

/** An inline construct `wrapSelection` writes. @internal */
export type EditorWrap = Parameters<typeof wrapSelection>[2];
