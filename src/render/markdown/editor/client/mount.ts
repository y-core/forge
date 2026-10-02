import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands";
import { forceParsing, syntaxTree } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import type { Extension, Line, StateEffect } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { viewportDialect } from "./dialect";
import { hybridRendering, revealActiveLines } from "./hybrid";
import { markdownSyntax } from "./syntax";
import { editorTheme } from "./theme";
import type { ViewportAnchor, ViewportController, ViewportMode, ViewportOptions, ViewportRendering } from "./types";

const MODE = new Compartment();
const RENDERING = new Compartment();
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
  return rendering === "rendered" ? hybridRendering() : [];
}

/** Answers the effects that reconfigure a viewport state to the given mode and rendering. @internal */
export function viewportEffects(mode: ViewportMode, rendering: ViewportRendering): StateEffect<unknown>[] {
  return [MODE.reconfigure(modeExtension(mode)), RENDERING.reconfigure(renderingExtension(rendering))];
}

/** Creates the viewport's editor state, with mode and rendering each in its own compartment. @internal */
export function createViewportState(options: ViewportStateOptions): EditorState {
  const { onChange } = options;
  return EditorState.create({
    doc: options.markdown,
    extensions: [
      markdownSyntax(),
      history(),
      keymap.of([{ key: "Enter", run: insertNewline }, ...historyKeymap, ...defaultKeymap]),
      EditorView.lineWrapping,
      editorTheme,
      options.dialect === undefined ? [] : [viewportDialect.of(options.dialect), options.dialect.theme ?? []],
      EditorView.contentAttributes.of({ "aria-label": options.label, "aria-multiline": "true" }),
      MODE.of(modeExtension(options.mode)),
      RENDERING.of(renderingExtension(options.rendering)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange?.();
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
  let placement = 0;
  let releasePlacement = (): void => {};

  const isLaidOut = (): boolean => view.dom.getClientRects().length > 0;

  const topAnchor = (): ViewportAnchor => {
    const top = scroller.getBoundingClientRect().top;
    const block = view.lineBlockAtHeight(top - view.documentTop);
    return { line: view.state.doc.lineAt(block.from).number, top: view.documentTop + block.top };
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
    forceParsing(view, anchorLine(anchor).to, PARSE_BUDGET_MS);
    watchReader();
    placeAnchor(anchor, placement, PLACEMENT_FRAMES);
  };

  const reconfigure = (): void => {
    const effects = viewportEffects(mode, rendering);
    if (!isLaidOut()) {
      cancelPlacement();
      view.dispatch({ effects });
      return;
    }
    const anchor = topAnchor();
    view.dispatch({ effects });
    scrollTo(anchor);
  };

  return {
    setMode: (next) => {
      if (next === mode) return;
      mode = next;
      reconfigure();
    },
    setRendering: (next) => {
      if (next === rendering) return;
      rendering = next;
      reconfigure();
    },
    topAnchor,
    scrollTo,
    getMarkdown: () => view.state.doc.toString(),
    destroy: () => {
      cancelPlacement();
      view.destroy();
      shadow.replaceChildren();
    },
  };
}
