import { decodeEntity } from "./entities";
import { HTML4_ENTITIES } from "./html4-entities.fixture";

type Attribute = readonly [name: string, value: string | null];
type Last = "starttag" | "endtag" | "data" | "comment" | "decl" | "pi" | "ref";

const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "article",
  "header",
  "aside",
  "hgroup",
  "blockquote",
  "hr",
  "iframe",
  "body",
  "li",
  "map",
  "button",
  "object",
  "canvas",
  "ol",
  "caption",
  "output",
  "col",
  "p",
  "colgroup",
  "pre",
  "dd",
  "progress",
  "div",
  "section",
  "dl",
  "table",
  "td",
  "dt",
  "tbody",
  "embed",
  "textarea",
  "fieldset",
  "tfoot",
  "figcaption",
  "th",
  "figure",
  "thead",
  "footer",
  "tr",
  "form",
  "ul",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "video",
  "script",
  "style",
]);
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(["script", "style"]);

const CHUNK = /<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;
const INTERESTING = /[&<]/g;
const ENTITY_REF = /&([a-zA-Z][-.a-zA-Z0-9]*)[^a-zA-Z0-9]/y;
const CHAR_REF = /&#(?:[0-9]+|[xX][0-9a-fA-F]+)[^0-9a-fA-F]/y;
const START_TAG_OPEN = /<[a-zA-Z]/y;
const TAG_FIND = /([a-zA-Z][^\t\n\r\f />]*)(?:\s|\/(?!>))*/y;
const ATTR_FIND = /((?<=['"\s/])[^\s/>][^\s/=>]*)(\s*=+\s*('[^']*'|"[^"]*"|(?!['"])[^>\s]*))?(?:\s|\/(?!>))*/y;
const START_TAG_END =
  /<[a-zA-Z][^\t\n\r\f />]*(?:[\s/]*(?:(?<=['"\s/])[^\s/>][^\s/=>]*(?:\s*=+\s*(?:'[^']*'|"[^"]*"|(?!['"])[^>\s]*)\s*)?(?:\s|\/(?!>))*)*)?\s*/y;
const END_TAG_FIND = /<\/\s*([a-zA-Z][-.a-zA-Z0-9:_]*)\s*>/y;
const COMMENT_CLOSE = /--\s*>/g;
const WHITESPACE = /\s+/g;
const ATTR_REFERENCE = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g;

function codePoint(value: number): string | null {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : null;
}

function html4Reference(name: string): string | null {
  const value = Object.hasOwn(HTML4_ENTITIES, name) ? HTML4_ENTITIES[name] : undefined;
  return value === undefined ? null : String.fromCodePoint(value);
}

function unescapeAttribute(value: string): string {
  return value.replace(ATTR_REFERENCE, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return codePoint(Number.parseInt(body.slice(2), 16)) ?? whole;
    if (body.startsWith("#")) return codePoint(Number.parseInt(body.slice(1), 10)) ?? whole;
    return decodeEntity(body) ?? whole;
  });
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}

function lstrip(text: string, chars?: string): string {
  if (chars === undefined) return text.trimStart();
  let start = 0;
  while (start < text.length && chars.includes(text[start] ?? "")) start++;
  return text.slice(start);
}

