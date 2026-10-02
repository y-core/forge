const ATTRIBUTE = String.raw`\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:[^"'=<>\x60\s]+|'[^']*'|"[^"]*"))?`;
const OPEN_TAG = String.raw`<[A-Za-z][A-Za-z0-9-]*(?:${ATTRIBUTE})*\s*\/?>`;
const CLOSING_TAG = String.raw`<\/[A-Za-z][A-Za-z0-9-]*\s*>`;
const BLOCK_TAG_NAMES =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const BLOCK_START = String.raw`<\/?(?:${BLOCK_TAG_NAMES})(?:[ \t>]|\/>|$)`;
const RAW_TEXT_START = String.raw`<(?:pre|script|style|textarea)(?:[ \t>]|$)`;
const OTHER = String.raw`<!--|<\?|<![A-Za-z]|<!\[CDATA\[`;

const CONTAINER_PREFIX = /^ {0,3}(?:>[ \t]?|(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$))/;
const INTERRUPTING_START = new RegExp(`^ {0,3}(?:${RAW_TEXT_START}|${BLOCK_START}|${OTHER})`, "i");
const LONE_TAG = new RegExp(`^ {0,3}(?:${OPEN_TAG}|${CLOSING_TAG})[ \\t]*$`);

const RAW_HTML = new RegExp(`${OPEN_TAG}|${CLOSING_TAG}|${BLOCK_START}|${RAW_TEXT_START}|${OTHER}`, "im");

/** Reports whether markdown holds anything CommonMark's raw-HTML grammar reads as HTML, which this engine renders as text instead. */
export function hasRawHtml(markdown: string): boolean {
  return RAW_HTML.test(markdown);
}

/** Reports whether any line, after its block quote and list markers, meets an HTML-block start condition; the seventh only after a blank line. */
export function hasHtmlBlockStart(markdown: string): boolean {
  let previousBlank = true;
  return markdown.split(/\r\n|\n|\r/).some((line) => {
    let rest = line;
    for (let prefix = CONTAINER_PREFIX.exec(rest); prefix !== null && prefix[0].length > 0; prefix = CONTAINER_PREFIX.exec(rest))
      rest = rest.slice(prefix[0].length);
    const starts = INTERRUPTING_START.test(rest) || (previousBlank && LONE_TAG.test(rest));
    previousBlank = rest.trim() === "";
    return starts;
  });
}
