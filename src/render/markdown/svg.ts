import { decodeEntity } from "./entities";
import { isSafeUrl, SVG_ATTRIBUTES, SVG_TAGS } from "./svg-schema";
import type { HtmlWriter, SanitizedSvg, SvgElement, SvgNode } from "./types";

const MAX_DEPTH = 64;
const NAME = /[A-Za-z_][\w:.-]*/y;
const WHITESPACE = /[ \t\r\n]*/y;
const REFERENCE = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{0,31}));/y;
const STRIPPED: ReadonlySet<string> = new Set(["script", "style", "foreignobject"]);
// HTML's parser leaves an svg on these tags outside an integration point, so legacy rendered such a fence as code; rejecting them keeps that.
const BREAKOUT: ReadonlySet<string> = new Set(
  "b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strike strong sub sup table tt u ul var font".split(
    " ",
  ),
);
const INTEGRATION_POINTS: ReadonlySet<string> = new Set(["foreignobject", "desc", "title"]);
const TAG_BY_NAME = new Map(SVG_TAGS.map((tag) => [tag.toLowerCase(), tag]));
const ATTRIBUTE_BY_NAME = new Map(
  SVG_TAGS.map((tag) => [tag, new Map(["id", ...(SVG_ATTRIBUTES[tag] ?? [])].map((name) => [name.toLowerCase(), name]))]),
);
const FRAGMENT_REFERENCE = /^#([A-Za-z_][\w.-]*)$/;
const URL_REFERENCE = /^url\(\s*(["']?)#([A-Za-z_][\w.-]*)\1\s*\)$/i;
const PAINT_COLOUR = /^(?:[^()\\]*|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()\\]*\))$/i;
const NONE = /^none$/i;
const PAINT_ATTRIBUTES = ["fill", "stroke"];
const RESOURCE_ATTRIBUTES = ["clip-path", "mask", "marker-start", "marker-mid", "marker-end"];

function decodeNumeric(value: number): string | null {
  if (value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return null;
  return String.fromCodePoint(value);
}

function createTokenizer(source: string) {
  let at = 0;

  function skipWhitespace(): void {
    WHITESPACE.lastIndex = at;
    WHITESPACE.exec(source);
    at = WHITESPACE.lastIndex;
  }

  function readName(): string | null {
    NAME.lastIndex = at;
    const match = NAME.exec(source);
    if (match === null) return null;
    at = NAME.lastIndex;
    return match[0];
  }

  function readText(stop: string): string | null {
    let text = "";
    while (at < source.length && !source.startsWith(stop, at)) {
      const char = source[at] as string;
      if (char === "<") return null;
      if (char !== "&") {
        text += char;
        at++;
        continue;
      }
      REFERENCE.lastIndex = at;
      const match = REFERENCE.exec(source);
      if (match === null) return null;
      const decoded =
        match[1] !== undefined
          ? decodeNumeric(Number(match[1]))
          : match[2] !== undefined
            ? decodeNumeric(Number.parseInt(match[2], 16))
            : (decodeEntity(match[3] ?? "") ?? null);
      if (decoded === null) return null;
      text += decoded;
      at = REFERENCE.lastIndex;
    }
    return text;
  }

  function skipMarkup(open: string, close: string): boolean {
    if (!source.startsWith(open, at)) return false;
    const end = source.indexOf(close, at + open.length);
    if (end < 0) return false;
    at = end + close.length;
    return true;
  }

  function skipProlog(): boolean {
    for (;;) {
      skipWhitespace();
      if (source.startsWith("<!--", at)) {
        if (!skipMarkup("<!--", "-->")) return false;
      } else if (source.startsWith("<?xml", at)) {
        if (!skipMarkup("<?xml", "?>")) return false;
      } else if (source.slice(at, at + 9).toUpperCase() === "<!DOCTYPE") {
        const end = source.indexOf(">", at);
        if (end < 0 || source.slice(at, end).includes("[")) return false;
        at = end + 1;
      } else return true;
    }
  }

  function readAttributes(element: SvgElement): boolean {
    const seen = new Set<string>();
    for (;;) {
      const before = at;
      skipWhitespace();
      const next = source[at];
      if (next === ">" || next === "/") return true;
      if (at === before) return false;
      const name = readName();
      if (name === null || seen.has(name.toLowerCase())) return false;
      seen.add(name.toLowerCase());
      skipWhitespace();
      if (source[at] !== "=") return false;
      at++;
      skipWhitespace();
      const quote = source[at];
      if (quote !== '"' && quote !== "'") return false;
      at++;
      const value = readText(quote);
      if (value === null || source[at] !== quote) return false;
      at++;
      element.attributes.push([name, value]);
    }
  }

  function readElement(): SvgElement | null {
    const stack: SvgElement[] = [];
    let root: SvgElement | null = null;
    while (at < source.length) {
      if (source.startsWith("<!--", at)) {
        if (!skipMarkup("<!--", "-->")) return null;
        continue;
      }
      if (source.startsWith("</", at)) {
        at += 2;
        const name = readName();
        skipWhitespace();
        const current = stack.pop();
        if (name === null || source[at] !== ">" || current === undefined || current.name.toLowerCase() !== name.toLowerCase()) return null;
        at++;
        if (stack.length === 0) return current;
        continue;
      }
      if (source[at] === "<") {
        at++;
        const name = readName();
        const integrated = stack.some((open) => INTEGRATION_POINTS.has(open.name.toLowerCase()));
        if (name === null || (!integrated && BREAKOUT.has(name.toLowerCase())) || stack.length >= MAX_DEPTH) return null;
        const element: SvgElement = { name, attributes: [], children: [] };
        if (!readAttributes(element)) return null;
        const parent = stack.at(-1);
        if (parent === undefined) root = element;
        else parent.children.push(element);
        if (source.startsWith("/>", at)) {
          at += 2;
          if (parent === undefined) return element;
        } else if (source[at] === ">") {
          at++;
          stack.push(element);
        } else return null;
        continue;
      }
      if (stack.length === 0) return null;
      const text = readText("<");
      if (text === null) return null;
      (stack.at(-1) as SvgElement).children.push(text);
    }
    return stack.length === 0 ? root : null;
  }

  function parse(): SvgElement | null {
    if (!skipProlog()) return null;
    const root = readElement();
    if (root === null || root.name.toLowerCase() !== "svg") return null;
    for (;;) {
      skipWhitespace();
      if (at >= source.length) return root;
      if (!skipMarkup("<!--", "-->")) return null;
    }
  }

  return { parse };
}

/** Tokenizes an svg fence strictly, answering null for anything but well-formed markup with exactly one `<svg>` root. @internal */
export function tokenizeSvg(source: string): SvgElement | null {
  return createTokenizer(source).parse();
}

function secureLink(attributes: Map<string, string>): void {
  const linked = attributes.get("xlink:href");
  if (linked !== undefined && !attributes.has("href")) attributes.set("href", linked);
  const target = attributes.get("target");
  if (target === undefined) return;
  if (target.toLowerCase() !== "_blank") {
    attributes.delete("target");
    return;
  }
  attributes.set("target", "_blank");
  attributes.set("rel", "noopener noreferrer");
}

function secureReferences(tag: string, attributes: Map<string, string>): void {
  if (tag === "use" || tag === "pattern") {
    const href = attributes.get("href") ?? attributes.get("xlink:href");
    attributes.delete("xlink:href");
    const name = href === undefined ? undefined : FRAGMENT_REFERENCE.exec(href)?.[1];
    if (name === undefined) attributes.delete("href");
    else attributes.set("href", `#gv-${name}`);
  }
  const keep = (key: string, allowed: RegExp) => {
    const value = attributes.get(key);
    if (value === undefined) return;
    const trimmed = value.trim();
    const name = URL_REFERENCE.exec(trimmed)?.[2];
    if (name !== undefined) attributes.set(key, `url(#gv-${name})`);
    else if (!allowed.test(trimmed)) attributes.delete(key);
  };
  PAINT_ATTRIBUTES.forEach((key) => keep(key, PAINT_COLOUR));
  RESOURCE_ATTRIBUTES.forEach((key) => keep(key, NONE));
}

function sanitizeAttributes(tag: string, written: readonly [string, string][]): Map<string, string> {
  const allowed = ATTRIBUTE_BY_NAME.get(tag);
  const attributes = new Map<string, string>();
  for (const [name, value] of written) {
    const canonical = allowed?.get(name.toLowerCase());
    if (canonical === undefined) continue;
    if (canonical === "role" && value !== "img") continue;
    if (canonical === "target" && !/^_blank$/i.test(value)) continue;
    if ((canonical === "href" || canonical === "xlink:href") && !isSafeUrl({ value, attribute: canonical })) continue;
    attributes.set(canonical, canonical === "id" ? `gv-${value}` : value);
  }
  if (tag === "a") secureLink(attributes);
  secureReferences(tag, attributes);
  return attributes;
}

// A browser parses an element inside an integration point as HTML, where `<title>` is raw text, so such an element keeps only its text.
function sanitizeChildren(children: readonly SvgNode[]): (SanitizedSvg | string)[] {
  const out: (SanitizedSvg | string)[] = [];
  const pending: { node: SvgNode; into: (SanitizedSvg | string)[]; integrated: boolean }[] = children
    .map((node) => ({ node, into: out, integrated: false }))
    .reverse();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { node, into, integrated } = next;
    if (typeof node === "string") {
      into.push(node);
      continue;
    }
    const lower = node.name.toLowerCase();
    if (STRIPPED.has(lower)) continue;
    const tag = integrated ? undefined : TAG_BY_NAME.get(lower);
    const target = tag === undefined ? into : [];
    if (tag !== undefined) into.push({ tag, attributes: [...sanitizeAttributes(tag, node.attributes)], children: target });
    const inside = integrated || INTEGRATION_POINTS.has(lower);
    for (let index = node.children.length - 1; index >= 0; index--)
      pending.push({ node: node.children[index] as SvgNode, into: target, integrated: inside });
  }
  return out;
}

/** Sanitises an svg fence's source to the SVG subset, or answers null when it does not tokenize or no single `<svg>` root survives. */
export function sanitizeSvg(source: string): SanitizedSvg | null {
  const root = tokenizeSvg(source);
  if (root === null) return null;
  const kept = sanitizeChildren([root]).filter((node) => typeof node !== "string" || node.trim() !== "");
  const [only] = kept;
  return kept.length === 1 && typeof only !== "string" && only?.tag === "svg" ? only : null;
}

/** Writes a sanitised svg through the page's writer, an svg `<a>` through its own rule. */
export function writeSvg(svg: SanitizedSvg, writer: HtmlWriter): void {
  const stack: { node: SanitizedSvg | string; leaving: boolean }[] = [{ node: svg, leaving: false }];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { node, leaving } = next;
    if (typeof node === "string") writer.text(node);
    else if (leaving) writer.close();
    else {
      writer.open(node.tag === "a" ? "svgA" : node.tag, node.attributes);
      stack.push({ node, leaving: true });
      for (let index = node.children.length - 1; index >= 0; index--)
        stack.push({ node: node.children[index] as SanitizedSvg | string, leaving: false });
    }
  }
}
