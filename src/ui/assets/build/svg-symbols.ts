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

/** Best-effort SVG sanitizer for inline sprite content from trusted sources. */
export function sanitizeSVG(content: string): string {
  let result = content;
  result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  result = result.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "");
  result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  result = result.replace(/<(?:animate|set)\b[^>]*\battributeName\s*=\s*["'](?:xlink:)?href["'][^>]*(?:\/>|>[\s\S]*?<\/(?:animate|set)>)/gi, "");
  result = result.replace(/\s+(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gi, (match, val: string) => {
    const normalized = val
      .replace(/^["']|["']$/g, "")
      .toLowerCase()
      .replace(/\s/g, "");
    if (normalized.startsWith("javascript:") || normalized.startsWith("data:text/html")) return "";
    return match;
  });
  result = result.replace(/\s+on[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gi, "");
  return result;
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
