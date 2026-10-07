import { describe, expect, it } from "bun:test";

import { redo, undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import type { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { WidgetType } from "@codemirror/view";
import fc from "fast-check";

import { buildDecorations } from "./decorations";
import { TEST_DIALECT } from "./dialect.fixture";
import { revealActiveLines } from "./hybrid";
import type { ViewportMode, ViewportRendering } from "./mod";
import { createViewportState, replaceTransaction, viewportEffects } from "./mount";
import { ROUND_TRIP_MARKDOWN } from "./round-trip.fixture";
import { renderedWidget } from "./widget-dom.fixture";

interface Viewport {
  readonly mode: ViewportMode;
  readonly rendering: ViewportRendering;
}

const STATES: readonly Viewport[] = [
  { mode: "edit", rendering: "rendered" },
  { mode: "edit", rendering: "raw" },
  { mode: "view", rendering: "rendered" },
  { mode: "view", rendering: "raw" },
];

function opened(at: Viewport, markdown = ROUND_TRIP_MARKDOWN): EditorState {
  return createViewportState({ markdown, mode: at.mode, rendering: at.rendering, label: "Page body", dialect: TEST_DIALECT });
}

function switched(state: EditorState, to: Viewport): EditorState {
  return state.update({ effects: viewportEffects(to.mode, to.rendering) }).state;
}

function behaviour(state: EditorState) {
  return {
    readOnly: state.readOnly,
    editable: state.facet(EditorView.editable),
    reveal: state.facet(revealActiveLines),
    atomicSources: state.facet(EditorView.atomicRanges).length,
  };
}

function expectedBehaviour(at: Viewport) {
  return {
    readOnly: at.mode === "view",
    editable: at.mode === "edit",
    reveal: at.mode === "edit",
    atomicSources: at.rendering === "rendered" ? 1 : 0,
  };
}

function typed(state: EditorState, text: string): EditorState {
  return state.update({ changes: { from: state.doc.length, insert: text }, userEvent: "input.type" }).state;
}

function ran(command: typeof undo, state: EditorState): { readonly ran: boolean; readonly state: EditorState } {
  let next = state;
  const done = command({
    state,
    dispatch: (tr: Transaction) => {
      next = tr.state;
    },
  });
  return { ran: done, state: next };
}

function checkboxesDisabled(state: EditorState): unknown[] {
  const disabled: unknown[] = [];
  buildDecorations(state, [{ from: 0, to: state.doc.length }]).atomic.between(0, state.doc.length, (_from, _to, decoration) => {
    const { widget } = decoration.spec as { widget?: WidgetType };
    if (widget) disabled.push(renderedWidget(widget).disabled);
  });
  return disabled;
}

function name(at: Viewport): string {
  return `${at.mode} + ${at.rendering}`;
}

const EDIT_TOKENS = ["\r\n", "\r", "\n", " ", "\u00A0", "\uD83D\uDE00", "\uFEFF", "a", "# ", "- [ ] ", "|", "`", "[["] as const;
const editText = fc.string({ unit: fc.constantFrom(...EDIT_TOKENS), maxLength: 12 });
const edit = fc.record({ from: fc.nat({ max: 200 }), to: fc.nat({ max: 200 }), insert: editText });

describe("createViewportState", () => {
  for (const at of STATES) {
    it(`opens ${name(at)} read-only only in view, editable only in edit, revealing only in edit, rendered layer only when rendered`, () => {
      expect(behaviour(opened(at))).toEqual(expectedBehaviour(at));
    });
  }

  it("holds the markdown it was given byte for byte", () => {
    expect(opened(STATES[0] as Viewport).doc.toString()).toBe(ROUND_TRIP_MARKDOWN);
  });

  it("edits applied to the viewport's state equal the same edits applied to a plain string, byte for byte", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(...EDIT_TOKENS), maxLength: 40 }), fc.array(edit, { maxLength: 20 }), (doc, edits) => {
        let state = opened({ mode: "edit", rendering: "rendered" }, doc);
        let expected = doc;
        for (const { from, to, insert } of edits) {
          const start = Math.min(from, to, expected.length);
          const end = Math.min(Math.max(from, to), expected.length);
          state = state.update({ changes: { from: start, to: end, insert } }).state;
          expected = expected.slice(0, start) + insert + expected.slice(end);
        }
        expect(state.doc.toString()).toBe(expected);
      }),
      { numRuns: 300 },
    );
  });
});

describe("viewportEffects", () => {
  for (const from of STATES) {
    const neighbours = [
      { mode: from.mode === "edit" ? "view" : "edit", rendering: from.rendering } satisfies Viewport,
      { mode: from.mode, rendering: from.rendering === "rendered" ? "raw" : "rendered" } satisfies Viewport,
    ];
    for (const to of neighbours) {
      it(`switches ${name(from)} to ${name(to)} with the text byte-identical and the new behaviour in force`, () => {
        const next = switched(opened(from), to);

        expect([next.doc.toString(), behaviour(next)]).toEqual([ROUND_TRIP_MARKDOWN, expectedBehaviour(to)]);
      });
    }
  }

  it("disables the rendered task checkbox after a switch to view, and enables it again after the switch back to edit", () => {
    const editing = opened({ mode: "edit", rendering: "rendered" }, "- [ ] call");
    const viewing = switched(editing, { mode: "view", rendering: "rendered" });
    const back = switched(viewing, { mode: "edit", rendering: "rendered" });

    expect([checkboxesDisabled(editing), checkboxesDisabled(viewing), checkboxesDisabled(back)]).toEqual([[false], [true], [false]]);
  });

  it("keeps the text byte-identical through every state twice over", () => {
    let state = opened({ mode: "view", rendering: "rendered" });
    const seen: string[] = [];

    for (const to of [...STATES, ...STATES]) {
      state = switched(state, to);
      seen.push(state.doc.toString());
    }

    expect(seen).toEqual(Array.from({ length: 8 }, () => ROUND_TRIP_MARKDOWN));
  });
});

