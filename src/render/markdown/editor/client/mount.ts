import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands";
import { forceParsing, syntaxTree } from "@codemirror/language";
import { Annotation, Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import type { Extension, Line, StateEffect, TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { viewportDraft, viewportKeymap } from "./commands";
import { viewportDialect } from "./dialect";
import { createHtmlSurface } from "./html";
import { hybridRendering, revealActiveLines } from "./hybrid";
import { markdownSyntax } from "./syntax";
import { textChanges } from "./text-changes";
import { editorTheme } from "./theme";
import type {
  HtmlSurface,
  ViewportAnchor,
  ViewportController,
  ViewportDialect,
  ViewportMode,
  ViewportOptions,
  ViewportRendering,
  ViewportReplaceOptions,
} from "./types";

const MODE = new Compartment();
const RENDERING = new Compartment();
const REPLACED = Annotation.define<true>();
const PLACEMENT_FRAMES = 60;
const PARSE_BUDGET_MS = 50;
const READER_POINTER_EVENTS = ["wheel", "touchstart", "pointerdown"] as const;
const READER_SCROLL_KEYS: ReadonlySet<string> = new Set([
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  " ",
]);

type ViewportStateOptions = Pick<ViewportOptions, "markdown" | "mode" | "rendering" | "label" | "dialect"> & {
  readonly onChange?: (() => void) | undefined;
};

function modeExtension(mode: ViewportMode): Extension {
  if (mode === "edit") return [EditorView.editable.of(true), revealActiveLines.of(true)];
  return [EditorView.editable.of(false), EditorState.readOnly.of(true)];
}

function renderingExtension(rendering: ViewportRendering): Extension {
  return rendering === "styled" ? hybridRendering() : [];
}

function effectiveMode(mode: ViewportMode, rendering: ViewportRendering): ViewportMode {
  return rendering === "html" ? "view" : mode;
}

function dialectHtml(dialect: ViewportDialect | undefined): (markdown: string) => string {
  if (dialect?.html === undefined) throw new TypeError('[markdown viewport] the "html" rendering needs a dialect with `html`');
  return dialect.html;
}

/** Answers the effects that reconfigure a viewport state to the given mode and rendering, read-only whatever the mode while it is `html`. @internal */
export function viewportEffects(mode: ViewportMode, rendering: ViewportRendering): StateEffect<unknown>[] {
  return [MODE.reconfigure(modeExtension(effectiveMode(mode, rendering))), RENDERING.reconfigure(renderingExtension(rendering))];
}

/** Answers the one transaction that turns the viewport's text into `markdown`, changing only the lines that differ. @internal */
export function replaceTransaction(state: EditorState, markdown: string, options: ViewportReplaceOptions = {}): TransactionSpec {
  return {
    changes: textChanges(state.doc.toString(), markdown),
    ...(options.preserveSelection === true ? {} : { selection: EditorSelection.cursor(0) }),
    annotations: [Transaction.addToHistory.of(false), REPLACED.of(true)],
  };
}

/** Creates the viewport's editor state, with mode and rendering each in its own compartment. @internal */
export function createViewportState(options: ViewportStateOptions): EditorState {
  const { onChange } = options;
  if (options.rendering === "html") dialectHtml(options.dialect);
  return EditorState.create({
    doc: options.markdown,
    extensions: [
      markdownSyntax(),
      viewportDraft,
      history(),
      keymap.of([...viewportKeymap, { key: "Enter", run: insertNewline }, ...historyKeymap, ...defaultKeymap]),
      EditorView.lineWrapping,
      editorTheme,
      options.dialect === undefined ? [] : [viewportDialect.of(options.dialect), options.dialect.theme ?? []],
      EditorView.contentAttributes.of({ "aria-label": options.label, "aria-multiline": "true" }),
      MODE.of(modeExtension(effectiveMode(options.mode, options.rendering))),
      RENDERING.of(renderingExtension(options.rendering)),
      EditorView.updateListener.of((update) => {
        if (update.transactions.some((tr) => tr.docChanged && tr.annotation(REPLACED) === undefined)) onChange?.();
      }),
    ],
  });
}

/** Mounts the markdown viewport in the host's shadow root and returns the controller that drives it. */
export function mountMarkdownViewport(host: HTMLElement, options: ViewportOptions): ViewportController {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const view = new EditorView({ root: shadow, parent: shadow, state: createViewportState(options) });
  const { scroller } = options;
  let mode = options.mode;
  let rendering = options.rendering;
  let surface: HtmlSurface | null = null;
  let placement = 0;
  let releasePlacement = (): void => {};

  const htmlSurface = (): HtmlSurface => (surface ??= createHtmlSurface(host, shadow, dialectHtml(options.dialect), options.onHtml));
  const showingHtml = (): HtmlSurface | null => (rendering === "html" ? surface : null);

  // Shown before it is written, so `onHtml` meets a laid-out container it can focus into.
  const showRendering = (): void => {
    view.dom.hidden = rendering === "html";
    if (rendering !== "html") return surface?.show(false);
    const shown = htmlSurface();
    shown.show(true);
    shown.render(view.state.doc.toString());
  };

  const isLaidOut = (): boolean => showingHtml()?.laidOut() ?? view.dom.getClientRects().length > 0;

  const topAnchor = (): ViewportAnchor => {
    const html = showingHtml();
    if (html !== null) return html.topAnchor(scroller);
    const { doc } = view.state;
    const top = scroller.getBoundingClientRect().top;
    let line = doc.lineAt(view.lineBlockAtHeight(top - view.documentTop).from);
    while (line.text.trim() === "" && line.number < doc.lines) line = doc.line(line.number + 1);
    return { line: line.number, top: view.documentTop + view.lineBlockAt(line.from).top };
  };

  const anchorLine = (anchor: ViewportAnchor): Line => {
    const { doc } = view.state;
    return doc.line(Math.min(Math.max(anchor.line, 1), doc.lines));
  };

  const cancelPlacement = (): void => {
    placement += 1;
    releasePlacement();
  };

  const watchReader = (): void => {
    const doc = scroller.ownerDocument;
    const onKey = (event: KeyboardEvent): void => {
      if (READER_SCROLL_KEYS.has(event.key)) cancelPlacement();
    };
    for (const type of READER_POINTER_EVENTS) scroller.addEventListener(type, cancelPlacement, { capture: true, passive: true });
    doc.addEventListener("keydown", onKey, true);
    releasePlacement = () => {
      for (const type of READER_POINTER_EVENTS) scroller.removeEventListener(type, cancelPlacement, true);
      doc.removeEventListener("keydown", onKey, true);
      releasePlacement = () => {};
    };
  };

  const placeAnchor = (anchor: ViewportAnchor, request: number, frames: number): void => {
    view.requestMeasure({
      read: () => {
        if (request !== placement || !isLaidOut()) return null;
        const line = anchorLine(anchor);
        return { shift: view.documentTop + view.lineBlockAt(line.from).top - anchor.top, parsed: syntaxTree(view.state).length >= line.to };
      },
      write: (placed) => {
        if (request !== placement) return;
        const settled = placed === null || (placed.parsed && Math.abs(placed.shift) < 1);
        if (!settled) scroller.scrollTop += placed.shift;
        if (settled || frames <= 1) return releasePlacement();
        queueMicrotask(() => placeAnchor(anchor, request, frames - 1));
      },
    });
  };

  const scrollTo = (anchor: ViewportAnchor): void => {
    cancelPlacement();
    const html = showingHtml();
    if (html !== null) return html.scrollTo(scroller, anchor);
    forceParsing(view, anchorLine(anchor).to, PARSE_BUDGET_MS);
    watchReader();
    placeAnchor(anchor, placement, PLACEMENT_FRAMES);
  };

  // The anchor is read off the surface shown before the switch and placed on the one shown after it.
  const reconfigure = (nextMode: ViewportMode, nextRendering: ViewportRendering): void => {
    const anchor = isLaidOut() ? topAnchor() : null;
    mode = nextMode;
    rendering = nextRendering;
    view.dispatch({ effects: viewportEffects(mode, rendering) });
    showRendering();
    if (anchor === null) cancelPlacement();
    else scrollTo(anchor);
  };

  showRendering();

  return {
    setMode: (next) => {
      if (next === mode) return;
      if (rendering === "html") mode = next;
      else reconfigure(next, rendering);
    },
    setRendering: (next) => {
      if (next === rendering) return;
      if (next === "html") dialectHtml(options.dialect);
      reconfigure(mode, next);
    },
    topAnchor,
    scrollTo,
    getMarkdown: () => view.state.doc.toString(),
    replace: (markdown, replaceOptions) => {
      view.dispatch(replaceTransaction(view.state, markdown, replaceOptions));
      showingHtml()?.render(view.state.doc.toString());
    },
    destroy: () => {
      cancelPlacement();
      view.destroy();
      shadow.replaceChildren();
      surface?.destroy();
      surface = null;
    },
  };
}
