import { describe, expect, test } from "bun:test";

import { appendItem, createItem, isEmphasisChar, moveSiblings, processEmphasis, pushDelimiter, unlinkItem } from "./delimiter";
import type { Delimiter, DelimiterStack, Item } from "./types";

const ASTERISK = 0x2a;
const EQUALS_SIGN = 0x3d;
const TILDE = 0x7e;

function childrenOf(item: Item): string[] {
  const out: string[] = [];
  for (let child = item.first; child !== null; child = child.next)
    out.push(
      child.kind === "text" ? child.value : `${child.kind === "extension" ? child.extensionType : child.kind}(${childrenOf(child).join(",")})`,
    );
  return out;
}

function run(root: Item, at: number, char: number, count: number, flanking: { canOpen: boolean; canClose: boolean }, exact = false): Delimiter {
  const item = createItem("text", at, at + count, String.fromCharCode(char).repeat(count));
  appendItem(root, item);
  return { item, position: at, char, count, original: count, ...flanking, exact, prev: null, next: null };
}

function text(root: Item, at: number, value: string): void {
  appendItem(root, createItem("text", at, at + value.length, value));
}

describe("the item list", () => {
  test("appends children in order and unlinks one from the middle", () => {
    const root = createItem("root", 0, 3);
    const [a, b, c] = ["a", "b", "c"].map((value, at) => createItem("text", at, at + 1, value)) as [Item, Item, Item];
    for (const item of [a, b, c]) appendItem(root, item);
    unlinkItem(b);
    expect([childrenOf(root), b.parent, b.prev, b.next]).toEqual([["a", "c"], null, null, null]);
  });

  test("moves the siblings between two items into a container, in order", () => {
    const root = createItem("root", 0, 4);
    const items = ["a", "b", "c", "d"].map((value, at) => createItem("text", at, at + 1, value));
    for (const item of items) appendItem(root, item);
    const container = createItem("emphasis", 1, 3);
    moveSiblings(items[0] as Item, items[3] as Item, container);
    expect([childrenOf(root), childrenOf(container)]).toEqual([
      ["a", "d"],
      ["b", "c"],
    ]);
  });
});

describe("processEmphasis", () => {
  test("wraps the run between a matched single opener and closer in emphasis", () => {
    const root = createItem("root", 0, 3);
    const stack: DelimiterStack = { top: null, exactTypes: new Map() };
    pushDelimiter(stack, run(root, 0, ASTERISK, 1, { canOpen: true, canClose: false }));
    text(root, 1, "a");
    pushDelimiter(stack, run(root, 2, ASTERISK, 1, { canOpen: false, canClose: true }));
    processEmphasis(stack, null);
    expect([childrenOf(root), stack.top]).toEqual([["emphasis(a)"], null]);
  });

  test("uses two of a run on each side for strong emphasis and leaves the rest", () => {
    const root = createItem("root", 0, 7);
    const stack: DelimiterStack = { top: null, exactTypes: new Map() };
    pushDelimiter(stack, run(root, 0, ASTERISK, 3, { canOpen: true, canClose: false }));
    text(root, 3, "a");
    pushDelimiter(stack, run(root, 4, ASTERISK, 2, { canOpen: false, canClose: true }));
    processEmphasis(stack, null);
    expect(childrenOf(root)).toEqual(["*", "strong(a)"]);
  });

  test("wraps an exact two-character run in the node type the stack names for it", () => {
    const root = createItem("root", 0, 5);
    const stack: DelimiterStack = { top: null, exactTypes: new Map([[EQUALS_SIGN, "highlight"]]) };
    pushDelimiter(stack, run(root, 0, EQUALS_SIGN, 2, { canOpen: true, canClose: false }, true));
    text(root, 2, "a");
    pushDelimiter(stack, run(root, 3, EQUALS_SIGN, 2, { canOpen: false, canClose: true }, true));
    processEmphasis(stack, null);
    expect(childrenOf(root)).toEqual(["highlight(a)"]);
  });

  test("leaves an unmatched closer as text and clears the stack above the bottom", () => {
    const root = createItem("root", 0, 2);
    const stack: DelimiterStack = { top: null, exactTypes: new Map([[TILDE, "delete"]]) };
    text(root, 0, "a");
    pushDelimiter(stack, run(root, 1, ASTERISK, 1, { canOpen: false, canClose: true }));
    processEmphasis(stack, null);
    expect([childrenOf(root), stack.top]).toEqual([["a", "*"], null]);
  });
});

describe("isEmphasisChar", () => {
  test("answers true only for CommonMark's own * and _", () => {
    expect([0x2a, 0x5f, TILDE, EQUALS_SIGN].map(isEmphasisChar)).toEqual([true, true, false, false]);
  });
});
