import { createAutolinkLiteralScanner, mayStartAutolinkLiteral } from "./autolink-literal";
import { MAX_LABEL_LENGTH, scanLinkDestination, scanLinkLabel, skipSpaceAndNewline } from "./definition";
import { appendItem, createItem, isEmphasisChar, moveSiblings, processEmphasis, pushDelimiter, unlinkItem } from "./delimiter";
import { isAsciiPunctuation, isLineEnding, isUnicodePunctuation, isUnicodeWhitespace, normalizeLabel } from "./source";
import type {
  Delimiter,
  DelimiterStack,
  InlineConstruct,
  InlineContext,
  Item,
  ItemKind,
  MarkdownInline,
  MarkdownSegments,
  MarkdownSyntax,
} from "./types";
import { readCharacterReference, unescapeSpan } from "./unescape";

const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const TAB = 0x09;
const BANG = 0x21;
const DOUBLE_QUOTE = 0x22;
const AMPERSAND = 0x26;
const SINGLE_QUOTE = 0x27;
const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;
const ASTERISK = 0x2a;
const COLON = 0x3a;
const OPEN_ANGLE = 0x3c;
const CLOSE_ANGLE = 0x3e;
const OPEN_BRACKET = 0x5b;
const BACKSLASH = 0x5c;
const CLOSE_BRACKET = 0x5d;
const UNDERSCORE = 0x5f;
const BACKTICK = 0x60;
const TILDE = 0x7e;
const CARET = 0x5e;
const MAX_SCHEME_LENGTH = 32;
const MAX_FOOTNOTE_LABEL = 999;
const LOOKBEHIND = 2;

const EMAIL_AUTOLINK =
  /<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;

const CONTAINER_KINDS: ReadonlySet<ItemKind> = new Set(["emphasis", "strong", "delete", "link", "image", "linkReference", "imageReference"]);

const CORE_SPECIAL = "\n\r\\`*_~[]!<&";

interface Bracket {
  item: Item;
  index: number;
  image: boolean;
  previousDelimiter: Delimiter | null;
  bracketAfter: boolean;
  serial: number;
}

interface LinkTarget {
  end: number;
  url: string;
  title: string | null;
}

function isCodeSpace(code: number): boolean {
  return code === SPACE || code === LINE_FEED || code === CARRIAGE_RETURN;
}

function isSchemeChar(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x2b ||
    code === 0x2e ||
    code === 0x2d
  );
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

const specialTables = new WeakMap<MarkdownSyntax, Uint8Array>();

function specialTableOf(syntax: MarkdownSyntax): Uint8Array {
  let table = specialTables.get(syntax);
  if (table !== undefined) return table;
  table = new Uint8Array(128);
  for (const char of CORE_SPECIAL) table[char.charCodeAt(0)] = 1;
  for (const code of [...syntax.triggers.keys(), ...syntax.delimiters.keys()]) if (code < 128) table[code] = 1;
  specialTables.set(syntax, table);
  return table;
}