describe("the viewport's history", () => {
  it("undoes and redoes an edit made before a switch to view and back", () => {
    const edited = typed(opened({ mode: "edit", rendering: "rendered" }), " Z");
    const back = switched(switched(edited, { mode: "view", rendering: "rendered" }), { mode: "edit", rendering: "rendered" });

    const undone = ran(undo, back);
    const redone = ran(redo, undone.state);

    expect([undone.ran, undone.state.doc.toString(), redone.ran, redone.state.doc.toString()]).toEqual([
      true,
      ROUND_TRIP_MARKDOWN,
      true,
      `${ROUND_TRIP_MARKDOWN} Z`,
    ]);
  });

  it("undoes an edit made before a switch to raw", () => {
    const edited = typed(opened({ mode: "edit", rendering: "rendered" }), " Z");

    const undone = ran(undo, switched(edited, { mode: "edit", rendering: "raw" }));

    expect([undone.ran, undone.state.doc.toString()]).toEqual([true, ROUND_TRIP_MARKDOWN]);
  });

  for (const rendering of ["rendered", "raw"] as const) {
    it(`refuses undo and redo in view + ${rendering}, leaving the edit in place`, () => {
      const edited = typed(opened({ mode: "edit", rendering }), " Z");
      const viewing = switched(edited, { mode: "view", rendering });

      const undone = ran(undo, viewing);
      const redone = ran(redo, ran(undo, edited).state.update({ effects: viewportEffects("view", rendering) }).state);

      expect([undone.ran, undone.state.doc.toString(), redone.ran, redone.state.doc.toString()]).toEqual([
        false,
        `${ROUND_TRIP_MARKDOWN} Z`,
        false,
        ROUND_TRIP_MARKDOWN,
      ]);
    });
  }
});

describe("replaceTransaction", () => {
  const EDIT = { mode: "edit", rendering: "rendered" } as const;

  function replaced(state: EditorState, markdown: string, preserveSelection?: boolean): EditorState {
    return state.update(replaceTransaction(state, markdown, preserveSelection === undefined ? {} : { preserveSelection })).state;
  }

  function selectedAt(markdown: string, anchor: number, head = anchor): EditorState {
    const state = opened(EDIT, markdown);
    return state.update({ selection: EditorSelection.single(anchor, head) }).state;
  }

  it("leaves any text it is given in the viewport byte for byte", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(...EDIT_TOKENS), maxLength: 40 }), editText, editText, (doc, a, b) => {
        for (const next of [`${a}${doc}${b}`, `${b}${doc}`, a, ""]) {
          expect(replaced(opened(EDIT, doc), next, true).doc.toString()).toBe(next);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("keeps a cursor between two changed lines on the same text when preserveSelection is set", () => {
    const before = "alpha\nbeta\ngamma\n";
    const after = "ALPHA\nbeta\nGAMMA\n";
    const state = replaced(selectedAt(before, before.indexOf("beta") + 2), after, true);

    expect(state.selection.main.head).toBe(after.indexOf("beta") + 2);
  });

  it("keeps a cursor after the changed span on the same text when preserveSelection is set", () => {
    const before = "alpha\nbeta\ngamma\n";
    const after = "alpha\nBETA ADDED\ngamma\n";
    const state = replaced(selectedAt(before, before.indexOf("gamma") + 2), after, true);

    expect(state.selection.main.head).toBe(after.indexOf("gamma") + 2);
  });

  it("keeps a selection before the changed span where it was when preserveSelection is set", () => {
    const state = replaced(selectedAt("alpha\nbeta\n", 1, 4), "alpha\nBETA\n", true);

    expect([state.selection.main.anchor, state.selection.main.head]).toEqual([1, 4]);
  });

  it("returns the cursor to the start without preserveSelection", () => {
    const state = replaced(selectedAt("alpha\nbeta\n", 8), "alpha\nBETA\n");

    expect([state.selection.main.anchor, state.selection.main.head]).toEqual([0, 0]);
  });

  it("is a single transaction undo skips, so undo reverts the edit before it and leaves the replaced text", () => {
    const edited = typed(opened(EDIT, "one\ntwo\n"), "three");
    const swapped = replaced(edited, "ONE\ntwo\nthree");

    const undone = ran(undo, swapped);

    expect([undone.ran, undone.state.doc.toString()]).toEqual([true, "ONE\ntwo\n"]);
  });

  it("leaves nothing to undo when it is the only change", () => {
    const swapped = replaced(opened(EDIT, "one"), "two");

    expect(ran(undo, swapped).ran).toBe(false);
  });

  it("changes the text of a read-only viewport", () => {
    expect(replaced(opened({ mode: "view", rendering: "raw" }, "one"), "two").doc.toString()).toBe("two");
  });
});
