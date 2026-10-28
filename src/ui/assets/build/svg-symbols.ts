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

// Copied rather than imported from `html/escape`: `ui/assets/build` declares no edge to `html`, so
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

/** Elements dropped with everything they contain, whether or not their closing tag is present. */
const DROPPED_ELEMENTS = new Set(["script", "style", "foreignobject"]);

/** The dropped elements whose content is raw text, so no element can nest inside them. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

/** SMIL elements that retarget one attribute of the element they sit in. */
const RETARGETING_ELEMENTS = new Set(["animate", "animatetransform", "set"]);

/** The attribute names a SMIL animation may retarget: presentation and geometry, never a URL. */
const ANIMATABLE_ATTRS = new Set([
  "color",
  "cx",
  "cy",
  "d",
  "display",
  "fill",
  "fill-opacity",
  "font-size",
  "height",
  "offset",
  "opacity",
  "points",
  "r",
  "rx",
  "ry",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "stroke-width",
  "transform",
  "visibility",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
]);

/** Attributes a browser resolves as a URL, so a scheme in one of them executes. */
const URL_VALUED_ATTRS = new Set(["action", "data", "formaction", "href", "poster", "src", "xlink:base", "xlink:href", "xml:base"]);

/** An event handler is spelled `on` plus letters and nothing else, which is what keeps `only-child` out. */
const HANDLER_ATTR = /^on[a-z]+$/i;

/** A tag name the serializer may re-emit; the tokenizer accepts `<` in one, and emitting that reopens a tag. */
const TAG_NAME = /^[A-Za-z][A-Za-z0-9:_.-]*$/;

/** An attribute name the serializer may re-emit. */
const ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;

/** One attribute as the tokenizer read it, carrying the source text the serializer re-emits. */
interface SvgAttr {
  name: string;
  value: string;
  source: string;
}

/** Every construct the sanitizer understands; anything else in the source is dropped rather than re-emitted. */
type SvgToken =
  | { kind: "text"; text: string }
  | { kind: "start"; name: string; attrs: readonly SvgAttr[]; selfClosing: boolean }
  | { kind: "end"; name: string };

/** Reads one tag's attributes from `start`, with the index just past the tag that closed them. */
function readAttrs(markup: string, start: number): { attrs: SvgAttr[]; selfClosing: boolean; next: number } {
  const attrs: SvgAttr[] = [];
  let p = start;
  let selfClosing = false;
  while (p < markup.length) {
    // `/` separates attributes as readily as a space does, so `<circle r="5"/onload=…>` carries two —
    // and only a `/` immediately before the `>` closes the tag.
    let slash = false;
    while (/[\s/]/.test(markup.charAt(p))) {
      if (markup.charAt(p) === "/") slash = true;
      p++;
    }
    if (p >= markup.length) break;
    if (markup.charAt(p) === ">") {
      selfClosing = slash;
      p++;
      break;
    }
    const nameStart = p;
    while (p < markup.length && !/[\s/>=]/.test(markup.charAt(p))) p++;
    const name = markup.slice(nameStart, p);
    while (/\s/.test(markup.charAt(p))) p++;
    if (markup.charAt(p) !== "=") {
      attrs.push({ name, value: "", source: name });
      continue;
    }
    p++;
    while (/\s/.test(markup.charAt(p))) p++;
    const quote = markup.charAt(p);
    if (quote === '"' || quote === "'") {
      const end = markup.indexOf(quote, p + 1);
      const value = markup.slice(p + 1, end === -1 ? markup.length : end);
      attrs.push({ name, value, source: `${name}=${quote}${value}${quote}` });
      p = end === -1 ? markup.length : end + 1;
      continue;
    }
    const valueStart = p;
    while (p < markup.length && !/[\s>]/.test(markup.charAt(p))) p++;
    const value = markup.slice(valueStart, p);
    attrs.push({ name, value, source: `${name}=${value}` });
  }
  return { attrs, selfClosing, next: p };
}

/** The index just past a dropped element's closing tag, or `null` when the markup carries none. */
function skipElement(markup: string, from: number, name: string): number | null {
  const lower = markup.toLowerCase();
  let depth = 1;
  let p = from;
  while (p < markup.length) {
    const closeAt = lower.indexOf(`</${name}`, p);
    if (closeAt === -1) return null;
    const openAt = RAW_TEXT_ELEMENTS.has(name) ? -1 : lower.indexOf(`<${name}`, p);
    if (openAt !== -1 && openAt < closeAt) {
      depth++;
      p = openAt + name.length + 1;
      continue;
    }
    depth--;
    const gt = markup.indexOf(">", closeAt);
    p = gt === -1 ? markup.length : gt + 1;
    if (depth === 0) return p;
  }
  return null;
}

/** Whether a SMIL element names an attribute that is safe to animate. */
function retargetsSafely(attrs: readonly SvgAttr[]): boolean {
  const target = attrs.find((attr) => attr.name.toLowerCase() === "attributename");
  return target !== undefined && ANIMATABLE_ATTRS.has(target.value.trim().toLowerCase());
}