function createInlineParser(content: string, context: InlineContext) {
  const length = content.length;
  const root = createItem("root", 0, length);
  const { syntax } = context;
  const special = specialTableOf(syntax);
  const exactTypes = new Map<number, string>([[TILDE, "delete"], ...syntax.delimiters]);
  const stack: DelimiterStack = { top: null, exactTypes };
  const brackets: Bracket[] = [];
  let serial = 0;
  let linkFloor = 0;
  let pos = 0;
  let backtickRuns: Map<number, number[]> | null = null;
  const backtickCursor = new Map<number, number>();
  const titleFailsFrom = new Map<number, number>();
  let angleFailsBefore = -1;
  const literals = createAutolinkLiteralScanner(content);
  let activeAt = -1;

  function addText(start: number, end: number, value: string): void {
    const last = root.last;
    if (last !== null && last.kind === "text" && last.plain && last.end === start) {
      last.value += value;
      last.end = end;
      return;
    }
    const item = createItem("text", start, end, value);
    item.plain = true;
    appendItem(root, item);
  }

  function skipLeadingSpaces(): void {
    while (pos < length && (content.charCodeAt(pos) === SPACE || content.charCodeAt(pos) === TAB)) pos++;
  }

  function lineEndingLength(at: number): number {
    return content.charCodeAt(at) === CARRIAGE_RETURN && content.charCodeAt(at + 1) === LINE_FEED ? 2 : 1;
  }

  function parseNewline(): void {
    let spaces = 0;
    let run = 0;
    let tab = false;
    for (let code = content.charCodeAt(pos - 1); pos - run > 0 && (code === SPACE || code === TAB); code = content.charCodeAt(pos - run - 1)) {
      if (code === TAB) tab = true;
      else spaces++;
      run++;
    }
    const last = root.last;
    if (run > 0 && last !== null && last.kind === "text" && last.plain && last.end === pos) {
      const strip = Math.min(run, last.value.length);
      last.value = last.value.slice(0, last.value.length - strip);
      last.end -= strip;
      if (last.value === "") unlinkItem(last);
    }
    const ending = lineEndingLength(pos);
    // micromark makes no hard break of trailing whitespace that holds a tab, and strips the whole run either way.
    if (spaces >= 2 && !tab) appendItem(root, createItem("break", pos - run, pos + ending));
    else addText(pos, pos + ending, content.slice(pos, pos + ending));
    pos += ending;
    skipLeadingSpaces();
  }

  function parseBackslash(): void {
    const next = content.charCodeAt(pos + 1);
    if (next === LINE_FEED || next === CARRIAGE_RETURN) {
      const end = pos + 1 + lineEndingLength(pos + 1);
      appendItem(root, createItem("break", pos, end));
      pos = end;
      skipLeadingSpaces();
    } else if (pos + 1 < length && isAsciiPunctuation(next)) {
      addText(pos, pos + 2, content[pos + 1] ?? "");
      pos += 2;
    } else {
      addText(pos, pos + 1, "\\");
      pos++;
    }
  }

  function indexBackticks(): Map<number, number[]> {
    const runs = new Map<number, number[]>();
    for (let at = 0; at < length;) {
      if (content.charCodeAt(at) !== BACKTICK) {
        at++;
        continue;
      }
      const start = at;
      while (content.charCodeAt(at) === BACKTICK) at++;
      const starts = runs.get(at - start);
      if (starts === undefined) runs.set(at - start, [start]);
      else starts.push(start);
    }
    return runs;
  }

  function findClosingBackticks(runLength: number, after: number): number {
    backtickRuns ??= indexBackticks();
    const starts = backtickRuns.get(runLength);
    if (starts === undefined) return -1;
    let cursor = backtickCursor.get(runLength) ?? 0;
    while (cursor < starts.length && (starts[cursor] ?? 0) < after) cursor++;
    backtickCursor.set(runLength, cursor);
    return starts[cursor] ?? -1;
  }

  function parseBackticks(): void {
    const start = pos;
    while (content.charCodeAt(pos) === BACKTICK) pos++;
    const runLength = pos - start;
    const closing = findClosingBackticks(runLength, pos);
    if (closing < 0) {
      addText(start, pos, content.slice(start, pos));
      return;
    }
    let value = content.slice(pos, closing);
    if (context.tableCell) value = value.replaceAll("\\|", "|");
    if (value.length > 1 && isCodeSpace(value.charCodeAt(0)) && isCodeSpace(value.charCodeAt(value.length - 1)) && /[^ \r\n]/.test(value)) {
      value = value.slice(value.startsWith("\r\n") ? 2 : 1, value.endsWith("\r\n") ? -2 : -1);
    }
    appendItem(root, createItem("inlineCode", start, closing + runLength, value));
    pos = closing + runLength;
  }

  function readRun(start: number, char: number) {
    let end = start;
    while (content.charCodeAt(end) === char) end++;
    const count = end - start;
    const before = start > 0 ? content.charCodeAt(start - 1) : LINE_FEED;
    const after = end < length ? content.charCodeAt(end) : LINE_FEED;
    const afterSpace = isUnicodeWhitespace(after);
    const afterPunct = isUnicodePunctuation(after);
    const beforeSpace = isUnicodeWhitespace(before);
    const beforePunct = isUnicodePunctuation(before);
    const exact = !isEmphasisChar(char);
    let leftFlanking = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
    let rightFlanking = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
    // micromark lets `*` and `_` open before, and close after, another construct's delimiter (`~`, or an extension's), as GFM's renderer does.
    if (!exact) {
      leftFlanking ||= exactTypes.has(after);
      rightFlanking ||= exactTypes.has(before);
    }
    const canOpen = char === UNDERSCORE ? leftFlanking && (!rightFlanking || beforePunct || beforeSpace) : leftFlanking;
    const canClose = char === UNDERSCORE ? rightFlanking && (!leftFlanking || afterPunct || afterSpace) : rightFlanking;
    return { end, count, exact, canOpen, canClose, active: (canOpen || canClose) && (!exact || count === 2) };
  }

  function parseDelimiterRun(char: number): void {
    const start = pos;
    const run = readRun(start, char);
    pos = run.end;
    const item = createItem("text", start, pos, content.slice(start, pos));
    appendItem(root, item);
    if (run.active) {
      const { count, exact, canOpen, canClose } = run;
      pushDelimiter(stack, { item, position: start, char, count, original: count, canOpen, canClose, exact, prev: null, next: null });
    }
  }

  function pushBracket(start: number, image: boolean): void {
    const item = createItem("text", start, pos, image ? "![" : "[");
    appendItem(root, item);
    const previous = brackets.at(-1);
    if (previous !== undefined) previous.bracketAfter = true;
    brackets.push({ item, index: image ? start + 1 : start, image, previousDelimiter: stack.top, bracketAfter: false, serial: serial++ });
  }

  function scanTitle(at: number): number {
    const open = content.charCodeAt(at);
    if (open !== DOUBLE_QUOTE && open !== SINGLE_QUOTE && open !== OPEN_PAREN) return -1;
    const failsFrom = titleFailsFrom.get(open);
    if (failsFrom !== undefined && at >= failsFrom) return -1;
    const close = open === OPEN_PAREN ? CLOSE_PAREN : open;
    for (let cursor = at + 1; cursor < length; cursor++) {
      const code = content.charCodeAt(cursor);
      if (code === BACKSLASH && cursor + 1 < length) cursor++;
      else if (code === close) return cursor + 1;
      else if (open === OPEN_PAREN && code === OPEN_PAREN) return -1;
    }
    titleFailsFrom.set(open, Math.min(failsFrom ?? at, at));
    return -1;
  }

  function scanDestination(at: number) {
    if (content.charCodeAt(at) === OPEN_ANGLE) {
      if (at < angleFailsBefore) return null;
      const found = scanLinkDestination(content, at, length);
      if (found === null) {
        let stop = at + 1;
        while (stop < length && !isLineEnding(content.charCodeAt(stop)) && content.charCodeAt(stop) !== OPEN_ANGLE) stop++;
        if (stop >= length || isLineEnding(content.charCodeAt(stop))) angleFailsBefore = stop;
      }
      return found;
    }
    return scanLinkDestination(content, at, length);
  }

  function parseInlineLink(at: number): LinkTarget | null {
    const destinationStart = skipSpaceAndNewline(content, at + 1, length);
    const destination = scanDestination(destinationStart);
    if (destination === null) return null;
    const angled = content.charCodeAt(destinationStart) === OPEN_ANGLE;
    if (!angled && destination.textStart === destination.textEnd && content.charCodeAt(destination.end) !== CLOSE_PAREN) return null;
    let cursor = destination.end;
    let title: string | null = null;
    const titleStart = skipSpaceAndNewline(content, cursor, length);
    if (titleStart !== cursor) {
      const titleEnd = scanTitle(titleStart);
      if (titleEnd >= 0) {
        title = unescapeSpan(content, titleStart + 1, titleEnd - 1);
        cursor = skipSpaceAndNewline(content, titleEnd, length);
      } else cursor = titleStart;
    }
    if (content.charCodeAt(cursor) !== CLOSE_PAREN) return null;
    return { end: cursor + 1, url: unescapeSpan(content, destination.textStart, destination.textEnd), title };
  }

  function parseCloseBracket(): void {
    const closeAt = pos;
    pos++;
    const opener = brackets.at(-1);
    if (opener === undefined) {
      addText(closeAt, pos, "]");
      return;
    }
    if (!opener.image && opener.serial < linkFloor) {
      brackets.pop();
      addText(closeAt, pos, "]");
      return;
    }

    let kind: ItemKind | null = null;
    let end = pos;
    let target: LinkTarget | null = null;
    let label = "";
    let referenceType: Item["referenceType"] = "shortcut";
    if (content.charCodeAt(pos) === OPEN_PAREN) target = parseInlineLink(pos);
    if (target !== null) {
      kind = opener.image ? "image" : "link";
      end = target.end;
    } else {
      const labelEnd = content.charCodeAt(pos) === OPEN_BRACKET ? scanLinkLabel(content, pos, length) : -1;
      let raw: string | null = null;
      if (labelEnd - pos > 2) {
        raw = content.slice(pos + 1, labelEnd - 1);
        referenceType = "full";
        end = labelEnd;
      } else if (!opener.bracketAfter && closeAt - (opener.index + 1) <= MAX_LABEL_LENGTH) {
        raw = content.slice(opener.index + 1, closeAt);
        referenceType = labelEnd === pos + 2 ? "collapsed" : "shortcut";
        end = labelEnd === pos + 2 ? labelEnd : pos;
      }
      if (raw !== null) {
        label = normalizeLabel(raw);
        if (label !== "" && context.isDefined(label)) kind = opener.image ? "imageReference" : "linkReference";
      }
    }

    brackets.pop();
    if (kind === null) {
      addText(closeAt, closeAt + 1, "]");
      return;
    }
    const container = createItem(kind, opener.image ? opener.index - 1 : opener.index, end);
    if (target !== null) {
      container.url = target.url;
      container.title = target.title;
    } else {
      container.label = label;
      container.referenceType = referenceType;
    }
    moveSiblings(opener.item, null, container);
    appendItem(root, container);
    processEmphasis(stack, opener.previousDelimiter);
    unlinkItem(opener.item);
    if (!opener.image) linkFloor = serial;
    pos = end;
  }

  function parseAutolink(): boolean {
    const start = pos;
    let cursor = start + 1;
    if (isAsciiLetter(content.charCodeAt(cursor))) {
      cursor++;
      while (cursor < length && cursor - start - 1 <= MAX_SCHEME_LENGTH && isSchemeChar(content.charCodeAt(cursor))) cursor++;
      const schemeLength = cursor - start - 1;
      if (schemeLength >= 2 && schemeLength <= MAX_SCHEME_LENGTH && content.charCodeAt(cursor) === COLON) {
        cursor++;
        while (cursor < length) {
          const code = content.charCodeAt(cursor);
          if (code === CLOSE_ANGLE || code === OPEN_ANGLE || code <= SPACE) break;
          cursor++;
        }
        if (content.charCodeAt(cursor) === CLOSE_ANGLE) {
          appendAutolink(start, cursor + 1, content.slice(start + 1, cursor), start + 1, cursor);
          return true;
        }
      }
    }
    EMAIL_AUTOLINK.lastIndex = start;
    const email = EMAIL_AUTOLINK.exec(content);
    if (email?.[1] === undefined) return false;
    appendAutolink(start, EMAIL_AUTOLINK.lastIndex, "mailto:" + email[1], start + 1, EMAIL_AUTOLINK.lastIndex - 1);
    return true;
  }

  function appendAutolink(start: number, end: number, url: string, textStart: number, textEnd: number): Item {
    const link = createItem("link", start, end);
    link.url = url;
    const label = createItem("text", textStart, textEnd, content.slice(textStart, textEnd));
    label.plain = true;
    appendItem(link, label);
    appendItem(root, link);
    pos = end;
    return link;
  }

  function parseEntity(): void {
    const reference = readCharacterReference(content, pos, length);
    if (reference === null) {
      addText(pos, pos + 1, "&");
      pos++;
      return;
    }
    addText(pos, reference.end, reference.text);
    pos = reference.end;
  }

  function parseText(): void {
    const start = pos;
    pos++;
    while (pos < length) {
      const code = content.charCodeAt(pos);
      if (isSpecial(code)) break;
      if (mayStartAutolinkLiteral(content, pos)) break;
      pos++;
    }
    addText(start, pos, content.slice(start, pos));
  }

  function isSpecial(code: number): boolean {
    return code < 128 ? special[code] === 1 : syntax.triggers.has(code) || syntax.delimiters.has(code);
  }

  /** Answers where a construct the parser would act on starts and the end of an inert run starting at `at` otherwise. */
  function inertUntil(at: number): { active: boolean; end: number } {
    const code = content.charCodeAt(at);
    const constructs = syntax.triggers.get(code);
    if (constructs !== undefined && scanConstruct(at, constructs) !== null) return { active: true, end: at };
    if (syntax.delimiters.has(code) || isEmphasisChar(code) || code === TILDE) {
      const run = readRun(at, code);
      return { active: run.active, end: run.end };
    }
    if (code >= 128 || !CORE_SPECIAL.includes(String.fromCharCode(code))) return { active: false, end: at + 1 };
    if (code === AMPERSAND) return { active: readCharacterReference(content, at, length) !== null, end: at + 1 };
    if (code === BANG) return { active: content.charCodeAt(at + 1) === OPEN_BRACKET, end: at + 1 };
    if (code === BACKSLASH) {
      const next = content.charCodeAt(at + 1);
      return { active: at + 1 < length && (isAsciiPunctuation(next) || isLineEnding(next)), end: at + 1 };
    }
    return { active: true, end: at };
  }

  function nextActive(at: number): number {
    if (activeAt >= at) return activeAt;
    activeAt = at;
    while (activeAt < length) {
      const found = inertUntil(activeAt);
      if (found.active) break;
      activeAt = found.end;
    }
    return activeAt;
  }

  function parseLiteral(): boolean {
    if (!mayStartAutolinkLiteral(content, pos)) return false;
    const found = literals.scan(pos);
    if (found === null) return false;
    const stop = brackets.length > 0 ? nextActive(pos) : length;
    // Under an open bracket a literal may hold no construct, since link text that demotes it must read as if it was never scanned.
    if (stop < found.end) {
      addText(pos, stop, content.slice(pos, stop));
      pos = stop;
      return true;
    }
    appendAutolink(pos, found.end, found.url, pos, found.end).literal = true;
    return true;
  }

  function parseFootnoteCall(): boolean {
    const found = scanFootnoteCall(pos);
    if (found === null) return false;
    const item = createItem("footnoteReference", pos, found.end);
    item.label = found.label;
    appendItem(root, item);
    pos = found.end;
    return true;
  }

  function scanFootnoteCall(at: number): { end: number; label: string } | null {
    const labelStart = at + 2;
    let cursor = labelStart;
    while (cursor < length && cursor - labelStart <= MAX_FOOTNOTE_LABEL) {
      const code = content.charCodeAt(cursor);
      if (code === CLOSE_BRACKET || code === OPEN_BRACKET || code === SPACE || code === TAB || isLineEnding(code)) break;
      cursor += code === BACKSLASH && cursor + 1 < length ? 2 : 1;
    }
    if (cursor === labelStart || cursor - labelStart > MAX_FOOTNOTE_LABEL || content.charCodeAt(cursor) !== CLOSE_BRACKET) return null;
    const label = normalizeLabel(content.slice(labelStart, cursor));
    return context.isFootnoteDefined(label) ? { end: cursor + 1, label } : null;
  }

  function scanConstruct(at: number, constructs: readonly InlineConstruct[]) {
    const from = Math.max(0, at - LOOKBEHIND);
    for (const construct of constructs) {
      const limit = Math.min(length, at + construct.maxLength);
      const window = content.slice(from, limit);
      const match = construct.scan(window, at - from, window.length);
      if (match === null || match.end <= at - from || match.end > window.length) continue;
      return { end: match.end + from, node: match.node, construct };
    }
    return null;
  }

  function parseConstruct(constructs: readonly InlineConstruct[]): boolean {
    const found = scanConstruct(pos, constructs);
    if (found === null) return false;
    const item = createItem("extension", pos, found.end);
    item.extension = found.node;
    item.construct = found.construct;
    appendItem(root, item);
    pos = found.end;
    return true;
  }

  function parse(): Item {
    while (pos < length) {
      const code = content.charCodeAt(pos);
      const constructs = syntax.triggers.get(code);
      if (constructs !== undefined && parseConstruct(constructs)) continue;
      if (syntax.delimiters.has(code)) {
        parseDelimiterRun(code);
        continue;
      }
      switch (code) {
        case LINE_FEED:
        case CARRIAGE_RETURN:
          parseNewline();
          break;
        case BACKSLASH:
          parseBackslash();
          break;
        case BACKTICK:
          parseBackticks();
          break;
        case UNDERSCORE:
          // `_` is atext, so an email literal is tried before the run is read as emphasis.
          if (!parseLiteral()) parseDelimiterRun(code);
          break;
        case ASTERISK:
        case TILDE:
          parseDelimiterRun(code);
          break;
        case OPEN_BRACKET:
          if (content.charCodeAt(pos + 1) === CARET && parseFootnoteCall()) break;
          pos++;
          pushBracket(pos - 1, false);
          break;
        case BANG:
          if (content.charCodeAt(pos + 1) === OPEN_BRACKET && content.charCodeAt(pos + 2) === CARET && scanFootnoteCall(pos + 1) !== null) {
            addText(pos, pos + 1, "!");
            pos++;
            parseFootnoteCall();
          } else if (content.charCodeAt(pos + 1) === OPEN_BRACKET) {
            pos += 2;
            pushBracket(pos - 2, true);
          } else {
            addText(pos, pos + 1, "!");
            pos++;
          }
          break;
        case CLOSE_BRACKET:
          parseCloseBracket();
          break;
        case OPEN_ANGLE:
          if (!parseAutolink()) {
            addText(pos, pos + 1, "<");
            pos++;
          }
          break;
        case AMPERSAND:
          parseEntity();
          break;
        default:
          if (!parseLiteral()) parseText();
      }
    }
    processEmphasis(stack, null);
    return root;
  }

  return { parse };
}

