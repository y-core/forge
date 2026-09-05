import type { Result } from "../../result/result";
import { err, ok } from "../../result/result";

/** A path into a JSON document: object keys and array indices, outermost first. @public */
export type JsonPath = (string | number)[];
export type Primitive = string | number | boolean | null;

/** Render a path the way a user would point at it: `kv_namespaces[0].id`. */
export function formatPath(path: JsonPath): string {
  return path.reduce<string>((acc, seg) => (typeof seg === "number" ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : String(seg)), "");
}

/**
 * A JSONC parser that keeps byte offsets.
 *
 * The values themselves still come from `JSON.parse(stripJsonc(src))` — this tree
 * exists only to answer "where in the original text does this live?", which is what
 * makes it possible to write an id back without reformatting the file around it.
 */

export type JsoncNode =
  | { kind: "object"; start: number; end: number; members: JsoncMember[] }
  | { kind: "array"; start: number; end: number; elements: JsoncNode[] }
  | { kind: "string" | "number" | "boolean" | "null"; start: number; end: number };

export interface JsoncMember {
  key: string;
  /** Offset of the key's opening quote. */
  keyStart: number;
  /** Offset just past the key's closing quote. */
  keyEnd: number;
  value: JsoncNode;
  /** Offset just past the value — before any trailing comma or comment. */
  end: number;
}

export interface JsoncParseError {
  message: string;
  offset: number;
}

const isWs = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r";

/**
 * Advance past whitespace and comments.
 *
 * Shared with {@link stripJsonc} so that the two cannot disagree about what counts
 * as ignorable text — a disagreement would show up as a splice at the wrong offset.
 */
export function skipTrivia(src: string, i: number): number {
  const len = src.length;
  while (i < len) {
    if (isWs(src[i])) {
      i++;
      continue;
    }
    const afterComment = scanComment(src, i);
    if (afterComment === undefined) break;
    i = afterComment;
  }
  return i;
}

/**
 * Advance past exactly **one** comment at `i`, or return undefined if none starts
 * there. Distinct from {@link skipTrivia}, which consumes a whole run — a caller
 * counting comments needs them one at a time.
 */
export function scanComment(src: string, i: number): number | undefined {
  const len = src.length;
  if (src[i] !== "/") return undefined;

  if (src[i + 1] === "/") {
    let j = i + 2;
    while (j < len && src[j] !== "\n") j++;
    return j;
  }

  if (src[i + 1] === "*") {
    let j = i + 2;
    while (j < len) {
      if (src[j] === "*" && src[j + 1] === "/") return j + 2;
      j++;
    }
    return j;
  }

  return undefined;
}

/**
 * Scan a string literal starting at its opening quote.
 * Returns the offset just past the closing quote.
 */
export function scanString(src: string, i: number): number {
  const len = src.length;
  i++; // opening quote
  while (i < len) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === '"') return i + 1;
    i++;
  }
  return i; // unterminated; the caller's JSON.parse will report it
}

/** True when a comma at `i` is a trailing comma — the next real token closes a container. */
function isTrailingComma(src: string, i: number): boolean {
  const next = src[skipTrivia(src, i + 1)];
  return next === "}" || next === "]";
}

/**
 * Strip comments and trailing commas, yielding text `JSON.parse` accepts.
 *
 * Trailing commas are detected during the scan rather than by a regex over the
 * output. The regex could not tell a comma inside a string from a syntactic one,
 * so `{"a": "x, }"}` used to be silently rewritten to `{"a": "x }"}`.
 */
export function stripJsonc(src: string): string {
  let out = "";
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i];

    if (ch === '"') {
      const end = scanString(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }

    if (ch === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) {
      i = skipTrivia(src, i);
      continue;
    }

    if (ch === "," && isTrailingComma(src, i)) {
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/** How many comments the source carries — reported when a write would destroy them. */
export function countComments(src: string): number {
  let count = 0;
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i];
    if (ch === '"') {
      i = scanString(src, i);
      continue;
    }
    const afterComment = scanComment(src, i);
    if (afterComment !== undefined) {
      count++;
      i = afterComment;
      continue;
    }
    i++;
  }
  return count;
}

