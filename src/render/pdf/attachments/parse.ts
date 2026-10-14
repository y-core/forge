import type { PdfAttachmentLimits, PdfDecodeBudget, PdfParsedObject, PdfParsedValue } from "./types";

const TEXT_CHUNK = 0x8000;
const INFLATE_FLOOR = 64 * 1024;

const HEADER = /(?<!\d)(\d+) (\d+) obj\r?\n/g;
const ENDOBJ = "\nendobj";
// The keyword and not the bare word: a name such as `/application#2foctet-stream` carries it too.
const STREAM = />>\s*(stream\r?\n)/g;
const WHITESPACE = "\0\t\n\f\r ";
const DELIMITERS = "()<>[]{}/%";
const NUMBER = /[+-]?(\d+\.?\d*|\.\d+)/y;
const REFERENCE = /\s+(\d+)\s+R(?![^\0\t\n\f\r ()<>[\]{}/%])/y;
const DEEPEST = 64;
const PDF_DOC_DEPARTURES = new Map([
  [0x18, 0x02d8],
  [0x19, 0x02c7],
  [0x1a, 0x02c6],
  [0x1b, 0x02d9],
  [0x1c, 0x02dd],
  [0x1d, 0x02db],
  [0x1e, 0x02da],
  [0x1f, 0x02dc],
  [0x7f, 0xfffd],
  [0x80, 0x2022],
  [0x81, 0x2020],
  [0x82, 0x2021],
  [0x83, 0x2026],
  [0x84, 0x2014],
  [0x85, 0x2013],
  [0x86, 0x0192],
  [0x87, 0x2044],
  [0x88, 0x2039],
  [0x89, 0x203a],
  [0x8a, 0x2212],
  [0x8b, 0x2030],
  [0x8c, 0x201e],
  [0x8d, 0x201c],
  [0x8e, 0x201d],
  [0x8f, 0x2018],
  [0x90, 0x2019],
  [0x91, 0x201a],
  [0x92, 0x2122],
  [0x93, 0xfb01],
  [0x94, 0xfb02],
  [0x95, 0x0141],
  [0x96, 0x0152],
  [0x97, 0x0160],
  [0x98, 0x0178],
  [0x99, 0x017d],
  [0x9a, 0x0131],
  [0x9b, 0x0142],
  [0x9c, 0x0153],
  [0x9d, 0x0161],
  [0x9e, 0x017e],
  [0x9f, 0xfffd],
  [0xa0, 0x20ac],
  [0xad, 0xfffd],
]);
const PDF_DOC_CANDIDATES = /[^ -~\xa1-\xac\xae-\xff]/g;
const ESCAPES = new Map([
  ["n", 0x0a],
  ["r", 0x0d],
  ["t", 0x09],
  ["b", 0x08],
  ["f", 0x0c],
]);

/** One `/FlateDecode` payload back as the bytes it was deflated from, cancelled once it passes `limit`. @internal */
export async function inflate(
  deflated: Uint8Array<ArrayBuffer>,
  limit = Number.POSITIVE_INFINITY,
  refusal = `a stream inflates past the ${limit}-byte limit`,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  writer
    .write(deflated)
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = stream.readable.getReader();
  let out = new Uint8Array(Math.min(limit, Math.max(INFLATE_FLOOR, deflated.length)));
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out.subarray(0, at);
    const end = at + value.length;
    if (end > limit) {
      await reader.cancel();
      throw new Error(refusal);
    }
    if (end > out.length) {
      const grown = new Uint8Array(Math.min(limit, Math.max(end, out.length * 2)));
      grown.set(out.subarray(0, at));
      out = grown;
    }
    out.set(value, at);
    at = end;
  }
}

/** A stream's payload inflated where its dictionary declares `/FlateDecode`, its decoded size charged to the read's budget either way. @internal */
export async function decodedPayloadOf(dict: string, raw: Uint8Array<ArrayBuffer>, budget: PdfDecodeBudget): Promise<Uint8Array<ArrayBuffer>> {
  const left = budget.total - budget.spent;
  const refusal = `the read decodes past its ${budget.total}-byte total limit`;
  if (!dict.includes("/FlateDecode")) {
    if (raw.length > left) throw new Error(refusal);
    budget.spent += raw.length;
    return raw;
  }
  const payload = left < budget.perStream ? await inflate(raw, left, refusal) : await inflate(raw, budget.perStream);
  budget.spent += payload.length;
  return payload;
}

