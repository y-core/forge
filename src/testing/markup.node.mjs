// Generated from src/testing/markup.ts by `bun run gen:bundles` — do not edit.

// src/render/jsx/render-to-string.ts
var VOID_ELEMENTS = /* @__PURE__ */ new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

// src/testing/markup.ts
function rx(literal) {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var ANY_TAG = "[A-Za-z][A-Za-z0-9-]*";
function openTagPattern(tag, selector) {
  return selector === "" ? `<${tag}(?:\\s[^>]*)?>` : `<${tag}(?=\\s)[^>]*\\s${rx(selector)}(?=[\\s>=])[^>]*>`;
}
function tagOf(html, selector = "") {
  return new RegExp(openTagPattern(ANY_TAG, selector)).exec(html)?.[0] ?? "";
}
function closeFrom(html, tag, from) {
  const boundary = new RegExp(`<${tag}(?=[\\s/>])[^>]*>|</${tag}>`, "g");
  boundary.lastIndex = from;
  let depth = 1;
  for (let match = boundary.exec(html); match !== null; match = boundary.exec(html)) {
    if (match[0].endsWith("/>")) continue;
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return boundary.lastIndex;
  }
  return -1;
}
function wholeElement(html, tag, open) {
  if (VOID_ELEMENTS.has(tag)) return open[0];
  const end = closeFrom(html, tag, open.index + open[0].length);
  return end === -1 ? "" : html.slice(open.index, end);
}
function attrValue(tag, attr) {
  return new RegExp(`\\s${rx(attr)}="([^"]*)"`).exec(tag)?.[1];
}
function elementOf(html, tag, selector = "") {
  const open = new RegExp(openTagPattern(tag, selector)).exec(html);
  return open === null ? "" : wholeElement(html, tag, open);
}
function tagsOf(html, selector = "") {
  return Array.from(html.matchAll(new RegExp(openTagPattern(ANY_TAG, selector), "g")), (open) => open[0]);
}
function elementsOf(html, tag, selector = "") {
  const opens = html.matchAll(new RegExp(openTagPattern(tag, selector), "g"));
  return Array.from(opens, (open) => wholeElement(html, tag, open)).filter(Boolean);
}
function attrValuesOf(html, attr, selector = "") {
  return tagsOf(html, selector).flatMap((tag) => attrValue(tag, attr) ?? []);
}
function attrOf(html, attr, selector = "") {
  return attrValue(tagOf(html, selector), attr) ?? "";
}
function attrsOf(html, selector = "") {
  const attrs = {};
  for (const match of tagOf(html, selector).matchAll(/\s([A-Za-z][A-Za-z0-9:_.-]*)(?:="([^"]*)")?/g)) {
    const name = match[1];
    if (name !== "class") attrs[name] = match[2] ?? "";
  }
  return attrs;
}
function classesOf(html, selector = "") {
  return attrOf(html, "class", selector).split(" ").filter(Boolean);
}
function variantClasses(html, baseline, selector = "") {
  const now = classesOf(html, selector);
  const before = classesOf(baseline, selector);
  return { added: now.filter((token) => !before.includes(token)), dropped: before.filter((token) => !now.includes(token)) };
}
function innerOf(element) {
  return element.replace(/^<[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?>/, "").replace(/<\/[A-Za-z][A-Za-z0-9-]*>$/, "");
}
export {
  attrOf,
  attrValuesOf,
  attrsOf,
  classesOf,
  elementOf,
  elementsOf,
  innerOf,
  tagOf,
  tagsOf,
  variantClasses
};
