import { VOID_ELEMENTS } from "../render/jsx/render-to-string";

/** Escapes a literal so it can be spliced into a regular expression. */
function rx(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ANY_TAG = "[A-Za-z][A-Za-z0-9-]*";

function openTagPattern(tag: string, selector: string): string {
  return selector === "" ? `<${tag}(?:\\s[^>]*)?>` : `<${tag}(?=\\s)[^>]*\\s${rx(selector)}(?=[\\s>=])[^>]*>`;
}

/** The opening tag of the first element whose attributes include `selector`, or `""`. @public */
export function tagOf(html: string, selector = ""): string {
  return new RegExp(openTagPattern(ANY_TAG, selector)).exec(html)?.[0] ?? "";
}

function closeFrom(html: string, tag: string, from: number): number {
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

function wholeElement(html: string, tag: string, open: RegExpExecArray): string {
  if (VOID_ELEMENTS.has(tag)) return open[0];
  const end = closeFrom(html, tag, open.index + open[0].length);
  return end === -1 ? "" : html.slice(open.index, end);
}

function attrValue(tag: string, attr: string): string | undefined {
  return new RegExp(`\\s${rx(attr)}="([^"]*)"`).exec(tag)?.[1];
}

/** The whole first `tag` element whose attributes include `selector`, nested same-name children included, or `""`. @public */
export function elementOf(html: string, tag: string, selector = ""): string {
  const open = new RegExp(openTagPattern(tag, selector)).exec(html);
  return open === null ? "" : wholeElement(html, tag, open);
}

/** The opening tag of every element whose attributes include `selector`, in document order. @public */
export function tagsOf(html: string, selector = ""): string[] {
  return Array.from(html.matchAll(new RegExp(openTagPattern(ANY_TAG, selector), "g")), (open) => open[0]);
}

/** Every whole `tag` element whose attributes include `selector`, in document order of their opening tags. @public */
export function elementsOf(html: string, tag: string, selector = ""): string[] {
  const opens = html.matchAll(new RegExp(openTagPattern(tag, selector), "g"));
  return Array.from(opens, (open) => wholeElement(html, tag, open)).filter(Boolean);
}

/** The value `attr` carries on every element whose attributes include `selector` and that carries it, in document order. @public */
export function attrValuesOf(html: string, attr: string, selector = ""): string[] {
  return tagsOf(html, selector).flatMap((tag) => attrValue(tag, attr) ?? []);
}

/** The value `attr` carries on the first element whose attributes include `selector`, or `""`. @public */
export function attrOf(html: string, attr: string, selector = ""): string {
  return attrValue(tagOf(html, selector), attr) ?? "";
}

// One `toEqual` over the whole record turns "these two attributes, and no third" into one assertion;
// separate reads pass on an element that grew one nobody meant to add.
/** Every attribute of the first element matching `selector`, name to exact value, `class` dropped. @public */
export function attrsOf(html: string, selector = ""): Record<string, string> {
  const attrs: Record<string, string> = {};
  // The name is matched case-sensitively: `viewBox` read through a lowercase-only pattern comes back
  // as `view` with an empty value, which is a wrong record rather than a missing one.
  for (const match of tagOf(html, selector).matchAll(/\s([A-Za-z][A-Za-z0-9:_.-]*)(?:="([^"]*)")?/g)) {
    const name = match[1] as string;
    if (name !== "class") attrs[name] = match[2] ?? "";
  }
  return attrs;
}

/** The class tokens of the first element matching `selector`, in the order they were emitted. @public */
export function classesOf(html: string, selector = ""): string[] {
  return attrOf(html, "class", selector).split(" ").filter(Boolean);
}

/** What one render's classes carry that a baseline render's do not, and the reverse. @public */
export function variantClasses(html: string, baseline: string, selector = ""): { added: string[]; dropped: string[] } {
  const now = classesOf(html, selector);
  const before = classesOf(baseline, selector);
  return { added: now.filter((token) => !before.includes(token)), dropped: before.filter((token) => !now.includes(token)) };
}

/** The inner markup of one element, with its own opening and closing tags removed. @public */
export function innerOf(element: string): string {
  return element.replace(/^<[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*)?>/, "").replace(/<\/[A-Za-z][A-Za-z0-9-]*>$/, "");
}
