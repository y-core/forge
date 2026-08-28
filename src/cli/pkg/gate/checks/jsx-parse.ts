/** A literal `data-slot` that a later spread on the same element can overwrite. */
export interface SlotClobber {
  /** 1-indexed line of the `data-slot` attribute. */
  line: number;
  /** The element or component tag as written, e.g. `div` or `Menu.Item`. */
  tag: string;
  /** The literal `data-slot` value, e.g. `card-header`. */
  slot: string;
  /** The bare identifier whose spread clobbers it, e.g. `rest`. */
  spread: string;
}

const IDENT_START = /[A-Za-z_$]/;

const IDENT_PART = /[A-Za-z0-9_$]/;

const TAG_PART = /[A-Za-z0-9_$.-]/;

const ATTR_PART = /[A-Za-z0-9_:.-]/;

interface TagFrame {
  tag: string;
  braces: number;
  slot: { value: string; line: number } | null;
  reported: boolean;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts: number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function skipQuoted(source: string, open: number): number {
  const quote = source[open];
  let i = open + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return source.length;
}

function skipRun(source: string, start: number, pattern: RegExp): number {
  let i = start;
  while (i < source.length && pattern.test(source[i] ?? "")) i++;
  return i;
}

function skipSpace(source: string, start: number): number {
  let i = start;
  while (i < source.length && /\s/.test(source[i] ?? "")) i++;
  return i;
}

function matchBareSpread(source: string, open: number): { name: string; end: number } | null {
  let i = skipSpace(source, open + 1);
  if (source.slice(i, i + 3) !== "...") return null;
  i = skipSpace(source, i + 3);
  if (!IDENT_START.test(source[i] ?? "")) return null;
  const nameEnd = skipRun(source, i + 1, IDENT_PART);
  const name = source.slice(i, nameEnd);
  const close = skipSpace(source, nameEnd);
  if (source[close] !== "}") return null;
  return { name, end: close + 1 };
}

function matchSlotLiteral(source: string, nameEnd: number): { value: string; end: number } | null {
  let i = skipSpace(source, nameEnd);
  if (source[i] !== "=") return null;
  i = skipSpace(source, i + 1);
  const quote = source[i];
  if (quote !== '"' && quote !== "'") return null;
  const close = source.indexOf(quote, i + 1);
  if (close === -1) return null;
  return { value: source.slice(i + 1, close), end: close + 1 };
}

/** Every element in `source` whose literal `data-slot` a later spread can silently overwrite. */
export function findSlotClobbers(source: string): SlotClobber[] {
  const found: SlotClobber[] = [];
  const starts = lineStarts(source);
  const stack: TagFrame[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";
    const frame = stack[stack.length - 1];

    if (ch === "/" && next === "/") {
      const nl = source.indexOf("\n", i + 2);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuoted(source, i);
      continue;
    }

    if (frame && frame.braces === 0) {
      if (ch === "/" && next === ">") {
        stack.pop();
        i += 2;
        continue;
      }
      if (ch === ">") {
        stack.pop();
        i++;
        continue;
      }
      if (ch === "{") {
        const spread = matchBareSpread(source, i);
        if (spread) {
          if (frame.slot && !frame.reported) {
            frame.reported = true;
            found.push({ line: frame.slot.line, tag: frame.tag, slot: frame.slot.value, spread: spread.name });
          }
          i = spread.end;
          continue;
        }
        frame.braces++;
        i++;
        continue;
      }
      if (IDENT_START.test(ch)) {
        const nameEnd = skipRun(source, i + 1, ATTR_PART);
        if (source.slice(i, nameEnd) === "data-slot") {
          const literal = matchSlotLiteral(source, nameEnd);
          if (literal) {
            frame.slot ??= { value: literal.value, line: lineAt(starts, i) };
            i = literal.end;
            continue;
          }
        }
        i = nameEnd;
        continue;
      }
    }

    if (frame && frame.braces > 0) {
      if (ch === "{") {
        frame.braces++;
        i++;
        continue;
      }
      if (ch === "}") {
        frame.braces--;
        i++;
        continue;
      }
    }

    if (ch === "<" && (!frame || frame.braces > 0) && IDENT_START.test(next)) {
      const nameEnd = skipRun(source, i + 2, TAG_PART);
      stack.push({ tag: source.slice(i + 1, nameEnd), braces: 0, slot: null, reported: false });
      i = nameEnd;
      continue;
    }

    i++;
  }

  return found;
}
