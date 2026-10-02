import { describe, expect, it } from "bun:test";

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

import { markdownSyntax, topLevelUnits } from "./syntax";

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: markdownSyntax() });
}

function strikethroughText(doc: string): string[] {
  const struck: string[] = [];
  ensureSyntaxTree(stateOf(doc), doc.length, 10_000)?.iterate({
    enter: (node) => void (node.name === "Strikethrough" && struck.push(doc.slice(node.from, node.to))),
  });
  return struck;
}

describe("markdownSyntax strikethrough", () => {
  it("strikes text between two-tilde runs", () => {
    expect(strikethroughText("a ~~x~~ b")).toEqual(["~~x~~"]);
  });

  it("strikes nothing between three-tilde runs", () => {
    expect(strikethroughText("a ~~~x~~~ b")).toEqual([]);
  });

  it("strikes nothing when the closing run is three tildes", () => {
    expect(strikethroughText("a ~~x~~~ b")).toEqual([]);
  });

  it("strikes the two tildes left after an escaped one", () => {
    expect(strikethroughText("\\~~~x~~")).toEqual(["~~x~~"]);
  });
});

function unitNames(doc: string): string[] {
  return topLevelUnits(stateOf(doc)).map((unit) => unit.name);
}

describe("topLevelUnits", () => {
  it("lists a heading, each bullet item and a paragraph as separate units", () => {
    expect(unitNames("# A\n\n- one\n- two\n\npara\n")).toEqual(["ATXHeading1", "ListItem", "ListItem", "Paragraph"]);
  });

  it("counts ordered-list items one by one", () => {
    expect(unitNames("1. one\n2. two\n3. three\n")).toEqual(["ListItem", "ListItem", "ListItem"]);
  });

  it("keeps a nested item inside its top-level item", () => {
    expect(unitNames("- one\n  - inner\n- two\n")).toEqual(["ListItem", "ListItem"]);
  });

  it("lists nothing for an empty document", () => {
    expect(unitNames("")).toEqual([]);
  });
});