function createOffsetMap(contentStarts: readonly number[], segmentStarts: readonly number[]): (at: number) => number {
  return (at) => {
    let low = 0;
    let high = contentStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((contentStarts[middle] ?? 0) <= at) low = middle;
      else high = middle - 1;
    }
    return (segmentStarts[low] ?? 0) + at - (contentStarts[low] ?? 0);
  };
}

function toNode(item: Item, toSource: (at: number) => number, children: MarkdownInline[]): MarkdownInline {
  const start = toSource(item.start);
  const end = toSource(item.end);
  switch (item.kind) {
    case "extension":
      if (item.extension !== null) return Object.assign({}, item.extension as object, { start, end }) as MarkdownInline;
      return { type: item.extensionType, start, end, children } as unknown as MarkdownInline;
    case "text":
    case "root":
      return { type: "text", start, end, value: item.value };
    case "inlineCode":
      return { type: "inlineCode", start, end, value: item.value };
    case "break":
      return { type: "break", start, end };
    case "link":
    case "image":
      return { type: item.kind, start, end, url: item.url, title: item.title, children };
    case "linkReference":
    case "imageReference":
      return { type: item.kind, start, end, label: item.label, referenceType: item.referenceType, children };
    case "footnoteReference":
      return { type: "footnoteReference", start, end, label: item.label };
    case "emphasis":
    case "strong":
    case "delete":
      return { type: item.kind, start, end, children };
  }
}

