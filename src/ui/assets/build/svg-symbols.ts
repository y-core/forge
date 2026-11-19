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

/** Characters XML 1.0 forbids: C0 controls other than tab, LF and CR, U+FFFE, U+FFFF, and a surrogate half without its partner. */
// oxlint-disable-next-line eslint/no-control-regex -- deliberately matching C0 control chars
const XML_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Named references this decoder knows, spelled as HTML spells them; a name is matched case-sensitively and only with its `;`. */
const NAMED_REFS = new Map([
  ["AMP", "&"],
  ["GT", ">"],
  ["LT", "<"],
  ["NewLine", "\n"],
  ["QUOT", '"'],
  ["Tab", "\t"],
  ["amp", "&"],
  ["apos", "'"],
  ["colon", ":"],
  ["gt", ">"],
  ["lt", "<"],
  ["quot", '"'],
]);

/** A numeric reference, whose `;` the HTML parser does not require, or a named one with or without its `;`. */
const CHAR_REF = /&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|([A-Za-z][A-Za-z0-9]*)(;?))/g;

/** The character one reference stands for, or null when the decoder does not know it. */
function decodeCharRef(
  hex: string | undefined,
  decimal: string | undefined,
  name: string | undefined,
  semicolon: string | undefined,
): string | null {
  if (name !== undefined) return semicolon === ";" ? (NAMED_REFS.get(name) ?? null) : null;
  const code = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(decimal ?? "", 10);
  return code <= 0x10ffff ? String.fromCodePoint(code) : null;
}

/** Decodes an attribute value in one pass, or null when it holds a reference the decoder does not know or a character XML forbids. */
function decodeAttrValue(value: string): string | null {
  let known = true;
  const decoded = value.replace(CHAR_REF, (match, hex?: string, decimal?: string, name?: string, semicolon?: string) => {
    const char = decodeCharRef(hex, decimal, name, semicolon);
    if (char === null) known = false;
    return char ?? match;
  });
  return known && !XML_FORBIDDEN.test(decoded) ? decoded : null;
}

/** Decodes text in one pass, leaving a reference the decoder does not know as literal text and removing every character XML forbids. */
function decodeSvgText(text: string): string {
  const decoded = text.replace(
    CHAR_REF,
    (match, hex?: string, decimal?: string, name?: string, semicolon?: string) => decodeCharRef(hex, decimal, name, semicolon) ?? match,
  );
  return decoded.replace(new RegExp(XML_FORBIDDEN.source, "g"), "");
}

/** The scheme a browser would resolve a decoded attribute value to, with the characters it ignores removed. */
function resolvedScheme(value: string): string {
  return value.replace(URL_NOISE, "").toLowerCase();
}

/** The graphics elements kept, by lowercased name; every other element is dropped with everything it contains. */
const SVG_ELEMENTS = new Set([
  "circle",
  "clippath",
  "defs",
  "desc",
  "ellipse",
  "feblend",
  "fecolormatrix",
  "fecomponenttransfer",
  "fecomposite",
  "feconvolvematrix",
  "fediffuselighting",
  "fedisplacementmap",
  "fedistantlight",
  "fedropshadow",
  "feflood",
  "fefunca",
  "fefuncb",
  "fefuncg",
  "fefuncr",
  "fegaussianblur",
  "feimage",
  "femerge",
  "femergenode",
  "femorphology",
  "feoffset",
  "fepointlight",
  "fespecularlighting",
  "fespotlight",
  "fetile",
  "feturbulence",
  "filter",
  "g",
  "lineargradient",
  "line",
  "marker",
  "mask",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialgradient",
  "rect",
  "stop",
  "svg",
  "symbol",
  "text",
  "title",
  "tspan",
  "use",
]);

/** Elements whose content is raw text, so no element can nest inside them. */
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

/** Elements kept with their text alone; an element inside one is dropped, so no nested `title` can open an HTML raw-text run. */
const TEXT_ONLY_ELEMENTS = new Set(["desc", "title"]);

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
const URL_VALUED_ATTRS = new Set(["action", "data", "formaction", "poster", "src"]);

/** Attributes that reference another element, kept only when the reference stays inside the document. */
const REFERENCE_ATTRS = new Set(["href", "xlink:href"]);

/** The only namespace-prefixed attributes kept; any other prefix can rebind a name to a meaning the allowlists never saw. */
const PREFIXED_ATTRS = new Set(["xlink:href", "xml:lang", "xml:space"]);

/** The namespace declarations the root may keep, each only when bound to the namespace its name implies. */
const ROOT_NAMESPACES = new Map([
  ["xmlns", "http://www.w3.org/2000/svg"],
  ["xmlns:xlink", "http://www.w3.org/1999/xlink"],
]);

