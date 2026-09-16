/** Escapes a literal so it can be spliced into a regular expression. */
function rx(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The opening tag of the first element whose attributes include `selector`, or `""`. @internal */
export function tagOf(html: string, selector = ""): string {
  const pattern = selector === "" ? /<[a-z][a-z0-9-]*[^>]*>/ : new RegExp(`<[a-z][a-z0-9-]*[^>]*\\s${rx(selector)}(?=[\\s>=])[^>]*>`);
  return pattern.exec(html)?.[0] ?? "";
}

/** The value `attr` carries on the first element whose attributes include `selector`, or `""`. @internal */
export function attrOf(html: string, attr: string, selector = ""): string {
  return new RegExp(`\\s${rx(attr)}="([^"]*)"`).exec(tagOf(html, selector))?.[1] ?? "";
}

// One `toEqual` over the whole record turns "these two attributes, and no third" into one assertion;
// separate reads pass on an element that grew one nobody meant to add.
/** Every attribute of the first element matching `selector`, name to exact value, `class` dropped. @internal */
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

/** The class tokens of the first element matching `selector`, in the order they were emitted. @internal */
export function classesOf(html: string, selector = ""): string[] {
  return attrOf(html, "class", selector).split(" ").filter(Boolean);
}

/** What one render's classes carry that a baseline render's do not, and the reverse. @internal */
export function variantClasses(html: string, baseline: string, selector = ""): { added: string[]; dropped: string[] } {
  const now = classesOf(html, selector);
  const before = classesOf(baseline, selector);
  return { added: now.filter((token) => !before.includes(token)), dropped: before.filter((token) => !now.includes(token)) };
}