function pushMerged(out: MarkdownInline[], node: MarkdownInline): void {
  const previous = out.at(-1);
  if (node.type === "text" && previous?.type === "text") {
    previous.value += node.value;
    previous.end = node.end;
  } else if (node.type !== "text" || node.value !== "") out.push(node);
}

function isContainer(item: Item): boolean {
  return CONTAINER_KINDS.has(item.kind) || (item.kind === "extension" && item.extension === null);
}

function toInlines(root: Item, content: string, toSource: (at: number) => number, context: InlineContext): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  const frames: { item: Item; children: MarkdownInline[]; cursor: Item | null }[] = [{ item: root, children: out, cursor: root.first }];
  let links = 0;
  let images = 0;
  while (frames.length > 0) {
    const frame = frames[frames.length - 1] as (typeof frames)[number];
    const item = frame.cursor;
    if (item === null) {
      frames.pop();
      if (frame.item.kind === "link" || frame.item.kind === "linkReference") links--;
      if (frame.item.kind === "image" || frame.item.kind === "imageReference") images--;
      const parent = frames[frames.length - 1];
      if (parent !== undefined) pushMerged(parent.children, toNode(frame.item, toSource, frame.children));
      continue;
    }
    frame.cursor = item.next;
    // A literal autolink inside link text or an image description stays text, as cmark-gfm and remark link only text outside them.
    if (item.literal && links + images > 0) {
      pushMerged(frame.children, {
        type: "text",
        start: toSource(item.start),
        end: toSource(item.end),
        value: content.slice(item.start, item.end),
      });
      continue;
    }
    if (isContainer(item)) {
      if (item.kind === "link" || item.kind === "linkReference") links++;
      if (item.kind === "image" || item.kind === "imageReference") images++;
      frames.push({ item, children: [], cursor: item.first });
      continue;
    }
    const accept = item.construct?.accept;
    const accepted =
      accept === undefined ||
      item.extension === null ||
      accept(item.extension, {
        inLink: links > 0,
        inImage: images > 0,
        leaf: context.leaf,
        leafIndex: context.leafIndex,
        container: context.container,
      });
    if (accepted) pushMerged(frame.children, toNode(item, toSource, []));
    else
      pushMerged(frame.children, {
        type: "text",
        start: toSource(item.start),
        end: toSource(item.end),
        value: content.slice(item.start, item.end),
      });
  }
  return out;
}