function createNormalizer() {
  let output = "";
  let last: Last = "starttag";
  let lastTag = "";
  let inPre = false;

  function data(text: string): void {
    const afterTag = last === "endtag" || last === "starttag";
    const afterBlockTag = afterTag && BLOCK_TAGS.has(lastTag);
    if (afterTag && lastTag === "br") text = lstrip(text, "\n");
    if (!inPre) text = text.replace(WHITESPACE, " ");
    if (afterBlockTag && !inPre) {
      if (last === "starttag") text = text.trimStart();
      else if (last === "endtag") text = text.trim();
    }
    output += text;
    last = "data";
  }

  function startTag(tag: string, attributes: Attribute[]): void {
    if (tag === "pre") inPre = true;
    if (BLOCK_TAGS.has(tag)) output = output.trimEnd();
    output += "<" + tag;
    const sorted = attributes.toSorted(([a, av], [b, bv]) => (a === b ? (av ?? "").localeCompare(bv ?? "") : a < b ? -1 : 1));
    for (const [name, value] of sorted) output += " " + name + (value === null ? "" : '="' + escapeAttribute(value) + '"');
    output += ">";
    lastTag = tag;
    last = "starttag";
  }

  function endTag(tag: string): void {
    if (tag === "pre") inPre = false;
    else if (BLOCK_TAGS.has(tag)) output = output.trimEnd();
    output += "</" + tag + ">";
    lastTag = tag;
    last = "endtag";
  }

  function reference(char: string | null, fallback: string): void {
    if (char === "<") output += "&lt;";
    else if (char === ">") output += "&gt;";
    else if (char === "&") output += "&amp;";
    else if (char === '"') output += "&quot;";
    else output += char ?? fallback;
    last = "ref";
  }

  function emit(kind: "comment" | "decl" | "pi", open: string, body: string, close: string): void {
    output += open + body + close;
    last = kind;
  }

  function charRef(name: string): void {
    const char = name.startsWith("x") ? codePoint(Number.parseInt(name.slice(1), 16)) : /^\d+$/.test(name) ? codePoint(Number(name)) : null;
    reference(char, "&" + name + ";");
  }

  function startTagEnd(raw: string, at: number): number {
    START_TAG_END.lastIndex = at;
    const match = START_TAG_END.exec(raw);
    if (!match) return -1;
    const end = START_TAG_END.lastIndex;
    if (raw[end] === ">") return end + 1;
    if (raw.startsWith("/>", end)) return end + 2;
    return end > at ? end : at + 1;
  }

  function parseStartTag(raw: string, at: number): number {
    const end = startTagEnd(raw, at);
    if (end < 0) return end;
    TAG_FIND.lastIndex = at + 1;
    const tagMatch = TAG_FIND.exec(raw);
    const tag = (tagMatch?.[1] ?? "").toLowerCase();
    let cursor = TAG_FIND.lastIndex;
    const attributes: Attribute[] = [];
    while (cursor < end) {
      ATTR_FIND.lastIndex = cursor;
      const match = ATTR_FIND.exec(raw);
      if (!match || ATTR_FIND.lastIndex === cursor) break;
      const [, name = "", rest, quoted = ""] = match;
      let value: string | null = rest ? quoted : null;
      if (value !== null && value.length >= 2 && (value[0] === "'" || value[0] === '"') && value.at(-1) === value[0]) value = value.slice(1, -1);
      if (value) value = unescapeAttribute(value);
      attributes.push([name.toLowerCase(), value]);
      cursor = ATTR_FIND.lastIndex;
    }
    const tail = raw.slice(cursor, end).trim();
    if (tail !== ">" && tail !== "/>") {
      data(raw.slice(at, end));
      return end;
    }
    if (tail.endsWith("/>")) {
      startTag(tag, attributes);
      last = "endtag";
      return end;
    }
    startTag(tag, attributes);
    if (!RAW_TEXT_TAGS.has(tag)) return end;
    const close = raw.toLowerCase().indexOf("</" + tag, end);
    const textEnd = close < 0 ? raw.length : close;
    if (textEnd > end) data(raw.slice(end, textEnd));
    return textEnd;
  }

  function parseEndTag(raw: string, at: number): number {
    const gt = raw.indexOf(">", at + 1);
    if (gt < 0) return -1;
    END_TAG_FIND.lastIndex = at;
    const match = END_TAG_FIND.exec(raw);
    if (match?.[1]) {
      endTag(match[1].toLowerCase());
      return END_TAG_FIND.lastIndex;
    }
    TAG_FIND.lastIndex = at + 2;
    const name = TAG_FIND.exec(raw);
    if (!name?.[1]) {
      if (raw.startsWith("</>", at)) return at + 3;
      emit("comment", "<!--", raw.slice(at + 2, gt), "-->");
      return gt + 1;
    }
    endTag(name[1].toLowerCase());
    return gt + 1;
  }

  function parseMarkup(raw: string, at: number): number {
    if (raw.startsWith("<!--", at)) {
      COMMENT_CLOSE.lastIndex = at + 4;
      const close = COMMENT_CLOSE.exec(raw);
      if (!close) return -1;
      emit("comment", "<!--", raw.slice(at + 4, close.index), "-->");
      return COMMENT_CLOSE.lastIndex;
    }
    const gt = raw.indexOf(">", at + 2);
    if (gt < 0) return -1;
    if (raw.startsWith("<?", at)) emit("pi", "<?", raw.slice(at + 2, gt), ">");
    else if (raw.startsWith("<![", at) || raw.slice(at, at + 9).toLowerCase() === "<!doctype") emit("decl", "<!", raw.slice(at + 2, gt), ">");
    else emit("comment", "<!--", raw.slice(at + 2, gt), "-->");
    return gt + 1;
  }

  function parseTag(raw: string, at: number): number {
    START_TAG_OPEN.lastIndex = at;
    if (START_TAG_OPEN.test(raw)) return parseStartTag(raw, at);
    if (raw.startsWith("</", at)) return parseEndTag(raw, at);
    if (raw.startsWith("<!", at) || raw.startsWith("<?", at)) return parseMarkup(raw, at);
    data("<");
    return at + 1;
  }

  function parseReference(raw: string, at: number): number {
    if (raw.startsWith("&#", at)) {
      CHAR_REF.lastIndex = at;
      const match = CHAR_REF.exec(raw);
      if (!match) {
        data("&#");
        return at + 2;
      }
      charRef(match[0].slice(2, -1));
      return match[0].endsWith(";") ? CHAR_REF.lastIndex : CHAR_REF.lastIndex - 1;
    }
    ENTITY_REF.lastIndex = at;
    const match = ENTITY_REF.exec(raw);
    if (!match?.[1]) {
      data("&");
      return at + 1;
    }
    reference(html4Reference(match[1]), "&" + match[1] + ";");
    return match[0].endsWith(";") ? ENTITY_REF.lastIndex : ENTITY_REF.lastIndex - 1;
  }

  function feed(raw: string): void {
    let at = 0;
    while (at < raw.length) {
      INTERESTING.lastIndex = at;
      const next = INTERESTING.exec(raw);
      const stop = next ? next.index : raw.length;
      if (stop > at) data(raw.slice(at, stop));
      if (!next) return;
      const after = raw[stop] === "<" ? parseTag(raw, stop) : parseReference(raw, stop);
      if (after < 0) {
        const gt = raw.indexOf(">", stop + 1);
        const end = gt < 0 ? stop + 1 : gt + 1;
        data(raw.slice(stop, end));
        at = end;
      } else at = after;
    }
  }

  function verbatim(text: string): void {
    output += text;
  }

  return { feed, verbatim, result: () => output };
}

/** Normalises HTML the way cmark's `test/normalize.py` does, so insignificant differences compare equal. */
export function normalizeHtml(html: string): string {
  const normalizer = createNormalizer();
  let pending = "";
  for (const [chunk] of html.matchAll(CHUNK)) {
    if (chunk.startsWith("<![CDATA")) {
      normalizer.feed(pending);
      pending = "";
      normalizer.verbatim(chunk);
    } else pending += chunk;
  }
  normalizer.feed(pending);
  return normalizer.result();
}
