/** Maps each `<symbol>` id in sprite markup to its viewBox. @public */
export function extractViewBoxes(spriteContent: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const symbolRegex = /<symbol([^>]*)>/g;
  let match = symbolRegex.exec(spriteContent);
  while (match !== null) {
    const attrs = match[1] ?? "";
    const idMatch = attrs.match(/id="([^"]+)"/);
    const viewBoxMatch = attrs.match(/viewBox="([^"]+)"/i);
    if (idMatch?.[1] && viewBoxMatch?.[1]) {
      meta[idMatch[1]] = viewBoxMatch[1];
    }
    match = symbolRegex.exec(spriteContent);
  }
  return meta;
}

// Copied rather than imported from `http/escape`: `ui/assets/build` declares no edge to `http`, so
// the import that would share this class fails `validate-namespace-graph`.
/** C0/C1 controls and spaces, which browsers ignore when resolving a scheme. */
// oxlint-disable-next-line eslint/no-control-regex -- deliberately matching C0/C1 control chars
const URL_NOISE = /[\u0000-\u0020\u007f-\u009f]/g;

const NAMED_REFS = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["colon", ":"],
  ["gt", ">"],
  ["lt", "<"],
  ["newline", "\n"],
  ["quot", '"'],
  ["tab", "\t"],
]);

const CHAR_REF = /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi;

/** One decoding pass over HTML character references, as the parser does it — for comparison only, never written back. */
function decodeCharRefs(value: string): string {
  return value.replace(CHAR_REF, (match, ref: string) => {
    const lower = ref.toLowerCase();
    const code = lower.startsWith("#x") ? Number.parseInt(ref.slice(2), 16) : lower.startsWith("#") ? Number.parseInt(ref.slice(1), 10) : NaN;
    if (Number.isNaN(code)) return NAMED_REFS.get(lower) ?? match;
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** The scheme a browser would resolve the attribute value to, with every spelling that hides one undone. */
function resolvedScheme(value: string): string {
  return decodeCharRefs(value.replace(/^["']|["']$/g, ""))
    .replace(URL_NOISE, "")
    .toLowerCase();
}

const PASSES: readonly ((markup: string) => string)[] = [
  (markup) => markup.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ""),
  (markup) => markup.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, ""),
  (markup) => markup.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ""),
  (markup) => markup.replace(/<(?:animate|set)\b[^>]*\battributeName\s*=\s*["'](?:xlink:)?href["'][^>]*(?:\/>|>[\s\S]*?<\/(?:animate|set)>)/gi, ""),
  (markup) =>
    markup.replace(/\s+(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gi, (match, value: string) => {
      const scheme = resolvedScheme(value);
      return scheme.startsWith("javascript:") || scheme.startsWith("data:text/html") ? "" : match;
    }),
  (markup) => markup.replace(/\s+on[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gi, ""),
];

// Every pass only deletes, so a round that changes anything shortens the markup and the loop ends.
// Reaching the cap means an adversarial nesting depth, and half-stripped markup is worse than none.
const MAX_ROUNDS = 8;

/** Deletes every script, style, foreignObject, event handler and unsafe `href` from SVG markup, repeating until it stops changing. @public */
export function sanitizeSVG(content: string): string {
  let result = content;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const next = PASSES.reduce((markup, pass) => pass(markup), result);
    if (next === result) return result;
    result = next;
  }
  throw new Error(`sanitizeSVG: markup still changing after ${MAX_ROUNDS} rounds — refusing to emit partially sanitized SVG`);
}

const PROPAGATABLE_ATTRS = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"] as const;

/** Reads the presentation attributes on a root `<svg>` tag that propagate to its shapes. @internal */
export function extractRootAttrs(svgTag: string): Partial<Record<(typeof PROPAGATABLE_ATTRS)[number], string>> {
  const attrs: Partial<Record<(typeof PROPAGATABLE_ATTRS)[number], string>> = {};
  for (const attr of PROPAGATABLE_ATTRS) {
    // The leading boundary is what keeps `data-stroke="…"` from being read as `stroke`.
    const match = svgTag.match(new RegExp(`(?:^|\\s)${attr}="([^"]+)"`, "i"));
    if (match?.[1]) attrs[attr] = match[1];
  }
  return attrs;
}

/** Wraps inner markup in one `<g>` carrying the transform and the root presentation attributes, so SVG inheritance resolves nested overrides. @internal */
export function wrapRootAttrs(inner: string, rootAttrs: Partial<Record<string, string>>, transform?: string): string {
  const attrs: string[] = [];
  if (transform !== undefined) attrs.push(`transform="${transform}"`);
  for (const attr of PROPAGATABLE_ATTRS) {
    const value = rootAttrs[attr];
    if (value !== undefined) attrs.push(`${attr}="${value}"`);
  }
  return attrs.length === 0 ? inner : `<g ${attrs.join(" ")}>${inner}</g>`;
}

/** Converts an SVG document into a sanitized `<symbol>` with a zero-origin viewBox, or null when it has no content. @public */
export function svgToSymbol(svgContent: string, key: string, prefix: string): { id: string; symbol: string } | null {
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/i);
  const rawViewBox = viewBoxMatch?.[1] ?? "0 0 24 24";

  // `<use>` renders at (0,0), so a non-zero viewBox origin must be zeroed and translated back.
  const [minX = 0, minY = 0, w = 24, h = 24] = rawViewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const hasOffset = minX !== 0 || minY !== 0;
  const viewBox = `0 0 ${w} ${h}`;

  const svgTagMatch = svgContent.match(/<svg([^>]*)>/i);
  const innerMatch = svgContent.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  if (innerMatch?.[1] === undefined) return null;

  const rootAttrs = svgTagMatch?.[1] ? extractRootAttrs(svgTagMatch[1]) : {};
  const sanitized = sanitizeSVG(innerMatch[1]).trim();
  const inner = wrapRootAttrs(sanitized, rootAttrs, hasOffset ? `translate(${-minX} ${-minY})` : undefined);

  const id = `${prefix}${key}`;
  return { id, symbol: `  <symbol id="${id}" viewBox="${viewBox}">${inner}</symbol>` };
}