/** A CSS `url()` whose argument, past whitespace and an opening quote, is anything but a `#` fragment. */
const EXTERNAL_CSS_URL = /url\((?!\s*["']?#)/;

/** CSS functions that fetch a bare string as `url()` fetches its argument. */
const CSS_FETCHING_FUNCTION = /(?:image-set|image|src)\(/;

/** An event handler is spelled `on` plus letters and nothing else, which is what keeps `only-child` out. */
const HANDLER_ATTR = /^on[a-z]+$/i;

/** A tag name the serializer may re-emit; the tokenizer accepts `<` in one, and emitting that reopens a tag. */
const TAG_NAME = /^[A-Za-z][A-Za-z0-9:_.-]*$/;

/** An attribute name the serializer may re-emit. */
const ATTR_NAME = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;

/** One attribute as the tokenizer read it, its value already decoded. */
interface SvgAttr {
  name: string;
  value: string;
}

/** Every construct the sanitizer understands; anything else in the source is dropped rather than re-emitted. */
type SvgToken =
  | { kind: "text"; text: string }
  | { kind: "start"; name: string; attrs: readonly SvgAttr[]; selfClosing: boolean; duplicated: boolean }
  | { kind: "end"; name: string };

/** Reads one tag's attributes from `start`, with the index just past the tag that closed them; a value the decoder cannot read is left out. */
function readAttrs(markup: string, start: number): { attrs: SvgAttr[]; duplicated: boolean; selfClosing: boolean; next: number } {
  const attrs: SvgAttr[] = [];
  const names: string[] = [];
  const add = (name: string, raw: string): void => {
    names.push(name.toLowerCase());
    const value = decodeAttrValue(raw);
    if (value !== null) attrs.push({ name, value });
  };
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
      add(name, "");
      continue;
    }
    p++;
    while (/\s/.test(markup.charAt(p))) p++;
    const quote = markup.charAt(p);
    if (quote === '"' || quote === "'") {
      const end = markup.indexOf(quote, p + 1);
      add(name, markup.slice(p + 1, end === -1 ? markup.length : end));
      p = end === -1 ? markup.length : end + 1;
      continue;
    }
    const valueStart = p;
    while (p < markup.length && !/[\s>]/.test(markup.charAt(p))) p++;
    add(name, markup.slice(valueStart, p));
  }
  return { attrs, duplicated: new Set(names).size !== names.length, selfClosing, next: p };
}

/** The index just past a raw-text element's closing tag, or `null` when the markup carries none. */
function skipRawText(markup: string, from: number, name: string): number | null {
  const close = new RegExp(`</${name}(?=[\\s/>]|$)`, "gi");
  close.lastIndex = from;
  const match = close.exec(markup);
  if (match === null) return null;
  const gt = markup.indexOf(">", close.lastIndex);
  return gt === -1 ? markup.length : gt + 1;
}

/** Whether a SMIL element names an attribute that is safe to animate. */
function retargetsSafely(attrs: readonly SvgAttr[]): boolean {
  const target = attrs.find((attr) => attr.name.toLowerCase() === "attributename");
  return target !== undefined && ANIMATABLE_ATTRS.has(target.value.trim().toLowerCase());
}

/** Reads markup into tokens, dropping comments, declarations and raw-text elements with their content. */
function lexSvg(markup: string): SvgToken[] {
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
    if (RAW_TEXT_ELEMENTS.has(lower)) {
      // An unterminated raw-text element swallows the rest of the file as text, so that text goes with it.
      if (!read.selfClosing) i = skipRawText(markup, i, lower) ?? markup.length;
      continue;
    }
    tokens.push({ kind: "start", name, attrs: read.attrs, selfClosing: read.selfClosing, duplicated: read.duplicated });
  }
  return tokens;
}

/** A stack of open elements that finds the innermost one of a name, and pops back to it, at a cost of the pops alone. */
interface ElementStack {
  readonly size: number;
  readonly insideTextOnly: boolean;
  push(name: string): void;
  depthOf(name: string): number;
  popTo(depth: number): string[];
}

/** Creates an empty element stack. */
function createElementStack(): ElementStack {
  const names: string[] = [];
  const depths = new Map<string, number[]>();
  let textOnly = 0;
  return {
    get size() {
      return names.length;
    },
    get insideTextOnly() {
      return textOnly > 0;
    },
    push(name) {
      const lower = name.toLowerCase();
      const at = depths.get(lower);
      if (at === undefined) depths.set(lower, [names.length]);
      else at.push(names.length);
      if (TEXT_ONLY_ELEMENTS.has(lower)) textOnly++;
      names.push(name);
    },
    depthOf(name) {
      return depths.get(name.toLowerCase())?.at(-1) ?? -1;
    },
    popTo(depth) {
      const popped = names.splice(depth).reverse();
      for (const name of popped) {
        const lower = name.toLowerCase();
        depths.get(lower)?.pop();
        if (TEXT_ONLY_ELEMENTS.has(lower)) textOnly--;
      }
      return popped;
    },
  };
}

/** Whether a start tag may be kept, given whether a `title` or `desc` is open around it. */
function admitsElement(token: SvgToken & { kind: "start" }, insideTextOnly: boolean): boolean {
  if (token.duplicated || insideTextOnly) return false;
  const name = token.name.toLowerCase();
  return SVG_ELEMENTS.has(name) || (RETARGETING_ELEMENTS.has(name) && retargetsSafely(token.attrs));
}

/** Keeps what the allowlists admit, balanced: a dropped element goes with everything up to its own close or its parent's, each close names its start tag, and the first kept tag is the root. */
function admitTokens(tokens: readonly SvgToken[]): SvgToken[] {
  const kept: SvgToken[] = [];
  const open = createElementStack();
  const dropping = createElementStack();
  const closeTo = (depth: number): void => {
    for (const name of open.popTo(depth)) kept.push({ kind: "end", name });
  };
  let started = false;
  for (const token of tokens) {
    if (dropping.size > 0) {
      if (token.kind === "text") continue;
      if (token.kind === "start") {
        if (!token.selfClosing) dropping.push(token.name);
        continue;
      }
      const at = dropping.depthOf(token.name);
      if (at !== -1) {
        dropping.popTo(at);
        continue;
      }
      if (open.depthOf(token.name) === -1) continue;
      dropping.popTo(0);
    }
    if (token.kind === "text") {
      kept.push(token);
      continue;
    }
    if (token.kind === "end") {
      const at = open.depthOf(token.name);
      if (at !== -1) closeTo(at);
      continue;
    }
    if (!admitsElement(token, open.insideTextOnly)) {
      if (!token.selfClosing) dropping.push(token.name);
      continue;
    }
    const atRoot = !started && token.name.toLowerCase() === "svg";
    started = true;
    kept.push({ ...token, attrs: token.attrs.filter((attr) => admitsAttr(attr, atRoot)) });
    if (!token.selfClosing) open.push(token.name);
  }
  closeTo(0);
  return kept;
}

/** Reads markup into the tokens the sanitizer keeps. */
function tokenize(markup: string): SvgToken[] {
  return admitTokens(lexSvg(markup));
}

/** Whether a reference resolves to a `#` fragment of this document. */
function isLocalReference(value: string): boolean {
  return value.replace(/^[\t\n\f\r ]+/, "").startsWith("#");
}

/** Whether an attribute value, read as CSS, can fetch anything from outside the document. */
function fetchesExternally(value: string): boolean {
  const css = value.toLowerCase();
  // A CSS escape can spell `url(` in any number of ways, so any escape at all fails closed.
  return css.includes("\\") || EXTERNAL_CSS_URL.test(css) || CSS_FETCHING_FUNCTION.test(css);
}

/** Whether one attribute may be re-emitted: a valid name, no handler, no prefix beyond the few kept, and no reference that leaves the document. */
function admitsAttr(attr: SvgAttr, atRoot: boolean): boolean {
  if (!ATTR_NAME.test(attr.name) || HANDLER_ATTR.test(attr.name)) return false;
  const name = attr.name.toLowerCase();
  if (name === "xmlns" || name.startsWith("xmlns:")) return atRoot && ROOT_NAMESPACES.get(name) === attr.value;
  if (name.includes(":") && !PREFIXED_ATTRS.has(name)) return false;
  if (REFERENCE_ATTRS.has(name)) return isLocalReference(attr.value);
  if (fetchesExternally(attr.value)) return false;
  if (!URL_VALUED_ATTRS.has(name)) return true;
  const scheme = resolvedScheme(attr.value);
  return !scheme.startsWith("javascript:") && !scheme.startsWith("data:text/html");
}

/** Escapes decoded text so none of it reads as markup or as a reference. */
function escapeSvgText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Writes one decoded attribute double-quoted, so no `<`, `>` or quote in its value reads as markup. */
function serializeAttr(name: string, value: string): string {
  return `${name}="${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")}"`;
}

/** Writes the tokens back out. */
function serialize(tokens: readonly SvgToken[]): string {
  let out = "";
  for (const token of tokens) {
    if (token.kind === "text") {
      out += escapeSvgText(decodeSvgText(token.text));
    } else if (token.kind === "end") {
      out += `</${token.name}>`;
    } else {
      const attrs = token.attrs.map((attr) => ` ${serializeAttr(attr.name, attr.value)}`).join("");
      out += `<${token.name}${attrs}${token.selfClosing ? "/>" : ">"}`;
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
    if (value !== undefined) attrs.push(serializeAttr(attr, value));
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
  return { rootTag: read.root.attrs.map((attr) => serializeAttr(attr.name, attr.value)).join(" "), inner: serialize(read.children) };
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
      return { name: attr.name, value };
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
