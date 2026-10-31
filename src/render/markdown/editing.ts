import { rescanUnitBounds, scanBlocks } from "./block";
import { listTasks } from "./task-list";
import type {
  MarkdownBlock,
  MarkdownDraft,
  MarkdownEdit,
  MarkdownListItem,
  MarkdownRange,
  MarkdownTask,
  MarkdownUnitBounds,
  MarkdownWrap,
} from "./types";

const WRAP_MARKERS: Readonly<Record<MarkdownWrap, readonly [open: string, close: string]>> = {
  strong: ["**", "**"],
  emphasis: ["*", "*"],
  inlineCode: ["`", "`"],
  link: ["[", "](url)"],
};

/** The letter each wrap is bound to under Mod, as `KeyboardEvent.key` reports it lower-cased. */
export const MARKDOWN_WRAP_KEYS: Readonly<Record<string, MarkdownWrap>> = Object.freeze({ b: "strong", i: "emphasis", e: "inlineCode", k: "link" });

const LINK_URL = "url";

const MAX_LIST_NUMBER_DIGITS = 9;

interface ItemChain {
  base: number;
  items: readonly MarkdownListItem[];
}

interface ListMarker {
  width: number;
  next: string | null;
}

function assertSelection(message: string, text: string, selection: MarkdownRange): void {
  if (selection.from > selection.to || selection.from < 0 || selection.to > text.length) throw new Error(message);
}

function isLineBreak(char: string | undefined): boolean {
  return char === "\n" || char === "\r";
}

function isBlank(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

function lineEnd(text: string, at: number): number {
  let end = at;
  while (end < text.length && !isLineBreak(text[end])) end++;
  return end;
}

function lineStart(text: string, at: number): number {
  let start = at;
  while (start > 0 && !isLineBreak(text[start - 1])) start--;
  return start;
}

function skipBlanksBack(text: string, at: number): number {
  let position = at;
  while (position > 0 && isBlank(text[position - 1])) position--;
  return position;
}

function findUnit(units: readonly MarkdownUnitBounds[], offset: number): MarkdownUnitBounds | null {
  const last = units.at(-1);
  if (last === undefined || offset < 0 || offset > last.end) return null;
  if (offset === last.end) return last;
  let low = 0;
  let high = units.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((units[middle] as MarkdownUnitBounds).start <= offset) low = middle;
    else high = middle - 1;
  }
  return units[low] ?? null;
}

function containerChildren(node: MarkdownBlock): readonly MarkdownBlock[] | null {
  if (node.type === "blockquote" || node.type === "list" || node.type === "listItem" || node.type === "footnoteDefinition") return node.children;
  return null;
}

function findItemChain(text: string, unit: MarkdownUnitBounds, caret: number): ItemChain | null {
  const document = scanBlocks(text.slice(unit.start, unit.end));
  for (const scanned of document.units) {
    const base = unit.start + scanned.start;
    const items: MarkdownListItem[] = [];
    let level: readonly MarkdownBlock[] = [scanned.node];
    for (;;) {
      const holder = level.find(
        (node) => containerChildren(node) !== null && base + node.start <= caret && caret <= lineEnd(text, base + node.end),
      );
      if (holder === undefined) break;
      if (holder.type === "listItem") items.push(holder);
      level = containerChildren(holder) ?? [];
    }
    if (items.length > 0) return { base, items };
  }
  return null;
}

function readListMarker(text: string, at: number): ListMarker {
  const char = text[at] ?? "";
  if (char === "-" || char === "+" || char === "*") return { width: 1, next: char };
  let end = at;
  while (/\d/.test(text[end] ?? "")) end++;
  const delimiter = text[end] ?? "";
  const following = String(Number(text.slice(at, end)) + 1);
  return { width: end + 1 - at, next: following.length > MAX_LIST_NUMBER_DIGITS ? null : following + delimiter };
}

function holdsOnlyMarker(text: string, item: MarkdownListItem, base: number): boolean {
  if (item.children.length === 0) return true;
  const only = item.children.length === 1 ? item.children[0] : undefined;
  if (only?.type !== "paragraph") return false;
  const content = text.slice(base + only.start, skipBlanksBack(text, base + only.end));
  return content === "[ ]" || content === "[x]" || content === "[X]";
}

function continuationPrefix(text: string, chain: ItemChain, itemStart: number): string {
  const start = lineStart(text, itemStart);
  const prefix = [...text.slice(start, itemStart)];
  const blank = (from: number, width: number): void => {
    for (let at = Math.max(from, start); at < Math.min(from + width, itemStart); at++) prefix[at - start] = " ";
  };
  for (const ancestor of chain.items.slice(0, -1)) {
    const ancestorStart = chain.base + ancestor.start;
    if (ancestorStart < start) continue;
    blank(ancestorStart, readListMarker(text, ancestorStart).width);
    if (ancestor.box !== null) blank(chain.base + ancestor.box, 3);
  }
  return prefix.join("");
}

/** Reads a text into a draft holding its block unit bounds. */
export function createMarkdownDraft(text: string): MarkdownDraft {
  return { text, units: scanBlocks(text).units.map(({ start, end, neutral }) => ({ start, end, neutral })) };
}