class ParseFailure extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.offset = offset;
  }
}

function parseValue(src: string, i: number): { node: JsoncNode; next: number } {
  i = skipTrivia(src, i);
  const ch = src[i];

  if (ch === undefined) throw new ParseFailure("unexpected end of input", i);
  if (ch === "{") return parseObject(src, i);
  if (ch === "[") return parseArray(src, i);
  if (ch === '"') {
    const end = scanString(src, i);
    return { node: { kind: "string", start: i, end }, next: end };
  }

  // Number, true, false, null — scan to the next structural delimiter.
  const start = i;
  while (i < src.length) {
    const c = src[i];
    if (isWs(c) || c === "," || c === "}" || c === "]" || (c === "/" && (src[i + 1] === "/" || src[i + 1] === "*"))) break;
    i++;
  }
  if (i === start) throw new ParseFailure(`unexpected character ${JSON.stringify(ch)}`, i);

  const raw = src.slice(start, i);
  const kind = raw === "true" || raw === "false" ? "boolean" : raw === "null" ? "null" : "number";
  return { node: { kind, start, end: i }, next: i };
}

function parseObject(src: string, i: number): { node: JsoncNode; next: number } {
  const start = i;
  i++; // {
  const members: JsoncMember[] = [];

  for (;;) {
    i = skipTrivia(src, i);
    if (src[i] === "}") return { node: { kind: "object", start, end: i + 1, members }, next: i + 1 };
    if (i >= src.length) throw new ParseFailure("unterminated object", i);

    if (src[i] !== '"') throw new ParseFailure("expected a quoted key", i);
    const keyStart = i;
    const keyEnd = scanString(src, i);
    let key: string;
    try {
      key = JSON.parse(src.slice(keyStart, keyEnd)) as string;
    } catch {
      throw new ParseFailure("malformed key", keyStart);
    }

    i = skipTrivia(src, keyEnd);
    if (src[i] !== ":") throw new ParseFailure("expected ':' after key", i);
    i++;

    const { node, next } = parseValue(src, i);
    members.push({ key, keyStart, keyEnd, value: node, end: node.end });
    i = skipTrivia(src, next);

    if (src[i] === ",") {
      i++;
      continue;
    }
    if (src[i] === "}") return { node: { kind: "object", start, end: i + 1, members }, next: i + 1 };
    throw new ParseFailure("expected ',' or '}'", i);
  }
}

function parseArray(src: string, i: number): { node: JsoncNode; next: number } {
  const start = i;
  i++; // [
  const elements: JsoncNode[] = [];

  for (;;) {
    i = skipTrivia(src, i);
    if (src[i] === "]") return { node: { kind: "array", start, end: i + 1, elements }, next: i + 1 };
    if (i >= src.length) throw new ParseFailure("unterminated array", i);

    const { node, next } = parseValue(src, i);
    elements.push(node);
    i = skipTrivia(src, next);

    if (src[i] === ",") {
      i++;
      continue;
    }
    if (src[i] === "]") return { node: { kind: "array", start, end: i + 1, elements }, next: i + 1 };
    throw new ParseFailure("expected ',' or ']'", i);
  }
}

/** Parse `src` into a span tree. */
export function parseJsoncTree(src: string): Result<JsoncNode, JsoncParseError> {
  try {
    const { node, next } = parseValue(src, 0);
    const rest = skipTrivia(src, next);
    if (rest < src.length) {
      return err({ message: "trailing content after the root value", offset: rest });
    }
    return ok(node);
  } catch (e) {
    if (e instanceof ParseFailure) return err({ message: e.message, offset: e.offset });
    throw e;
  }
}

/** Look up the member named `key` on an object node. */
export function findMember(node: JsoncNode, key: string): JsoncMember | undefined {
  return node.kind === "object" ? node.members.find((m) => m.key === key) : undefined;
}
