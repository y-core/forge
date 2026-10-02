import { scanDefinition } from "./definition";
import { createLineIndex, isSpaceOrTab, lineAtOffset, normalizeLabel } from "./source";
import type {
  MarkdownAlign,
  MarkdownBlock,
  MarkdownDefinition,
  MarkdownDefinitionTarget,
  MarkdownDocument,
  MarkdownListInfo,
  MarkdownListItem,
  MarkdownTableRow,
  MarkdownUnit,
} from "./types";
import { unescapeSpan } from "./unescape";

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const BYTE_ORDER_MARK = 0xfeff;
const GREATER_THAN = 0x3e;
const NUMBER_SIGN = 0x23;
const BACKTICK = 0x60;
const TILDE = 0x7e;
const EQUALS = 0x3d;
const HYPHEN = 0x2d;
const ASTERISK = 0x2a;
const UNDERSCORE = 0x5f;
const PLUS = 0x2b;
const PERIOD = 0x2e;
const CLOSE_PAREN = 0x29;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const CARET = 0x5e;
const COLON = 0x3a;
const PIPE = 0x7c;
const BACKSLASH = 0x5c;
const LOWER_X = 0x78;
const UPPER_X = 0x58;

const CODE_INDENT = 4;
const MAX_ORDERED_DIGITS = 9;

/** The deepest a block quote, list or list item may nest; a marker past it is read as text, which keeps the scan linear. @internal */
export const MAX_CONTAINER_DEPTH = 32;

/** The most columns a table's delimiter row may declare; a wider one is read as paragraph text. @internal */
export const MAX_TABLE_COLUMNS = 128;

const MAX_FOOTNOTE_LABEL = 999;

type Kind = "document" | "blockquote" | "list" | "listItem" | "footnoteDefinition" | "paragraph" | "heading" | "thematicBreak" | "code" | "table";

type Continuation = "matched" | "unmatched" | "lineDone";

type Start = "none" | "container" | "leaf";

interface Open {
  kind: Kind;
  parent: Open | null;
  children: Open[];
  nodes: MarkdownBlock[];
  open: boolean;
  removed: boolean;
  depth: number;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  segments: number[];
  keptSegments: number;
  ordered: boolean;
  marker: number;
  firstNumber: number | null;
  markerOffset: number;
  padding: number;
  fenced: boolean;
  fenceChar: number;
  fenceLength: number;
  fenceOffset: number;
  infoStart: number;
  infoEnd: number;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  lastIndent: number;
  interrupting: boolean;
  align: MarkdownAlign[];
  rows: number[][];
}

interface ListMarker {
  ordered: boolean;
  marker: number;
  firstNumber: number | null;
  markerOffset: number;
  padding: number;
  markerEnd: number;
}

const NO_CHILDREN: Open[] = [];
const NO_SEGMENTS: number[] = [];
const NO_ALIGNMENT: MarkdownAlign[] = [];
const NO_ROWS: number[][] = [];

function isContainerKind(kind: Kind): boolean {
  return kind === "document" || kind === "blockquote" || kind === "list" || kind === "listItem" || kind === "footnoteDefinition";
}

function createOpen(kind: Kind, parent: Open | null, start: number, line: number): Open {
  const container = isContainerKind(kind);
  return {
    kind,
    parent,
    children: container ? [] : NO_CHILDREN,
    nodes: [],
    open: true,
    removed: false,
    depth: parent === null ? 0 : parent.depth + 1,
    start,
    end: start,
    startLine: line,
    endLine: line,
    segments: container ? NO_SEGMENTS : [],
    keptSegments: 0,
    ordered: false,
    marker: 0,
    firstNumber: null,
    markerOffset: 0,
    padding: 0,
    fenced: false,
    fenceChar: 0,
    fenceLength: 0,
    fenceOffset: 0,
    infoStart: 0,
    infoEnd: 0,
    level: 1,
    label: "",
    lastIndent: 0,
    interrupting: false,
    align: NO_ALIGNMENT,
    rows: NO_ROWS,
  };
}

function canContain(parent: Kind, child: Kind): boolean {
  if (parent === "list") return child === "listItem";
  return (parent === "document" || parent === "blockquote" || parent === "listItem" || parent === "footnoteDefinition") && child !== "listItem";
}