const AT_SIGN = 0x40;
const PERIOD = 0x2e;

function isPlainText(content: string, syntax: MarkdownSyntax): boolean {
  const special = specialTableOf(syntax);
  for (let at = 0; at < content.length; at++) {
    const code = content.charCodeAt(at);
    if (code >= 128) {
      if (syntax.triggers.has(code) || syntax.delimiters.has(code)) return false;
    } else if (special[code] === 1 || code === AT_SIGN || code === COLON) return false;
    else if (code === PERIOD && at >= 3 && content.slice(at - 3, at).toLowerCase() === "www") return false;
  }
  return true;
}

// A leaf keeps each line ending as written, as micromark does, so `\r\n` and a lone `\r` reach its text unchanged.
function lineEndingAfter(source: string, at: number): string {
  if (source.charCodeAt(at) === CARRIAGE_RETURN) return source.charCodeAt(at + 1) === LINE_FEED ? "\r\n" : "\r";
  return "\n";
}

/** Parses a leaf's inline content from its segments, giving every node offsets relative to the unit that holds the leaf. @internal */
export function parseInline(source: string, base: number, segments: MarkdownSegments, context: InlineContext): MarkdownInline[] {
  const contentStarts: number[] = [];
  const segmentStarts: number[] = [];
  let content = "";
  for (let index = 0; index < segments.length; index += 3) {
    if (index > 0) content += lineEndingAfter(source, base + (segments[index - 2] ?? 0));
    contentStarts.push(content.length);
    segmentStarts.push(segments[index] ?? 0);
    content += source.slice(base + (segments[index] ?? 0), base + (segments[index + 1] ?? 0));
  }
  let end = content.length;
  while (end > 0 && (content.charCodeAt(end - 1) === SPACE || content.charCodeAt(end - 1) === TAB)) end--;
  content = content.slice(0, end).replaceAll("\u0000", "\u{fffd}");
  if (content === "") return [];
  if (segments.length === 3 && isPlainText(content, context.syntax)) {
    const start = segments[0] ?? 0;
    return [{ type: "text", start, end: start + content.length, value: content }];
  }
  const root = createInlineParser(content, context).parse();
  return toInlines(root, content, createOffsetMap(contentStarts, segmentStarts), context);
}