// A stream body ends at its declared `/Length` and never at `endobj`: a font file or a deflate
// payload can carry those very bytes, and a reader scanning for them resynchronizes mid-file.
/** Every top-level object of a file, each ended by its declared length or by its `endobj`, its payload left as the file carries it. @internal */
export function topLevelObjects(bytes: Uint8Array<ArrayBuffer>, text: string, limits: PdfAttachmentLimits = {}): PdfParsedObject[] {
  const most = limits.maxObjects ?? Number.POSITIVE_INFINITY;
  const objects: PdfParsedObject[] = [];
  let closed = text.indexOf(ENDOBJ);
  STREAM.lastIndex = 0;
  let keyword = STREAM.exec(text);
  let at = 0;
  for (;;) {
    HEADER.lastIndex = at;
    const found = HEADER.exec(text);
    if (found === null) return objects;
    if (objects.length >= most) throw new Error(`the file carries more than ${most} objects`);
    const id = Number(found[1]);
    const from = found.index + found[0].length;
    if (closed !== -1 && closed < from) closed = text.indexOf(ENDOBJ, from);
    if (keyword !== null && keyword.index < from) {
      STREAM.lastIndex = from;
      keyword = STREAM.exec(text);
    }
    const start = keyword === null ? -1 : keyword.index + keyword[0].length;
    const opened = keyword === null ? -1 : start - (keyword[1]?.length ?? 0);
    if (opened === -1 || (closed !== -1 && closed < opened)) {
      objects.push({ id, dict: text.slice(from, closed === -1 ? undefined : closed) });
      at = closed === -1 ? text.length : closed + ENDOBJ.length;
      continue;
    }
    const dict = text.slice(from, opened);
    const declared = /\/Length (\d+)(?![\d.]|\s+\d+\s+R)/.exec(dict)?.[1];
    if (declared === undefined) throw new Error(`object ${id} declares no direct /Length for its stream`);
    const length = Number(declared);
    if (start + length > bytes.length) throw new Error(`object ${id} declares a stream running past the end of the file`);
    objects.push({ id, dict, stream: bytes.subarray(start, start + length) });
    at = start + length;
  }
}

/** The objects one `/ObjStm` packs, taken from its pair table rather than from any file offset. @internal */
export function unpackObjectStream(container: PdfParsedObject, limit = Number.POSITIVE_INFINITY): PdfParsedObject[] {
  if (container.stream === undefined) return [];
  const text = decodePdfBytes(container.stream);
  const count = Number(/\/N (\d+)/.exec(container.dict)?.[1] ?? 0);
  const first = Number(/\/First (\d+)/.exec(container.dict)?.[1] ?? 0);
  if (count > limit) throw new Error(`object stream ${container.id} packs more objects than the ${limit} left to read`);
  const pairs = text
    .slice(0, first)
    .trim()
    .split(/\s+/)
    .map((field) => Number(field));
  if (pairs.length < count * 2 || pairs.some((pair) => !Number.isInteger(pair)))
    throw new Error(`object stream ${container.id} has a malformed pair table`);
  const offsets = Array.from({ length: count }, (_unused, index) => first + (pairs[index * 2 + 1] ?? 0));
  if (offsets.some((offset, index) => offset < (offsets[index - 1] ?? offset)))
    throw new Error(`object stream ${container.id} lists its offsets out of order`);
  return offsets.map((from, index) => ({
    id: pairs[index * 2] ?? 0,
    dict: text.slice(from, offsets[index + 1] ?? text.length),
    container: container.id,
  }));
}

/** Every object by id, a packed one overriding an earlier top-level one, each `/ObjStm` read from `containerPayload` within `maxObjects` overall. @internal */
export async function indexPdfObjects(
  top: readonly PdfParsedObject[],
  containerPayload: (container: PdfParsedObject & { stream: Uint8Array<ArrayBuffer> }) => Promise<Uint8Array<ArrayBuffer>>,
  maxObjects = Number.POSITIVE_INFINITY,
): Promise<Map<number, PdfParsedObject>> {
  const objects = new Map<number, PdfParsedObject>();
  let count = top.length;
  for (const object of top) {
    objects.set(object.id, object);
    if (!object.dict.includes("/Type /ObjStm") || object.stream === undefined) continue;
    const stream = await containerPayload({ ...object, stream: object.stream });
    const packed = unpackObjectStream({ ...object, stream }, maxObjects - count);
    count += packed.length;
    for (const inner of packed) objects.set(inner.id, inner);
  }
  return objects;
}

/** Bytes as text of one character per byte, each its own code point, so an index into it is a byte offset. @internal */
export function decodePdfBytes(bytes: Uint8Array): string {
  const parts: string[] = [];
  // Not `TextDecoder("latin1")`: that label is windows-1252, which moves 0x80–0x9F past 0xFF and so widens the whole string.
  for (let at = 0; at < bytes.length; at += TEXT_CHUNK)
    parts.push(String.fromCharCode.apply(undefined, bytes.subarray(at, at + TEXT_CHUNK) as unknown as number[]));
  return parts.join("");
}

/** A text string without a byte-order mark, read as PDFDocEncoding at one character per byte, an undefined code read as U+FFFD. @internal */
export function decodePdfDocText(bytes: Uint8Array): string {
  return decodePdfBytes(bytes).replace(PDF_DOC_CANDIDATES, (code) => {
    const mapped = PDF_DOC_DEPARTURES.get(code.charCodeAt(0));
    return mapped === undefined ? code : String.fromCharCode(mapped);
  });
}