function acceptsLines(kind: Kind): boolean {
  return kind === "paragraph" || kind === "code" || kind === "table";
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function mayStartBlock(code: number): boolean {
  return (
    code === OPEN_BRACKET ||
    code === PIPE ||
    code === COLON ||
    code === NUMBER_SIGN ||
    code === BACKTICK ||
    code === TILDE ||
    code === ASTERISK ||
    code === PLUS ||
    code === UNDERSCORE ||
    code === EQUALS ||
    code === GREATER_THAN ||
    code === HYPHEN ||
    isDigit(code)
  );
}

function hasGap(first: Open, second: Open): boolean {
  return second.startLine > first.endLine + 1;
}

function hasGapBetweenChildren(block: Open): boolean {
  let previous: Open | null = null;
  for (const child of block.children) {
    if (child.removed) continue;
    if (previous !== null && hasGap(previous, child)) return true;
    previous = child;
  }
  return false;
}

function childNodes(block: Open): MarkdownBlock[] {
  const nodes: MarkdownBlock[] = [];
  for (const child of block.children) for (const node of child.nodes) nodes.push(node);
  return nodes;
}

function isEscapedAt(source: string, at: number, from: number): boolean {
  let backslashes = 0;
  while (at - backslashes - 1 >= from && source.charCodeAt(at - backslashes - 1) === BACKSLASH) backslashes++;
  return backslashes % 2 === 1;
}

/** Splits a table row into its cells' trimmed spans, flat as start and end pairs; past `limit` cells it truncates, or with `strict` returns null. */
function splitRow(source: string, start: number, end: number, limit: number, strict: boolean): number[] | null {
  let from = start;
  let to = end;
  while (from < to && isSpaceOrTab(source.charCodeAt(from))) from++;
  while (to > from && isSpaceOrTab(source.charCodeAt(to - 1))) to--;
  if (source.charCodeAt(from) === PIPE) from++;
  if (to > from && source.charCodeAt(to - 1) === PIPE && !isEscapedAt(source, to - 1, from)) to--;
  const cells: number[] = [];
  let cellStart = from;
  for (let at = from; at <= to; at++) {
    const code = source.charCodeAt(at);
    if (code === BACKSLASH && at + 1 < to) {
      at++;
      continue;
    }
    if (at < to && code !== PIPE) continue;
    let cellEnd = at;
    let trimmedStart = cellStart;
    while (trimmedStart < cellEnd && isSpaceOrTab(source.charCodeAt(trimmedStart))) trimmedStart++;
    while (cellEnd > trimmedStart && isSpaceOrTab(source.charCodeAt(cellEnd - 1))) cellEnd--;
    if (cells.length >= limit * 2) {
      if (strict) return null;
      break;
    }
    cells.push(trimmedStart, cellEnd);
    cellStart = at + 1;
  }
  return cells;
}

function readAlignment(source: string, start: number, end: number): MarkdownAlign | undefined {
  let from = start;
  let to = end;
  const left = source.charCodeAt(from) === COLON;
  if (left) from++;
  const right = to > from && source.charCodeAt(to - 1) === COLON;
  if (right) to--;
  if (to === from) return undefined;
  for (let at = from; at < to; at++) if (source.charCodeAt(at) !== HYPHEN) return undefined;
  return left && right ? "center" : left ? "left" : right ? "right" : null;
}

function scanContainers(source: string, definitions: Map<string, MarkdownDefinitionTarget>, footnotes: Set<string>): Open {
  const document = createOpen("document", null, 0, 1);
  let tip = document;
  let oldTip = document;
  let lastMatched = document;
  let allClosed = true;
  let lineConsumed = false;
  let continuationStart = 0;
  let interruptingParagraph = false;

  let lineNumber = 0;
  let lineEnd = 0;
  let offset = 0;
  let column = 0;
  let nextNonspace = 0;
  let nextNonspaceColumn = 0;
  let indent = 0;
  let indented = false;
  let blank = false;
  let partiallyConsumedTab = false;

  function peek(at: number): number {
    return at < lineEnd ? source.charCodeAt(at) : -1;
  }

  function findNextNonspace(): void {
    let at = offset;
    let columns = column;
    let code = peek(at);
    while (code === SPACE || code === TAB) {
      columns += code === SPACE ? 1 : 4 - (columns % 4);
      code = peek(++at);
    }
    blank = code === -1;
    nextNonspace = at;
    nextNonspaceColumn = columns;
    indent = columns - column;
    indented = indent >= CODE_INDENT;
  }

  function advanceNextNonspace(): void {
    offset = nextNonspace;
    column = nextNonspaceColumn;
    partiallyConsumedTab = false;
  }

  function advanceOffset(count: number, columns: boolean): void {
    let remaining = count;
    while (remaining > 0 && offset < lineEnd) {
      if (source.charCodeAt(offset) === TAB) {
        const toTab = 4 - (column % 4);
        if (columns) {
          partiallyConsumedTab = toTab > remaining;
          const advance = partiallyConsumedTab ? remaining : toTab;
          column += advance;
          offset += partiallyConsumedTab ? 0 : 1;
          remaining -= advance;
        } else {
          partiallyConsumedTab = false;
          column += toTab;
          offset += 1;
          remaining -= 1;
        }
      } else {
        partiallyConsumedTab = false;
        offset += 1;
        column += 1;
        remaining -= 1;
      }
    }
  }

  function extendTo(block: Open, line: number, end: number): void {
    if (line > block.endLine || (line === block.endLine && end > block.end)) {
      block.endLine = line;
      block.end = end;
    }
  }

  function takeDefinitions(block: Open): void {
    const segments = block.segments;
    if (segments.length === 0 || source.charCodeAt(segments[0] ?? 0) !== OPEN_BRACKET) return;
    let content = "";
    const lineStarts: number[] = [];
    for (let index = 0; index < segments.length; index += 3) {
      if (index > 0) content += "\n";
      lineStarts.push(content.length);
      content += source.slice(segments[index], segments[index + 1]);
    }
    let at = 0;
    let line = 0;
    while (content.charCodeAt(at) === OPEN_BRACKET) {
      const found = scanDefinition(content, at);
      if (found === null) break;
      const firstLine = line;
      while (line < lineStarts.length && (lineStarts[line] ?? 0) < found.end) line++;
      if (!definitions.has(found.label)) definitions.set(found.label, { url: found.url, title: found.title });
      const definition: MarkdownDefinition = {
        type: "definition",
        start: segments[firstLine * 3] ?? 0,
        end: segments[(line - 1) * 3 + 1] ?? 0,
        label: found.label,
      };
      block.nodes.push(definition);
      at = found.end;
    }
    block.segments = segments.slice(line * 3);
    if (line === 0 || block.segments.length === 0) return;
    let first = block.segments[0] ?? 0;
    while (first < (block.segments[1] ?? 0) && isSpaceOrTab(source.charCodeAt(first))) first++;
    block.segments[0] = first;
    block.segments[2] = 0;
  }

  function finalizeCode(block: Open): void {
    if (!block.fenced) {
      const segments = block.segments.slice(0, block.keptSegments);
      block.nodes.push({ type: "code", start: block.start, end: block.end, fenced: false, lang: null, meta: null, segments });
      return;
    }
    const info = block.infoStart < block.infoEnd ? unescapeSpan(source, block.infoStart, block.infoEnd) : "";
    const space = info.search(/[ \t]/);
    const lang = space < 0 ? info : info.slice(0, space);
    const meta = space < 0 ? "" : info.slice(space).replace(/^[ \t]+/, "");
    block.nodes.push({
      type: "code",
      start: block.start,
      end: block.end,
      fenced: true,
      lang: lang === "" ? null : lang,
      meta: meta === "" ? null : meta,
      segments: block.segments,
    });
  }

  function finalizeList(block: Open): void {
    let spread = false;
    for (let index = 0; index < block.children.length && !spread; index++) {
      const item = block.children[index] as Open;
      const next = block.children[index + 1];
      spread = (next !== undefined && hasGap(item, next)) || hasGapBetweenChildren(item);
    }
    block.nodes.push({
      type: "list",
      start: block.start,
      end: block.end,
      ordered: block.ordered,
      firstNumber: block.firstNumber,
      spread,
      children: childNodes(block) as MarkdownListItem[],
    });
  }

  function finalize(block: Open): void {
    block.open = false;
    switch (block.kind) {
      case "paragraph":
        takeDefinitions(block);
        if (block.segments.length === 0) block.removed = block.nodes.length === 0;
        else
          block.nodes.push({ type: "paragraph", start: block.segments[0] ?? block.start, end: block.end, segments: block.segments, children: [] });
        break;
      case "heading":
        block.nodes.push({ type: "heading", start: block.start, end: block.end, depth: block.level, segments: block.segments, children: [] });
        break;
      case "thematicBreak":
        block.nodes.push({ type: "thematicBreak", start: block.start, end: block.end });
        break;
      case "code":
        finalizeCode(block);
        break;
      case "blockquote":
        block.nodes.push({ type: "blockquote", start: block.start, end: block.end, children: childNodes(block) });
        break;
      case "listItem":
        block.nodes.push({
          type: "listItem",
          start: block.start,
          end: block.end,
          spread: hasGapBetweenChildren(block),
          checked: takeTaskMarker(block),
          children: childNodes(block),
        });
        break;
      case "footnoteDefinition":
        block.nodes.push({ type: "footnoteDefinition", start: block.start, end: block.end, label: block.label, children: childNodes(block) });
        break;
      case "table":
        block.nodes.push({ type: "table", start: block.start, end: block.end, align: block.align, children: block.rows.map(createRow) });
        break;
      case "list":
        finalizeList(block);
        break;
      case "document":
        break;
    }
    if (block.parent !== null && !block.removed) extendTo(block.parent, block.endLine, block.end);
    tip = block.parent ?? document;
  }

  function takeTaskMarker(item: Open): boolean | null {
    const first = item.children[0];
    const paragraph = first?.kind === "paragraph" && first.nodes.length === 1 ? first.nodes[0] : undefined;
    if (paragraph?.type !== "paragraph") return null;
    const segments = paragraph.segments as number[];
    const start = segments[0] ?? 0;
    const end = segments[1] ?? 0;
    const mark = source.charCodeAt(start + 1);
    if (end - start < 3 || source.charCodeAt(start) !== OPEN_BRACKET || source.charCodeAt(start + 2) !== CLOSE_BRACKET) return null;
    if (!isSpaceOrTab(mark) && mark !== LOWER_X && mark !== UPPER_X) return null;
    let after = start + 3;
    if (after < end && !isSpaceOrTab(source.charCodeAt(after))) return null;
    let content = after;
    while (content < end && isSpaceOrTab(source.charCodeAt(content))) content++;
    if (content === end && segments.length <= 3) return null;
    segments[0] = after;
    paragraph.start = segments[0] ?? paragraph.start;
    return !isSpaceOrTab(mark);
  }

  function createRow(cells: number[]): MarkdownTableRow {
    const start = cells[0] ?? 0;
    const end = cells.at(-1) ?? start;
    const children = [];
    for (let index = 0; index < cells.length; index += 2) {
      const cellStart = cells[index] ?? 0;
      const cellEnd = cells[index + 1] ?? cellStart;
      children.push({ type: "tableCell" as const, start: cellStart, end: cellEnd, segments: [cellStart, cellEnd, 0], children: [] });
    }
    return { type: "tableRow", start, end, children };
  }

  function addChild(kind: Kind, start: number): Open {
    while (!canContain(tip.kind, kind)) finalize(tip);
    const block = createOpen(kind, tip, start, lineNumber);
    block.interrupting = interruptingParagraph;
    tip.children.push(block);
    tip = block;
    return block;
  }

  function closeUnmatchedBlocks(): void {
    if (allClosed) return;
    while (oldTip !== lastMatched) {
      const parent = oldTip.parent ?? document;
      finalize(oldTip);
      oldTip = parent;
    }
    allClosed = true;
  }

  function addLine(): void {
    if (tip.kind === "table") {
      tip.rows.push(splitRow(source, offset, lineEnd, Number.POSITIVE_INFINITY, false) ?? []);
      extendTo(tip, lineNumber, lineEnd);
      return;
    }
    let at = offset;
    let pad = 0;
    if (tip.kind === "paragraph" && tip.segments.length > 0) at = continuationStart;
    else if (partiallyConsumedTab) {
      at += 1;
      pad = 4 - (column % 4);
    }
    tip.segments.push(at, lineEnd, pad);
    tip.lastIndent = indent;
    // micromark keeps an indent-only last line of the source in indented code, and with it the blank lines before.
    const finalIndentedLine = !tip.fenced && indented && lineEnd === source.length;
    if (tip.kind === "paragraph" || tip.fenced || !blank || finalIndentedLine) {
      extendTo(tip, lineNumber, lineEnd);
      tip.keptSegments = tip.segments.length;
    }
  }

  function continueBlock(block: Open): Continuation {
    switch (block.kind) {
      case "blockquote":
        if (indented || peek(nextNonspace) !== GREATER_THAN) return "unmatched";
        advanceNextNonspace();
        advanceOffset(1, false);
        if (isSpaceOrTab(peek(offset))) advanceOffset(1, true);
        extendTo(block, lineNumber, lineEnd);
        return "matched";
      case "listItem":
        if (blank) {
          if (block.children.length === 0) return "unmatched";
          advanceNextNonspace();
        } else if (indent >= block.markerOffset + block.padding) advanceOffset(block.markerOffset + block.padding, true);
        else return "unmatched";
        return "matched";
      case "footnoteDefinition":
        if (blank) advanceNextNonspace();
        else if (indent >= CODE_INDENT) advanceOffset(CODE_INDENT, true);
        else return "unmatched";
        return "matched";
      case "table":
        return blank ? "unmatched" : "matched";
      case "heading":
      case "thematicBreak":
        return "unmatched";
      case "code":
        return block.fenced ? continueFence(block) : continueIndentedCode();
      case "paragraph":
        return blank ? "unmatched" : "matched";
      case "list":
      case "document":
        return "matched";
    }
  }

  function continueFence(block: Open): Continuation {
    if (indent <= 3 && peek(nextNonspace) === block.fenceChar) {
      let at = nextNonspace;
      while (peek(at) === block.fenceChar) at++;
      let rest = at;
      while (isSpaceOrTab(peek(rest))) rest++;
      if (at - nextNonspace >= block.fenceLength && rest === lineEnd) {
        extendTo(block, lineNumber, lineEnd);
        finalize(block);
        return "lineDone";
      }
    }
    for (let skip = block.fenceOffset; skip > 0 && isSpaceOrTab(peek(offset)); skip--) advanceOffset(1, true);
    return "matched";
  }

  function continueIndentedCode(): Continuation {
    if (indent >= CODE_INDENT) advanceOffset(CODE_INDENT, true);
    else if (blank) advanceNextNonspace();
    else return "unmatched";
    return "matched";
  }

  function canNest(container: Open, levels: number): boolean {
    const base = container.kind === "paragraph" || container.kind === "code" ? (container.parent ?? document) : container;
    return base.depth + levels <= MAX_CONTAINER_DEPTH;
  }

  function startBlockquote(container: Open): Start {
    if (indented || peek(nextNonspace) !== GREATER_THAN || !canNest(container, 1)) return "none";
    const start = nextNonspace;
    advanceNextNonspace();
    advanceOffset(1, false);
    if (isSpaceOrTab(peek(offset))) advanceOffset(1, true);
    closeUnmatchedBlocks();
    extendTo(addChild("blockquote", start), lineNumber, lineEnd);
    return "container";
  }

  function startAtxHeading(): Start {
    if (indented || peek(nextNonspace) !== NUMBER_SIGN) return "none";
    let at = nextNonspace;
    while (peek(at) === NUMBER_SIGN && at - nextNonspace <= 6) at++;
    const level = at - nextNonspace;
    if (level > 6 || (peek(at) !== -1 && !isSpaceOrTab(peek(at)))) return "none";
    const start = nextNonspace;
    closeUnmatchedBlocks();
    const heading = addChild("heading", start);
    heading.level = level as Open["level"];
    let contentStart = at;
    while (isSpaceOrTab(peek(contentStart))) contentStart++;
    let contentEnd = lineEnd;
    while (contentEnd > contentStart && isSpaceOrTab(source.charCodeAt(contentEnd - 1))) contentEnd--;
    let closing = contentEnd;
    while (closing > contentStart && source.charCodeAt(closing - 1) === NUMBER_SIGN) closing--;
    if (closing === contentStart) contentEnd = contentStart;
    else if (closing < contentEnd && isSpaceOrTab(source.charCodeAt(closing - 1))) {
      contentEnd = closing;
      while (contentEnd > contentStart && isSpaceOrTab(source.charCodeAt(contentEnd - 1))) contentEnd--;
    }
    heading.segments.push(contentStart, contentEnd, 0);
    extendTo(heading, lineNumber, lineEnd);
    offset = lineEnd;
    return "leaf";
  }

  function startFencedCode(): Start {
    const fenceChar = peek(nextNonspace);
    if (indented || (fenceChar !== BACKTICK && fenceChar !== TILDE)) return "none";
    let at = nextNonspace;
    while (peek(at) === fenceChar) at++;
    const length = at - nextNonspace;
    if (length < 3) return "none";
    if (fenceChar === BACKTICK) for (let rest = at; rest < lineEnd; rest++) if (source.charCodeAt(rest) === BACKTICK) return "none";
    const start = nextNonspace;
    closeUnmatchedBlocks();
    const code = addChild("code", start);
    code.fenced = true;
    code.fenceChar = fenceChar;
    code.fenceLength = length;
    code.fenceOffset = indent;
    let infoStart = at;
    while (isSpaceOrTab(peek(infoStart))) infoStart++;
    let infoEnd = lineEnd;
    while (infoEnd > infoStart && isSpaceOrTab(source.charCodeAt(infoEnd - 1))) infoEnd--;
    code.infoStart = infoStart;
    code.infoEnd = infoEnd;
    extendTo(code, lineNumber, lineEnd);
    offset = lineEnd;
    lineConsumed = true;
    return "leaf";
  }

  function startSetextHeading(container: Open): Start {
    const marker = peek(nextNonspace);
    if (indented || container.kind !== "paragraph" || (marker !== EQUALS && marker !== HYPHEN)) return "none";
    let at = nextNonspace;
    while (peek(at) === marker) at++;
    while (isSpaceOrTab(peek(at))) at++;
    if (at !== lineEnd) return "none";
    closeUnmatchedBlocks();
    takeDefinitions(container);
    if (container.segments.length === 0) return "none";
    // micromark starts a setext heading at its paragraph's first line, definitions included, so the definitions stay in the heading's unit.
    container.nodes.length = 0;
    container.kind = "heading";
    container.level = marker === EQUALS ? 1 : 2;
    extendTo(container, lineNumber, lineEnd);
    offset = lineEnd;
    return "leaf";
  }

  function startTable(container: Open): Start {
    if (indented || container.kind !== "paragraph" || container.lastIndent >= CODE_INDENT) return "none";
    const delimiter = splitRow(source, nextNonspace, lineEnd, MAX_TABLE_COLUMNS, true);
    if (delimiter === null || delimiter.length === 0) return "none";
    const align: MarkdownAlign[] = [];
    for (let index = 0; index < delimiter.length; index += 2) {
      const cell = readAlignment(source, delimiter[index] ?? 0, delimiter[index + 1] ?? 0);
      if (cell === undefined) return "none";
      align.push(cell);
    }
    const segments = container.segments;
    const headerStart = segments[segments.length - 3] ?? 0;
    const headerEnd = segments[segments.length - 2] ?? 0;
    const header = splitRow(source, headerStart, headerEnd, MAX_TABLE_COLUMNS, true);
    if (header === null || header.length !== delimiter.length) return "none";
    let piped = false;
    for (let at = headerStart; at < headerEnd && !piped; at++) piped = source.charCodeAt(at) === PIPE;
    for (let at = nextNonspace; at < lineEnd && !piped; at++) piped = source.charCodeAt(at) === PIPE;
    if (!piped) return "none";
    closeUnmatchedBlocks();
    segments.length -= 3;
    container.endLine = lineNumber - 2;
    container.end = segments[segments.length - 2] ?? container.start;
    const table = addChild("table", headerStart);
    table.startLine = lineNumber - 1;
    table.align = align;
    table.rows = [header];
    extendTo(table, lineNumber, lineEnd);
    offset = lineEnd;
    lineConsumed = true;
    return "leaf";
  }

  function startFootnoteDefinition(container: Open): Start {
    if (indented || peek(nextNonspace) !== OPEN_BRACKET || peek(nextNonspace + 1) !== CARET || !canNest(container, 1)) return "none";
    const labelStart = nextNonspace + 2;
    let at = labelStart;
    while (at < lineEnd && at - labelStart <= MAX_FOOTNOTE_LABEL) {
      const code = source.charCodeAt(at);
      if (code === CLOSE_BRACKET || code === OPEN_BRACKET || isSpaceOrTab(code)) break;
      at += code === BACKSLASH ? 2 : 1;
    }
    if (at === labelStart || at - labelStart > MAX_FOOTNOTE_LABEL || peek(at) !== CLOSE_BRACKET || peek(at + 1) !== COLON) return "none";
    const start = nextNonspace;
    const label = normalizeLabel(source.slice(labelStart, at));
    advanceNextNonspace();
    advanceOffset(at + 2 - start, false);
    findNextNonspace();
    advanceNextNonspace();
    closeUnmatchedBlocks();
    const definition = addChild("footnoteDefinition", start);
    definition.label = label;
    footnotes.add(label);
    extendTo(definition, lineNumber, at + 2);
    return "container";
  }

  function startThematicBreak(): Start {
    const marker = peek(nextNonspace);
    if (indented || (marker !== ASTERISK && marker !== HYPHEN && marker !== UNDERSCORE)) return "none";
    let count = 0;
    for (let at = nextNonspace; at < lineEnd; at++) {
      const code = source.charCodeAt(at);
      if (code === marker) count++;
      else if (!isSpaceOrTab(code)) return "none";
    }
    if (count < 3) return "none";
    const start = nextNonspace;
    closeUnmatchedBlocks();
    extendTo(addChild("thematicBreak", start), lineNumber, lineEnd);
    offset = lineEnd;
    return "leaf";
  }

  // micromark applies the paragraph-interrupt rules to every list item a line opens once all its containers continued onto an open paragraph or indented code.
  function interrupts(container: Open): boolean {
    return container.kind === "paragraph" || interruptingParagraph;
  }

  function readListMarker(container: Open): ListMarker | null {
    if (indent >= CODE_INDENT) return null;
    const first = peek(nextNonspace);
    let markerEnd = nextNonspace + 1;
    let ordered = false;
    let firstNumber: number | null = null;
    let marker = first;
    if (first !== ASTERISK && first !== PLUS && first !== HYPHEN) {
      while (isDigit(peek(markerEnd - 1)) && markerEnd - nextNonspace <= MAX_ORDERED_DIGITS) markerEnd++;
      const digits = markerEnd - 1 - nextNonspace;
      marker = peek(markerEnd - 1);
      if (digits === 0 || digits > MAX_ORDERED_DIGITS || (marker !== PERIOD && marker !== CLOSE_PAREN)) return null;
      ordered = true;
      firstNumber = Number(source.slice(nextNonspace, markerEnd - 1));
      if (interrupts(container) && firstNumber !== 1) return null;
    }
    const after = peek(markerEnd);
    if (after !== -1 && after !== SPACE && after !== TAB) return null;
    if (interrupts(container)) {
      let rest = markerEnd;
      while (isSpaceOrTab(peek(rest))) rest++;
      if (rest === lineEnd) return null;
    }
    const markerOffset = indent;
    const markerLength = markerEnd - nextNonspace;
    advanceNextNonspace();
    advanceOffset(markerLength, true);
    const spacesStartColumn = column;
    const spacesStartOffset = offset;
    do advanceOffset(1, true);
    while (column - spacesStartColumn < 5 && isSpaceOrTab(peek(offset)));
    const spacesAfter = column - spacesStartColumn;
    let padding = markerLength + spacesAfter;
    if (spacesAfter >= 5 || spacesAfter < 1 || peek(offset) === -1) {
      padding = markerLength + 1;
      column = spacesStartColumn;
      offset = spacesStartOffset;
      if (isSpaceOrTab(peek(offset))) advanceOffset(1, true);
    }
    return { ordered, marker, firstNumber, markerOffset, padding, markerEnd };
  }

  function startListItem(container: Open): Start {
    if ((indented && container.kind !== "list") || !canNest(container, container.kind === "list" ? 1 : 2)) return "none";
    const start = nextNonspace;
    const found = readListMarker(container);
    if (found === null) return "none";
    closeUnmatchedBlocks();
    if (tip.kind !== "list" || tip.ordered !== found.ordered || tip.marker !== found.marker) {
      const list = addChild("list", start);
      list.ordered = found.ordered;
      list.marker = found.marker;
      list.firstNumber = found.firstNumber;
    }
    const item = addChild("listItem", start);
    item.markerOffset = found.markerOffset;
    item.padding = found.padding;
    extendTo(item, lineNumber, found.markerEnd);
    return "container";
  }

  function startIndentedCode(): Start {
    if (!indented || tip.kind === "paragraph" || blank) return "none";
    advanceOffset(CODE_INDENT, true);
    closeUnmatchedBlocks();
    addChild("code", offset);
    return "leaf";
  }

  function tryStarts(container: Open): Start {
    let result = startBlockquote(container);
    if (result === "none") result = startAtxHeading();
    if (result === "none") result = startFencedCode();
    if (result === "none") result = startFootnoteDefinition(container);
    if (result === "none") result = startSetextHeading(container);
    if (result === "none") result = startThematicBreak();
    if (result === "none") result = startListItem(container);
    if (result === "none") result = startTable(container);
    if (result === "none") result = startIndentedCode();
    return result;
  }

  function incorporateLine(lineStart: number): void {
    let container = document;
    oldTip = tip;
    offset = lineStart;
    column = 0;
    blank = false;
    partiallyConsumedTab = false;
    lineConsumed = false;
    lineNumber++;

    for (let last = container.children.at(-1); last !== undefined && last.open; last = container.children.at(-1)) {
      container = last;
      findNextNonspace();
      const result = continueBlock(container);
      if (result === "lineDone") return;
      if (result === "unmatched") {
        container = container.parent ?? document;
        break;
      }
    }
    continuationStart = offset;
    allClosed = container === oldTip;
    lastMatched = container;
    const openLeaf = oldTip.kind === "paragraph" || (oldTip.kind === "code" && !oldTip.fenced);
    interruptingParagraph = openLeaf && (container === oldTip || container === oldTip.parent);

    let matchedLeaf = container.kind === "code";
    while (!matchedLeaf) {
      findNextNonspace();
      if (!indented && !mayStartBlock(peek(nextNonspace))) {
        advanceNextNonspace();
        break;
      }
      const result = tryStarts(container);
      if (result === "none") {
        advanceNextNonspace();
        break;
      }
      container = tip;
      if (result === "leaf") matchedLeaf = true;
    }

    if (!allClosed && !blank && tip.kind === "paragraph") {
      addLine();
      return;
    }
    closeUnmatchedBlocks();
    if (acceptsLines(container.kind)) {
      if (!lineConsumed) addLine();
    } else if (offset < lineEnd && !blank) {
      addChild("paragraph", nextNonspace);
      advanceNextNonspace();
      addLine();
    }
  }

  let at = source.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0;
  while (at < source.length) {
    let end = at;
    let code = source.charCodeAt(end);
    while (end < source.length && code !== LINE_FEED && code !== CARRIAGE_RETURN) code = source.charCodeAt(++end);
    lineEnd = end;
    incorporateLine(at);
    at = end + (code === CARRIAGE_RETURN && source.charCodeAt(end + 1) === LINE_FEED ? 2 : 1);
  }
  while (tip !== document) finalize(tip);
  return document;
}

function rebase(node: MarkdownBlock, base: number): void {
  const stack: MarkdownBlock[] = [node];
  for (let block = stack.pop(); block !== undefined; block = stack.pop()) {
    block.start -= base;
    block.end -= base;
    if ("segments" in block) {
      const segments = block.segments as number[];
      for (let index = 0; index < segments.length; index += 3) {
        segments[index] = (segments[index] ?? 0) - base;
        segments[index + 1] = (segments[index + 1] ?? 0) - base;
      }
    }
    if ("children" in block && block.type !== "paragraph" && block.type !== "heading" && block.type !== "tableCell") {
      for (const child of block.children as MarkdownBlock[]) stack.push(child);
    }
  }
}

/** Runs the block phase over a source: its units, link reference definitions and line index, with every inline child still empty. */
export function scanBlocks(source: string): MarkdownDocument {
  const definitions = new Map<string, MarkdownDefinitionTarget>();
  const footnoteDefinitions = new Set<string>();
  const document = scanContainers(source, definitions, footnoteDefinitions);
  const lineStarts = createLineIndex(source);
  const pending: { node: MarkdownBlock; list: MarkdownListInfo | undefined; interrupting: boolean }[] = [];
  for (const child of document.children) {
    for (const node of child.nodes) {
      if (node.type !== "list") {
        pending.push({ node, list: undefined, interrupting: child.interrupting });
        continue;
      }
      const list: MarkdownListInfo = { ordered: node.ordered, firstNumber: node.firstNumber, spread: node.spread };
      node.children.forEach((item, index) => pending.push({ node: item, list, interrupting: child.children[index]?.interrupting ?? false }));
    }
  }
  const units: MarkdownUnit[] = pending.map(({ node, list, interrupting }, index) => {
    const line = index === 0 ? 1 : lineAtOffset(lineStarts, node.start);
    return { start: index === 0 ? 0 : (lineStarts[line - 1] ?? 0), end: source.length, line, node, list, interrupting };
  });
  for (let index = 0; index < units.length; index++) {
    const unit = units[index] as MarkdownUnit;
    unit.end = units[index + 1]?.start ?? source.length;
    rebase(unit.node, unit.start);
  }
  return { source, units, definitions, footnoteDefinitions, lineStarts };
}