/** Brings a draft up to `text`, rescanning only the units around the stretch that changed. */
export function reviseMarkdownDraft(draft: MarkdownDraft, text: string): MarkdownDraft {
  const previous = draft.text;
  if (previous === text) return draft;
  const shorter = Math.min(previous.length, text.length);
  let prefix = 0;
  while (prefix < shorter && previous.charCodeAt(prefix) === text.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (suffix < shorter - prefix && previous.charCodeAt(previous.length - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)) suffix++;
  return { text, units: rescanUnitBounds(text, draft.units, prefix, previous.length - suffix) };
}

/** Answers the edit Enter makes at the end of a list item, a next item or the end of the list, or null where Enter is a plain line break. */
export function continueList(draft: MarkdownDraft, selection: MarkdownRange): MarkdownEdit | null {
  const { text } = draft;
  assertSelection("continueList: selection lies outside the draft's text.", text, selection);
  const caret = selection.from;
  if (selection.to !== caret) return null;
  const unit = findUnit(draft.units, caret);
  if (unit === null) return null;
  const chain = findItemChain(text, unit, caret);
  const item = chain?.items.at(-1);
  if (chain === null || item === undefined) return null;
  const itemStart = chain.base + item.start;
  if (caret < itemStart) return null;

  if (holdsOnlyMarker(text, item, chain.base)) {
    const from = skipBlanksBack(text, itemStart);
    return { from, to: lineEnd(text, caret), insert: "", selection: { from, to: from } };
  }

  if (item.children.at(-1)?.type !== "paragraph") return null;
  const itemLineEnd = lineEnd(text, chain.base + item.end);
  if (!/^[ \t]*$/.test(text.slice(caret, itemLineEnd))) return null;
  const marker = readListMarker(text, itemStart).next;
  if (marker === null) return null;

  const contentEnd = skipBlanksBack(text, caret);
  const insert = `\n${continuationPrefix(text, chain, itemStart)}${marker} ${item.checked === null ? "" : "[ ] "}`;
  const after = contentEnd + insert.length;
  return { from: contentEnd, to: lineEnd(text, caret), insert, selection: { from: after, to: after } };
}

function runBefore(text: string, at: number, char: string): number {
  let length = 0;
  while (text[at - 1 - length] === char) length++;
  return length;
}

function runAfter(text: string, at: number, char: string): number {
  let length = 0;
  while (text[at + length] === char) length++;
  return length;
}

function linkCloseLength(text: string, selection: MarkdownRange): number | null {
  if (text[selection.from - 1] !== "[" || !text.startsWith("](", selection.to)) return null;
  let depth = 0;
  for (let at = selection.to + 2; at < text.length && !isLineBreak(text[at]); at++) {
    if (text[at] === "(") depth++;
    else if (text[at] === ")") {
      if (depth === 0) return at + 1 - selection.to;
      depth--;
    }
  }
  return null;
}

function wrappedCloseLength(text: string, selection: MarkdownRange, wrap: MarkdownWrap): number | null {
  const { from, to } = selection;
  switch (wrap) {
    case "strong":
      return runBefore(text, from, "*") >= 2 && runAfter(text, to, "*") >= 2 ? 2 : null;
    case "emphasis":
      return runBefore(text, from, "*") % 2 === 1 && runAfter(text, to, "*") % 2 === 1 ? 1 : null;
    case "inlineCode":
      return runBefore(text, from, "`") === 1 && runAfter(text, to, "`") === 1 ? 1 : null;
    case "link":
      return linkCloseLength(text, selection);
  }
}

/** Answers the edit that writes `wrap`'s markers around the selection, or removes them where they already surround it. */
export function wrapSelection(text: string, selection: MarkdownRange, wrap: MarkdownWrap): MarkdownEdit | null {
  assertSelection("wrapSelection: selection lies outside the text.", text, selection);
  const { from, to } = selection;
  const selected = text.slice(from, to);
  const [open, close] = WRAP_MARKERS[wrap];
  const closeLength = wrappedCloseLength(text, selection, wrap);
  if (closeLength !== null) {
    const start = from - open.length;
    return { from: start, to: to + closeLength, insert: selected, selection: { from: start, to: start + selected.length } };
  }
  const inner = from + open.length;
  if (wrap === "link") {
    const url = inner + selected.length + close.indexOf(LINK_URL);
    return { from, to, insert: open + selected + close, selection: { from: url, to: url + LINK_URL.length } };
  }
  return { from, to, insert: open + selected + close, selection: { from: inner, to: inner + selected.length } };
}

function unitTasks(draft: MarkdownDraft, offset: number): { readonly start: number; readonly tasks: readonly MarkdownTask[] } | null {
  if (offset < 0 || offset >= draft.text.length) return null;
  const unit = findUnit(draft.units, offset);
  if (unit === null) return null;
  return { start: unit.start, tasks: listTasks(scanBlocks(draft.text.slice(unit.start, unit.end))) };
}

/** Answers the offsets of the task boxes in the block unit holding `offset`, as `toggleTask` reads them. @internal */
export function unitTaskBoxes(draft: MarkdownDraft, offset: number): readonly number[] {
  const found = unitTasks(draft, offset);
  return found === null ? [] : found.tasks.map((task) => found.start + task.offset);
}

/** Answers the edit that flips the task box whose `[` sits at `offset`, or null where `listTasks` sees no box there. */
export function toggleTask(draft: MarkdownDraft, offset: number): MarkdownEdit | null {
  const found = unitTasks(draft, offset);
  const target = found?.tasks.find((task) => found.start + task.offset === offset);
  if (target === undefined) return null;
  return { from: offset + 1, to: offset + 2, insert: target.checked ? " " : "x", selection: null };
}
