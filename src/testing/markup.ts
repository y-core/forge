import { VOID_ELEMENTS } from "../jsx/render-to-string";

/** Escapes a literal so it can be spliced into a regular expression. */
function rx(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function openTagPattern(tag: string, selector: string): string {
  return selector === "" ? `<${tag}(?:\\s[^>]*)?>` : `<${tag}[^>]*\\s${rx(selector)}(?=[\\s>=])[^>]*>`;
}

/** The opening tag of the first element whose attributes include `selector`, or `""`. @public */
export function tagOf(html: string, selector = ""): string {
  return new RegExp(openTagPattern("[a-z][a-z0-9-]*", selector)).exec(html)?.[0] ?? "";
}

// Children are taken up to the first closing tag of the same name, so an element nested inside
// another of its own kind is read as the outer one cut short — pass a selector that names the inner.
/** The whole first `tag` element whose attributes include `selector`, children included, or `""`. @public */
export function elementOf(html: string, tag: string, selector = ""): string {
  const open = openTagPattern(tag, selector);
  const pattern = VOID_ELEMENTS.has(tag) ? open : `${open}[\\s\\S]*?</${tag}>`;
  return new RegExp(pattern).exec(html)?.[0] ?? "";
}

/** The value `attr` carries on the first element whose attributes include `selector`, or `""`. @public */
export function attrOf(html: string, attr: string, selector = ""): string {
  return new RegExp(`\\s${rx(attr)}="([^"]*)"`).exec(tagOf(html, selector))?.[1] ?? "";
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
  return element.replace(/^<[a-z][a-z0-9-]*(?:\s[^>]*)?>/, "").replace(/<\/[a-z][a-z0-9-]*>$/, "");
}
