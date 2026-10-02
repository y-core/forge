import type { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

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

/** Whether the viewport hides markdown marks off the cursor's line or shows the raw text. */
export type ViewportRendering = "rendered" | "raw";

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

/** The markdown dialect the viewport decorates: where its constructs sit in a unit, which callout kinds it reads, and its own styles. */
export interface ViewportDialect {
  readonly spans: (text: string) => readonly DialectSpan[];
  readonly calloutKinds: readonly string[];
  readonly theme?: Extension | undefined;
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
}

/** The only surface through which the app drives the viewport, which is created once and never re-created. */
export interface ViewportController {
  setMode(mode: ViewportMode): void;
  setRendering(rendering: ViewportRendering): void;
  topAnchor(): ViewportAnchor;
  scrollTo(anchor: ViewportAnchor): void;
  getMarkdown(): string;
  destroy(): void;
}

/** A span of the document, as CodeMirror's visible ranges are. @internal */
export interface DocumentSpan {
  readonly from: number;
  readonly to: number;
}

/** The dialect spans of each unit decorated last pass, keyed by the unit text. @internal */
export type DialectSpanCache = ReadonlyMap<string, readonly DialectSpan[]>;

/** A node of the editor's markdown syntax tree, typed off `syntaxTree` so no parser package is imported. @internal */
export type EditorSyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;
