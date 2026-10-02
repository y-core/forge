import type { BlockTransform, MarkdownBlock, MarkdownCallout, MarkdownInline, MarkdownText } from "./types";

const LEADING_BLANKS = /^[ \t]+/;
const LINE_ENDING = /\r\n|\r|\n/;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function textPiece(value: string, start: number, end: number): MarkdownText[] {
  return value === "" ? [] : [{ type: "text", value, start, end }];
}

function splitTitle(nodes: MarkdownInline[]): { title: MarkdownInline[]; rest: MarkdownInline[] } {
  const end = nodes.findIndex((node) => node.type === "break" || (node.type === "text" && LINE_ENDING.test(node.value)));
  if (end === -1) return { title: nodes, rest: [] };
  const boundary = nodes[end];
  const before = nodes.slice(0, end);
  const after = nodes.slice(end + 1);
  if (boundary?.type !== "text") return { title: before, rest: after };
  const lineEnding = LINE_ENDING.exec(boundary.value);
  const split = lineEnding?.index ?? boundary.value.length;
  const resume = lineEnding ? split + lineEnding[0].length : boundary.value.length;
  const head = boundary.value.slice(0, split);
  const tail = boundary.value.slice(resume);
  const middle = Math.max(boundary.start, boundary.end - (boundary.value.length - split));
  return {
    title: [...before, ...textPiece(head, boundary.start, middle)],
    rest: [...textPiece(tail, Math.max(boundary.start, boundary.end - tail.length), boundary.end), ...after],
  };
}

function trimTitleEnd(title: MarkdownInline[]): MarkdownInline[] {
  let kept = title;
  while (true) {
    const last = kept.at(-1);
    if (last?.type !== "text") return kept;
    const value = last.value.trimEnd();
    if (value === last.value) return kept;
    kept = kept.slice(0, -1);
    if (value !== "") return [...kept, { type: "text", value, start: last.start, end: last.end - (last.value.length - value.length) }];
  }
}

function toCallout(quote: MarkdownBlock, text: string, marker: RegExp): MarkdownCallout | null {
  if (quote.type !== "blockquote") return null;
  const [paragraph] = quote.children;
  if (paragraph?.type !== "paragraph") return null;
  const [first, ...following] = paragraph.children;
  if (first?.type !== "text" || !text.startsWith("[!", first.start)) return null;
  const match = marker.exec(first.value);
  const kind = match?.[1]?.toLowerCase();
  if (!match || kind === undefined) return null;
  const opening = first.value.slice(match[0].length).replace(LEADING_BLANKS, "");
  const { title, rest } = splitTitle([...textPiece(opening, Math.max(first.start, first.end - opening.length), first.end), ...following]);
  paragraph.children = rest;
  return {
    type: "callout",
    kind,
    title: trimTitleEnd(title),
    children: rest.length > 0 ? quote.children : quote.children.slice(1),
    start: quote.start,
    end: quote.end,
  };
}

/** Creates the transform replacing a blockquote that opens with `[!kind]`, for one of `kinds` in any case, by a callout titled by its first line. */
export function createCalloutTransform(kinds: readonly string[]): BlockTransform {
  const alternatives = kinds.map((kind) => kind.replace(REGEX_SPECIALS, "\\$&")).join("|");
  const marker = kinds.length === 0 ? null : new RegExp(`^\\[!(${alternatives})\\](?=[ \\t\\r\\n]|$)`, "i");
  return { type: "blockquote", transform: (node, { text }) => (marker === null ? null : toCallout(node, text, marker)) };
}