/** Reads markup into tokens, dropping every element whose content may never be emitted. */
function tokenize(markup: string): SvgToken[] {
  const tokens: SvgToken[] = [];
  let i = 0;
  while (i < markup.length) {
    const lt = markup.indexOf("<", i);
    if (lt === -1) {
      tokens.push({ kind: "text", text: markup.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ kind: "text", text: markup.slice(i, lt) });
    const after = markup.charAt(lt + 1);

    if (after === "!" || after === "?") {
      const closer = markup.startsWith("<!--", lt) ? "-->" : markup.startsWith("<![CDATA[", lt) ? "]]>" : ">";
      const end = markup.indexOf(closer, lt + 2);
      i = end === -1 ? markup.length : end + closer.length;
      continue;
    }

    if (after === "/") {
      const gt = markup.indexOf(">", lt);
      const name = markup.slice(lt + 2, gt === -1 ? markup.length : gt).trim();
      if (TAG_NAME.test(name)) tokens.push({ kind: "end", name });
      i = gt === -1 ? markup.length : gt + 1;
      continue;
    }

    if (!/[A-Za-z]/.test(after)) {
      tokens.push({ kind: "text", text: "<" });
      i = lt + 1;
      continue;
    }

    let p = lt + 1;
    while (p < markup.length && !/[\s/>]/.test(markup.charAt(p))) p++;
    const name = markup.slice(lt + 1, p);
    const read = readAttrs(markup, p);
    i = read.next;
    if (!TAG_NAME.test(name)) continue;

    const lower = name.toLowerCase();
    if (DROPPED_ELEMENTS.has(lower) || (RETARGETING_ELEMENTS.has(lower) && !retargetsSafely(read.attrs))) {
      const end = read.selfClosing ? i : skipElement(markup, i, lower);
      // An unterminated raw-text element swallows the rest of the file as text, so dropping the tag
      // alone would leave that text to be re-emitted; every other element parses on past its own tag.
      i = end ?? (RAW_TEXT_ELEMENTS.has(lower) ? markup.length : i);
      continue;
    }
    tokens.push({ kind: "start", name, attrs: read.attrs, selfClosing: read.selfClosing });
  }
  return tokens;
}

/** Whether one attribute may be re-emitted: a valid name, no handler, and no scheme that executes. */
function admitsAttr(attr: SvgAttr): boolean {
  if (!ATTR_NAME.test(attr.name) || HANDLER_ATTR.test(attr.name)) return false;
  if (!URL_VALUED_ATTRS.has(attr.name.toLowerCase())) return true;
  const scheme = resolvedScheme(attr.value);
  return !scheme.startsWith("javascript:") && !scheme.startsWith("data:text/html");
}

/** An `&` that opens no character reference. */
const BARE_AMPERSAND = /&(?!(?:#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);)/gi;

/** Escapes text so no `<` or `>` in it can join a neighbour into markup once an element between them is dropped. */
function escapeSvgText(text: string): string {
  return text.replace(BARE_AMPERSAND, "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Writes the tokens back out, keeping only the attributes `admitsAttr` allows. */
function serialize(tokens: readonly SvgToken[]): string {
  let out = "";
  for (const token of tokens) {
    if (token.kind === "text") {
      out += escapeSvgText(token.text);
    } else if (token.kind === "end") {
      if (!DROPPED_ELEMENTS.has(token.name.toLowerCase())) out += `</${token.name}>`;
    } else {
      const kept = token.attrs.filter(admitsAttr).map((attr) => attr.source);
      out += `<${token.name}${kept.length === 0 ? "" : ` ${kept.join(" ")}`}${token.selfClosing ? "/>" : ">"}`;
    }
  }
  return out;
}

/** Re-serializes SVG markup from one tokenizer pass, emitting only what the allowlists admit. @public */
export function sanitizeSVG(content: string): string {
  return serialize(tokenize(content));
}

const PROPAGATABLE_ATTRS = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"] as const;

type RootPresentationAttrs = Partial<Record<(typeof PROPAGATABLE_ATTRS)[number], string>>;

/** ARIA attributes whose value is a list of element ids. */
const IDREF_LIST_ATTRS = new Set([
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
]);

/** SMIL timing attributes, whose `id.event` values name another element. */
const SMIL_TIMING_ATTRS = new Set(["begin", "end"]);

/** Picks the propagating presentation attributes out of a root's attributes, the first spelling of each winning. */
function pickRootAttrs(attrs: readonly SvgAttr[]): RootPresentationAttrs {
  const picked: RootPresentationAttrs = {};
  for (const name of PROPAGATABLE_ATTRS) {
    const value = attrs.find((attr) => attr.name.toLowerCase() === name)?.value;
    if (value) picked[name] = value;
  }
  return picked;
}

/** Reads the presentation attributes on a root `<svg>` tag that propagate to its shapes. @internal */
export function extractRootAttrs(svgTag: string): RootPresentationAttrs {
  return pickRootAttrs(readAttrs(svgTag, 0).attrs);
}

/** Wraps inner markup in one `<g>` carrying the transform and the root presentation attributes, so SVG inheritance resolves nested overrides. @internal */
export function wrapRootAttrs(inner: string, rootAttrs: Partial<Record<string, string>>, transform?: string): string {
  const attrs: string[] = [];
  if (transform !== undefined) attrs.push(`transform="${transform}"`);
  for (const attr of PROPAGATABLE_ATTRS) {
    const value = rootAttrs[attr];
    if (value !== undefined) attrs.push(`${attr}="${value.replaceAll('"', "&quot;")}"`);
  }
  return attrs.length === 0 ? inner : `<g ${attrs.join(" ")}>${inner}</g>`;
}

/** The tokens after the root start tag up to its matching close, or to the end when it never closes. */
function readRootChildren(tokens: readonly SvgToken[], from: number): readonly SvgToken[] {
  let depth = 1;
  for (let i = from; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined || token.kind === "text" || token.name.toLowerCase() !== "svg") continue;
    if (token.kind === "end") depth--;
    else if (!token.selfClosing) depth++;
    if (depth === 0) return tokens.slice(from, i);
  }
  return tokens.slice(from);
}

/** The root `<svg>` start token and the tokens it encloses, or null when the tokens hold none. */
function readSvgRoot(tokens: readonly SvgToken[]): { root: SvgToken & { kind: "start" }; children: readonly SvgToken[] } | null {
  const rootAt = tokens.findIndex((token) => token.kind === "start" && token.name.toLowerCase() === "svg");
  const root = tokens[rootAt];
  if (root?.kind !== "start") return null;
  return { root, children: root.selfClosing ? [] : readRootChildren(tokens, rootAt + 1) };
}

/** Splits SVG markup into its root `<svg>` tag's attributes and the sanitized markup that root encloses, or null when it has none. @internal */
export function splitSvgRoot(content: string): { rootTag: string; inner: string } | null {
  const read = readSvgRoot(tokenize(content));
  if (read === null) return null;
  return { rootTag: read.root.attrs.map((attr) => attr.source).join(" "), inner: serialize(read.children) };
}

/** Rewrites every id the tokens declare to `${symbolId}__${id}`, along with each reference to one of them. */
function prefixIds(tokens: readonly SvgToken[], symbolId: string): SvgToken[] {
  const ids = new Set(
    tokens.flatMap((token) =>
      token.kind === "start" ? token.attrs.filter((attr) => attr.name.toLowerCase() === "id").map((attr) => attr.value) : [],
    ),
  );
  if (ids.size === 0) return [...tokens];
  const scope = (id: string): string => (ids.has(id) ? `${symbolId}__${id}` : id);

  const rewriteValue = (name: string, value: string): string => {
    if (name === "id") return scope(value);
    if (name === "href" || name === "xlink:href") return value.startsWith("#") ? `#${scope(value.slice(1))}` : value;
    if (IDREF_LIST_ATTRS.has(name)) return value.replace(/[^\s]+/g, scope);
    if (SMIL_TIMING_ATTRS.has(name))
      return value.replace(/(^|;)(\s*)([^;\s.]+)\./g, (_, lead: string, space: string, id: string) => `${lead}${space}${scope(id)}.`);
    return value.replace(/url\(\s*(["']?)#([^"')\s]+)\1\s*\)/g, (match, quote: string, id: string) =>
      ids.has(id) ? `url(${quote}#${scope(id)}${quote})` : match,
    );
  };

  return tokens.map((token) => {
    if (token.kind !== "start") return token;
    const attrs = token.attrs.map((attr) => {
      const value = rewriteValue(attr.name.toLowerCase(), attr.value);
      return value === attr.value ? attr : { name: attr.name, value, source: `${attr.name}="${value.replaceAll('"', "&quot;")}"` };
    });
    return { ...token, attrs };
  });
}

/** Converts an SVG document into a sanitized `<symbol>` with a zero-origin viewBox, or null when it has no root `<svg>`. @public */
export function svgToSymbol(svgContent: string, key: string, prefix: string): { id: string; symbol: string } | null {
  const read = readSvgRoot(tokenize(svgContent));
  if (read === null) return null;

  const id = `${prefix}${key}`;
  const [root, ...children] = prefixIds([read.root, ...read.children], id);
  const rootAttrs = root?.kind === "start" ? root.attrs : [];

  const rawViewBox = rootAttrs.find((attr) => attr.name.toLowerCase() === "viewbox" && attr.value.trim() !== "")?.value ?? "0 0 24 24";
  // `<use>` renders at (0,0), so a non-zero viewBox origin must be zeroed and translated back.
  const [minX = 0, minY = 0, w = 24, h = 24] = rawViewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const hasOffset = minX !== 0 || minY !== 0;
  const viewBox = `0 0 ${w} ${h}`;

  const inner = wrapRootAttrs(serialize(children).trim(), pickRootAttrs(rootAttrs), hasOffset ? `translate(${-minX} ${-minY})` : undefined);
  return { id, symbol: `  <symbol id="${id}" viewBox="${viewBox}">${inner}</symbol>` };
}
