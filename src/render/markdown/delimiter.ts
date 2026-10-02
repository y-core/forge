import type { Delimiter, DelimiterStack, Item, ItemKind } from "./types";

const ASTERISK = 0x2a;
const UNDERSCORE = 0x5f;

/** Creates an item of a kind spanning `start` to `end` in the leaf's content. @internal */
export function createItem(kind: ItemKind, start: number, end: number, value = ""): Item {
  return {
    kind,
    start,
    end,
    value,
    plain: false,
    literal: false,
    url: "",
    title: null,
    label: "",
    referenceType: "shortcut",
    extension: null,
    extensionType: "",
    construct: null,
    parent: null,
    prev: null,
    next: null,
    first: null,
    last: null,
  };
}

/** Appends an item as its parent's last child. @internal */
export function appendItem(parent: Item, item: Item): void {
  item.parent = parent;
  item.prev = parent.last;
  item.next = null;
  if (parent.last === null) parent.first = item;
  else parent.last.next = item;
  parent.last = item;
}

/** Detaches an item from its parent and siblings. @internal */
export function unlinkItem(item: Item): void {
  const parent = item.parent;
  if (item.prev === null) {
    if (parent !== null) parent.first = item.next;
  } else item.prev.next = item.next;
  if (item.next === null) {
    if (parent !== null) parent.last = item.prev;
  } else item.next.prev = item.prev;
  item.parent = null;
  item.prev = null;
  item.next = null;
}

function insertAfter(anchor: Item, item: Item): void {
  const parent = anchor.parent;
  item.parent = parent;
  item.prev = anchor;
  item.next = anchor.next;
  if (anchor.next === null) {
    if (parent !== null) parent.last = item;
  } else anchor.next.prev = item;
  anchor.next = item;
}

/** Moves every sibling after `from`, up to but excluding `until` (or to the end when null), into `container` in order. @internal */
export function moveSiblings(from: Item, until: Item | null, container: Item): void {
  for (let item = from.next; item !== null && item !== until;) {
    const next = item.next;
    unlinkItem(item);
    appendItem(container, item);
    item = next;
  }
}

/** Pushes a delimiter run on top of the stack. @internal */
export function pushDelimiter(stack: DelimiterStack, delimiter: Delimiter): void {
  delimiter.prev = stack.top;
  delimiter.next = null;
  if (stack.top !== null) stack.top.next = delimiter;
  stack.top = delimiter;
}

function removeDelimiter(stack: DelimiterStack, delimiter: Delimiter): void {
  if (delimiter.prev !== null) delimiter.prev.next = delimiter.next;
  if (delimiter.next === null) stack.top = delimiter.prev;
  else delimiter.next.prev = delimiter.prev;
}

function bottomIndex(closer: Delimiter, exactIndex: ReadonlyMap<number, number>): number {
  if (closer.exact) return 12 + (exactIndex.get(closer.char) ?? 0);
  return (closer.char === UNDERSCORE ? 6 : 0) + (closer.canOpen ? 3 : 0) + (closer.original % 3);
}

function matches(opener: Delimiter, closer: Delimiter): boolean {
  if (opener.char !== closer.char || !opener.canOpen) return false;
  if (closer.exact) return true;
  const oddMatch = (closer.canOpen || opener.canClose) && closer.original % 3 !== 0 && (opener.original + closer.original) % 3 === 0;
  return !oddMatch;
}

/** Resolves every closer above `bottom` against its nearest matching opener, wrapping what lies between, then clears that part of the stack. @internal */
export function processEmphasis(stack: DelimiterStack, bottom: Delimiter | null): void {
  const exactIndex = new Map<number, number>();
  for (const char of stack.exactTypes.keys()) exactIndex.set(char, exactIndex.size);
  const floor = bottom === null ? -1 : bottom.position;
  const openersBottom: number[] = Array.from({ length: 12 + exactIndex.size }, () => floor);

  let closer = stack.top;
  while (closer?.prev != null && closer.prev.position > floor) closer = closer.prev;
  if (closer !== null && closer.position <= floor) closer = null;
  while (closer !== null) {
    if (!closer.canClose) {
      closer = closer.next;
      continue;
    }
    const index = bottomIndex(closer, exactIndex);
    const limit = openersBottom[index] ?? floor;
    let opener = closer.prev;
    while (opener !== null && opener.position > limit && !matches(opener, closer)) opener = opener.prev;
    const found = opener !== null && opener.position > limit ? opener : null;
    if (found === null) {
      openersBottom[index] = closer.prev === null ? floor : Math.max(floor, closer.prev.position);
      const next = closer.next;
      if (!closer.canOpen) removeDelimiter(stack, closer);
      closer = next;
      continue;
    }
    const used = closer.exact ? closer.count : closer.count >= 2 && found.count >= 2 ? 2 : 1;
    const exactType = closer.exact ? (stack.exactTypes.get(closer.char) ?? "delete") : "";
    const kind: ItemKind = !closer.exact ? (used === 2 ? "strong" : "emphasis") : exactType === "delete" ? "delete" : "extension";
    const openerItem = found.item;
    const closerItem = closer.item;
    found.count -= used;
    closer.count -= used;
    openerItem.value = openerItem.value.slice(0, found.count);
    openerItem.end -= used;
    closerItem.value = closerItem.value.slice(used);
    const wrapper = createItem(kind, openerItem.end, closerItem.start + used);
    wrapper.extensionType = exactType;
    closerItem.start += used;
    moveSiblings(openerItem, closerItem, wrapper);
    insertAfter(openerItem, wrapper);
    for (let between = closer.prev; between !== null && between !== found; between = between.prev) removeDelimiter(stack, between);
    if (found.count === 0) {
      unlinkItem(openerItem);
      removeDelimiter(stack, found);
    }
    if (closer.count === 0) {
      const next = closer.next;
      unlinkItem(closerItem);
      removeDelimiter(stack, closer);
      closer = next;
    }
  }
  while (stack.top !== null && stack.top.position > floor) removeDelimiter(stack, stack.top);
}

/** Reports whether a delimiter character is one CommonMark itself defines. @internal */
export function isEmphasisChar(char: number): boolean {
  return char === ASTERISK || char === UNDERSCORE;
}
