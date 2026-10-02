import type { InlineConstruct, InlineMatch, MarkdownExtensionInline, WikiLinkConstructOptions } from "./types";

const EXCLAMATION_MARK = 0x21;
const LEFT_BRACKET = 0x5b;
const BACKSLASH = 0x5c;
const RIGHT_BRACKET = 0x5d;
const PIPE = 0x7c;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const MAX_CONTENT_LENGTH = 999;
const MAX_LENGTH = "![[".length + MAX_CONTENT_LENGTH + "\\|".length + "]]".length;

function isContentEnd(code: number): boolean {
  return Number.isNaN(code) || code === LINE_FEED || code === CARRIAGE_RETURN;
}

function createWikiNode(raw: string, start: number, end: number, options: WikiLinkConstructOptions): MarkdownExtensionInline {
  const embed = raw.startsWith("!");
  const inner = raw.slice(embed ? 3 : 2, -2);
  const pipe = inner.indexOf("|");
  const target = pipe === -1 ? inner : inner.slice(0, inner[pipe - 1] === "\\" ? pipe - 1 : pipe);
  const label = pipe === -1 ? undefined : inner.slice(pipe + 1);
  if (!embed) return { type: "wikiLink", target, ...(label === undefined ? {} : { label }), start, end };
  const id = options.embedId(target) ?? "";
  return { type: "embed", id, ...(label === undefined ? {} : { alt: label }), start, end };
}

function scanContent(content: string, from: number, limit: number, label: boolean): number {
  let at = from;
  let size = 0;
  while (at < limit) {
    const code = content.charCodeAt(at);
    if (code === RIGHT_BRACKET) return at;
    if (!label && (code === PIPE || (code === BACKSLASH && content.charCodeAt(at + 1) === PIPE))) return at;
    size++;
    if (isContentEnd(code) || code === LEFT_BRACKET || size > MAX_CONTENT_LENGTH) return -1;
    at++;
  }
  return -1;
}

function scanWikiLink(content: string, at: number, limit: number, options: WikiLinkConstructOptions): InlineMatch | null {
  let cursor = content.charCodeAt(at) === EXCLAMATION_MARK ? at + 1 : at;
  if (content.charCodeAt(cursor) !== LEFT_BRACKET || content.charCodeAt(cursor + 1) !== LEFT_BRACKET) return null;
  cursor += 2;
  const first = content.charCodeAt(cursor);
  if (first === RIGHT_BRACKET || first === PIPE || (first === BACKSLASH && content.charCodeAt(cursor + 1) === PIPE)) return null;
  let close = scanContent(content, cursor, limit, false);
  if (close < 0) return null;
  if (content.charCodeAt(close) !== RIGHT_BRACKET) {
    const labelStart = close + (content.charCodeAt(close) === PIPE ? 1 : 2);
    const targetLength = close - cursor;
    close = scanContent(content, labelStart, Math.min(limit, labelStart + MAX_CONTENT_LENGTH - targetLength + 1), true);
    if (close < 0) return null;
  }
  if (close + 1 >= limit || content.charCodeAt(close + 1) !== RIGHT_BRACKET) return null;
  const end = close + 2;
  return { end, node: createWikiNode(content.slice(at, end), at, end, options) };
}

/** Creates the `[[target|label]]` wiki link and `![[target|alt]]` embed construct; a link is kept outside links and images, an embed outside images. */
export function createWikiLinkConstruct(options: WikiLinkConstructOptions): InlineConstruct {
  return {
    name: "wikiLink",
    triggers: [LEFT_BRACKET, EXCLAMATION_MARK],
    maxLength: MAX_LENGTH,
    scan: (content, at, limit) => scanWikiLink(content, at, limit, options),
    accept: (node, { inLink, inImage }) => {
      if (node.type === "embed") return !inImage && node.id !== "";
      return !inLink && !inImage;
    },
  };
}
