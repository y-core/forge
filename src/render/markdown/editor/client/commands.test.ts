import { describe, expect, it } from "bun:test";

import { undo } from "@codemirror/commands";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import type { SelectionRange, StateCommand, Transaction } from "@codemirror/state";
import fc from "fast-check";

import { createMarkdownDraft } from "../../editing";
import { continueListCommand, draftOf, editTransaction, viewportDraft, viewportKeymap, wrapCommand } from "./commands";
import { createViewportState, replaceTransaction } from "./mount";
import type { EditorWrap } from "./types";

function opened(markdown: string, selection: SelectionRange, mode: "edit" | "view" = "edit"): EditorState {
  const state = createViewportState({ markdown, mode, rendering: "raw", label: "Page body" });
  return state.update({ selection }).state;
}

function multiSelected(markdown: string, ranges: readonly SelectionRange[]): EditorState {
  const state = opened(markdown, EditorSelection.cursor(0));
  const multiple = state.update({ effects: StateEffect.appendConfig.of(EditorState.allowMultipleSelections.of(true)) }).state;
  return multiple.update({ selection: EditorSelection.create([...ranges]) }).state;
}

function run(command: StateCommand, state: EditorState): Transaction | null {
  let next: Transaction | null = null;
  command({
    state,
    dispatch: (tr) => {
      next = tr;
    },
  });
  return next;
}

function ran(command: StateCommand, state: EditorState): { readonly ran: boolean; readonly tr: Transaction | null } {
  let tr: Transaction | null = null;
  const done = command({
    state,
    dispatch: (next) => {
      tr = next;
    },
  });
  return { ran: done, tr };
}

function outcome(tr: Transaction | null) {
  return tr === null ? null : { doc: tr.state.doc.toString(), from: tr.state.selection.main.from, to: tr.state.selection.main.to };
}

const EDIT_TOKENS = ["\r\n", "\r", "\n", " ", "\u00A0", "\uD83D\uDE00", "\uFEFF", "a", "# ", "- [ ] ", "1. ", "> ", "|", "`", "[["] as const;
const editText = fc.string({ unit: fc.constantFrom(...EDIT_TOKENS), maxLength: 12 });
const edit = fc.record({ from: fc.nat({ max: 200 }), to: fc.nat({ max: 200 }), insert: editText });

describe("draftOf", () => {
  it("drafts the text on open as the editing core drafts it", () => {
    expect(draftOf(opened("- a\n\n1. b", EditorSelection.cursor(0)))).toEqual(createMarkdownDraft("- a\n\n1. b"));
  });

  it("revises the draft through any run of edits to equal a fresh draft of the resulting text", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(...EDIT_TOKENS), maxLength: 40 }), fc.array(edit, { maxLength: 20 }), (doc, edits) => {
        let state = opened(doc, EditorSelection.cursor(0));
        for (const { from, to, insert } of edits) {
          const length = state.doc.length;
          state = state.update({ changes: { from: Math.min(from, to, length), to: Math.min(Math.max(from, to), length), insert } }).state;
        }
        expect(draftOf(state)).toEqual(createMarkdownDraft(state.doc.toString()));
      }),
      { numRuns: 300 },
    );
  });

  it("keeps the same draft object through a transaction that only moves the selection", () => {
    const state = opened("- a\n- b", EditorSelection.cursor(0));

    expect(draftOf(state.update({ selection: EditorSelection.cursor(5) }).state)).toBe(draftOf(state));
  });

  it("drafts nothing on an edit until a command reads the draft", () => {
    const state = opened("- a", EditorSelection.cursor(0));
    draftOf(state);

    expect(state.update({ changes: { from: 3, insert: "b" } }).state.field(viewportDraft).draft).toBeUndefined();
  });

  it("drafts the replaced text after a replace", () => {
    const state = opened("one\ntwo", EditorSelection.cursor(0));

    expect(draftOf(state.update(replaceTransaction(state, "ONE\n- two\n")).state).text).toBe("ONE\n- two\n");
  });
});

