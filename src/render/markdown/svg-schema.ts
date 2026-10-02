import type { HtmlUrlCandidate } from "./types";

/** The SVG elements an svg fence may keep, in their SVG case; `a` is written through the `svgA` rule. */
export const SVG_TAGS: readonly string[] = [
  "svg",
  "g",
  "title",
  "polygon",
  "polyline",
  "path",
  "ellipse",
  "circle",
  "rect",
  "line",
  "text",
  "a",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "tspan",
  "clipPath",
  "mask",
  "marker",
  "symbol",
  "use",
  "pattern",
];

const PRESENTATION = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "transform",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "text-decoration",
  "baseline-shift",
  "opacity",
  "clip-path",
  "clip-rule",
  "fill-rule",
  "mask",
  "marker-start",
  "marker-mid",
  "marker-end",
  "dominant-baseline",
];

const GEOMETRY = ["x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "points", "d", "viewBox"];

const SVG_SHAPE_ATTRIBUTES = [...PRESENTATION, ...GEOMETRY];

/** The attributes each SVG element may keep after an svg fence is sanitised, beside `id`. */
export const SVG_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(SVG_TAGS.map((tag) => [tag, SVG_SHAPE_ATTRIBUTES])),
  svg: [...SVG_SHAPE_ATTRIBUTES, "role", "aria-label", "preserveAspectRatio"],
  a: [...SVG_SHAPE_ATTRIBUTES, "href", "xlink:href", "xlink:title", "target", "rel"],
  linearGradient: [...SVG_SHAPE_ATTRIBUTES, "gradientUnits", "gradientTransform"],
  radialGradient: [...SVG_SHAPE_ATTRIBUTES, "gradientUnits", "gradientTransform", "fx", "fy"],
  stop: [...SVG_SHAPE_ATTRIBUTES, "offset", "stop-color", "stop-opacity"],
  text: [...SVG_SHAPE_ATTRIBUTES, "dx", "dy"],
  tspan: [...SVG_SHAPE_ATTRIBUTES, "dx", "dy", "rotate", "textLength", "lengthAdjust"],
  clipPath: [...SVG_SHAPE_ATTRIBUTES, "clipPathUnits"],
  mask: [...SVG_SHAPE_ATTRIBUTES, "maskUnits", "maskContentUnits"],
  marker: [...SVG_SHAPE_ATTRIBUTES, "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits"],
  symbol: [...SVG_SHAPE_ATTRIBUTES, "refX", "refY", "preserveAspectRatio"],
  pattern: [...SVG_SHAPE_ATTRIBUTES, "patternUnits", "patternContentUnits", "patternTransform", "href", "xlink:href"],
  use: [...SVG_SHAPE_ATTRIBUTES, "href", "xlink:href"],
};

const LINK_PROTOCOLS: readonly string[] = ["https", "mailto"];
const URL_PROTOCOLS: Readonly<Record<string, readonly string[]>> = { href: LINK_PROTOCOLS, "xlink:href": LINK_PROTOCOLS, src: ["https"] };
const URL_TAB_OR_NEWLINE = /[\t\n\r]/g;
const PROTOCOL_RELATIVE = /^[\\/]{2}/;
const URL_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

function trimControls(url: string): string {
  const units = url.replace(URL_TAB_OR_NEWLINE, "");
  let start = 0;
  let end = units.length;
  while (start < end && units.charCodeAt(start) <= 0x20) start++;
  while (end > start && units.charCodeAt(end - 1) <= 0x20) end--;
  return units.slice(start, end);
}

function hasListedProtocol(url: string, protocols: readonly string[]): boolean {
  const colon = url.indexOf(":");
  const blockers = ["?", "#", "/"].map((char) => url.indexOf(char)).filter((at) => at > -1);
  if (colon < 0 || blockers.some((at) => colon > at)) return true;
  return protocols.some((protocol) => colon === protocol.length && url.startsWith(protocol));
}

/** Reports whether a URL may stay on an attribute: relative, or https (and mailto for a link), never protocol-relative or hidden behind controls. */
export function isSafeUrl({ value, attribute }: Pick<HtmlUrlCandidate, "value" | "attribute">): boolean {
  const protocols = URL_PROTOCOLS[attribute] ?? [];
  if (!hasListedProtocol(value, protocols)) return false;
  const normalised = trimControls(value);
  if (PROTOCOL_RELATIVE.test(normalised)) return false;
  const scheme = URL_SCHEME.exec(normalised)?.[1];
  return scheme === undefined || protocols.includes(scheme.toLowerCase());
}