/** The first value written in `text`, parsed from PDF's object syntax. @internal */
export function parsePdfValue(text: string): PdfParsedValue {
  let at = 0;
  const fail = (what: string): never => {
    throw new Error(`malformed object syntax at offset ${at}: ${what}`);
  };
  const skip = (): void => {
    while (at < text.length) {
      if (WHITESPACE.includes(text.charAt(at))) at += 1;
      else if (text[at] === "%") while (at < text.length && text[at] !== "\n" && text[at] !== "\r") at += 1;
      else return;
    }
  };
  const regular = (): string => {
    const from = at;
    while (at < text.length && !WHITESPACE.includes(text.charAt(at)) && !DELIMITERS.includes(text.charAt(at))) at += 1;
    return text.slice(from, at);
  };
  const name = (): string => {
    at += 1;
    const raw = regular();
    const bytes: number[] = [];
    for (let index = 0; index < raw.length; index += 1) {
      const hex = raw[index] === "#" ? raw.slice(index + 1, index + 3) : "";
      if (/^[0-9a-f]{2}$/i.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        index += 2;
      } else bytes.push(raw.charCodeAt(index));
    }
    return new TextDecoder().decode(Uint8Array.from(bytes));
  };
  const hexString = (): PdfParsedValue => {
    const close = text.indexOf(">", at);
    if (close === -1) fail("an unterminated hex string");
    const digits = text.slice(at + 1, close).replace(/[\0\t\n\f\r ]/g, "");
    if (!/^[0-9a-f]*$/i.test(digits)) fail("a hex string with a non-hex digit");
    at = close + 1;
    const even = digits.length % 2 === 0 ? digits : `${digits}0`;
    return {
      kind: "string",
      bytes: Uint8Array.from({ length: even.length / 2 }, (_unused, index) => Number.parseInt(even.slice(index * 2, index * 2 + 2), 16)),
    };
  };
  const literalString = (): PdfParsedValue => {
    const bytes: number[] = [];
    let depth = 0;
    at += 1;
    for (;;) {
      if (at >= text.length) fail("an unterminated string");
      const character = text[at];
      at += 1;
      if (character === "(") depth += 1;
      else if (character === ")" && depth === 0) return { kind: "string", bytes: Uint8Array.from(bytes) };
      else if (character === ")") depth -= 1;
      if (character === "\r") {
        if (text[at] === "\n") at += 1;
        bytes.push(0x0a);
        continue;
      }
      if (character !== "\\") {
        bytes.push(text.charCodeAt(at - 1));
        continue;
      }
      const escaped = text[at] ?? "";
      at += 1;
      const octal = /^[0-7]{1,3}/.exec(text.slice(at - 1, at + 2))?.[0];
      if (octal !== undefined) {
        bytes.push(Number.parseInt(octal, 8) & 0xff);
        at += octal.length - 1;
      } else if (escaped === "\r") {
        if (text[at] === "\n") at += 1;
      } else if (escaped !== "\n") {
        bytes.push(ESCAPES.get(escaped) ?? text.charCodeAt(at - 1));
      }
    }
  };
  const value = (depth: number): PdfParsedValue => {
    if (depth > DEEPEST) fail(`nesting deeper than ${DEEPEST}`);
    skip();
    if (text.startsWith("<<", at)) {
      at += 2;
      const entries = new Map<string, PdfParsedValue>();
      for (;;) {
        skip();
        if (text.startsWith(">>", at)) {
          at += 2;
          return { kind: "dict", entries };
        }
        if (text[at] !== "/") fail("a dictionary key that is not a name");
        const key = name();
        entries.set(key, value(depth + 1));
      }
    }
    if (text[at] === "[") {
      at += 1;
      const items: PdfParsedValue[] = [];
      for (;;) {
        skip();
        if (text[at] === "]") {
          at += 1;
          return { kind: "array", items };
        }
        if (at >= text.length) fail("an unterminated array");
        items.push(value(depth + 1));
      }
    }
    if (text[at] === "<") return hexString();
    if (text[at] === "(") return literalString();
    if (text[at] === "/") return { kind: "name", value: name() };
    NUMBER.lastIndex = at;
    const number = NUMBER.exec(text);
    if (number !== null) {
      at += number[0].length;
      REFERENCE.lastIndex = at;
      const reference = /^\d+$/.test(number[0]) ? REFERENCE.exec(text) : null;
      if (reference === null) return { kind: "number", value: Number(number[0]) };
      at += reference[0].length;
      return { kind: "ref", id: Number(number[0]) };
    }
    const keyword = regular();
    if (keyword === "") fail(at >= text.length ? "the end of the object" : `an unexpected ${text[at]}`);
    return { kind: "keyword", value: keyword };
  };
  return value(0);
}