describe("continueListCommand", () => {
  it("starts the next numbered item at the end of an item as one input edit", () => {
    const tr = run(continueListCommand, opened("1. one", EditorSelection.cursor(6)));

    expect([outcome(tr), tr?.isUserEvent("input")]).toEqual([{ doc: "1. one\n2. ", from: 10, to: 10 }, true]);
  });

  it("starts an open task after a task", () => {
    expect(outcome(run(continueListCommand, opened("- [ ] a", EditorSelection.cursor(7))))).toEqual({ doc: "- [ ] a\n- [ ] ", from: 14, to: 14 });
  });

  it("ends the list on an empty item, leaving the caret on the emptied line", () => {
    const doc = "1. one\n2. two\n3. ";

    expect(outcome(run(continueListCommand, opened(doc, EditorSelection.cursor(doc.length))))).toEqual({
      doc: "1. one\n2. two\n",
      from: 14,
      to: 14,
    });
  });

  const DECLINED: readonly { readonly name: string; readonly state: EditorState }[] = [
    { name: "outside a list", state: opened("a", EditorSelection.cursor(1)) },
    { name: "over a non-empty selection in an item", state: opened("- a", EditorSelection.range(2, 3)) },
    { name: "in view mode at the end of an item", state: opened("1. one", EditorSelection.cursor(6), "view") },
  ];

  for (const { name, state } of DECLINED) {
    it(`declines ${name} and dispatches nothing`, () => {
      expect(ran(continueListCommand, state)).toEqual({ ran: false, tr: null });
    });
  }

  it("continues the item at every caret, breaking the line plainly at a caret outside a list", () => {
    const state = multiSelected("- a\n- b\n\nc", [EditorSelection.cursor(3), EditorSelection.cursor(7), EditorSelection.cursor(10)]);
    const tr = run(continueListCommand, state);

    expect([tr?.state.doc.toString(), tr?.state.selection.ranges.map((range) => range.head)]).toEqual(["- a\n- \n- b\n- \n\nc\n", [6, 13, 17]]);
  });

  it("is undone in one step", () => {
    const tr = run(continueListCommand, opened("- a", EditorSelection.cursor(3)));
    if (tr === null) throw new Error("continueListCommand dispatched nothing");

    expect(outcome(run(undo, tr.state))?.doc).toBe("- a");
  });
});

describe("wrapCommand", () => {
  const WRAPS: readonly { readonly wrap: EditorWrap; readonly doc: string; readonly from: number; readonly to: number }[] = [
    { wrap: "strong", doc: "**word**", from: 2, to: 6 },
    { wrap: "emphasis", doc: "*word*", from: 1, to: 5 },
    { wrap: "inlineCode", doc: "`word`", from: 1, to: 5 },
    { wrap: "link", doc: "[word](url)", from: 7, to: 10 },
  ];

  for (const { wrap, doc, from, to } of WRAPS) {
    it(`wraps the selected word as ${wrap} in one format edit, selecting ${doc.slice(from, to)}`, () => {
      const tr = run(wrapCommand(wrap), opened("word", EditorSelection.range(0, 4)));

      expect([outcome(tr), tr?.isUserEvent("input.format")]).toEqual([{ doc, from, to }, true]);
    });

    it(`unwraps ${doc} back to the word with the word selected`, () => {
      const word = doc.indexOf("word");

      expect(outcome(run(wrapCommand(wrap), opened(doc, EditorSelection.range(word, word + 4))))).toEqual({ doc: "word", from: 0, to: 4 });
    });
  }

  it("wraps every selected range, keeping each selected", () => {
    const state = multiSelected("one two", [EditorSelection.range(0, 3), EditorSelection.range(4, 7)]);
    const tr = run(wrapCommand("strong"), state);

    expect([tr?.state.doc.toString(), tr?.state.selection.ranges.map(({ from, to }) => [from, to])]).toEqual([
      "**one** **two**",
      [
        [2, 5],
        [10, 13],
      ],
    ]);
  });

  it("writes empty strong markers on an empty text with the caret between them", () => {
    expect(outcome(run(wrapCommand("strong"), opened("", EditorSelection.cursor(0))))).toEqual({ doc: "****", from: 2, to: 2 });
  });

  it("declines in view mode and dispatches nothing", () => {
    expect(ran(wrapCommand("strong"), opened("word", EditorSelection.range(0, 4), "view"))).toEqual({ ran: false, tr: null });
  });
});

describe("viewportKeymap", () => {
  it("binds Enter to list continuation", () => {
    expect(viewportKeymap.find((binding) => binding.key === "Enter")?.run).toBe(continueListCommand);
  });
});

describe("editTransaction", () => {
  it("omits the selection when the edit leaves it where the change maps it", () => {
    expect(editTransaction({ from: 1, to: 2, insert: "x", selection: null }, "input")).toEqual({
      changes: { from: 1, to: 2, insert: "x" },
      userEvent: "input",
    });
  });

  it("selects the edit's range from its start as anchor to its end as head", () => {
    expect(editTransaction({ from: 0, to: 4, insert: "**word**", selection: { from: 2, to: 6 } }, "input.format")).toEqual({
      changes: { from: 0, to: 4, insert: "**word**" },
      selection: { anchor: 2, head: 6 },
      userEvent: "input.format",
    });
  });
});
