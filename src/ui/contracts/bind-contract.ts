/** Names an element's text content as a view of one signal in the enclosing scope. @public */
export const BIND_TEXT_ATTR = "data-bind-text";

/** Names one attribute as a view of one signal, spelled `attribute:field`. @public */
export const BIND_ATTR_ATTR = "data-bind-attr";

/** Attributes whose bound value is a URL, mirroring the JSX renderer's `URL_ATTRS`. @public */
export const URL_BOUND_ATTRS: ReadonlySet<string> = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "cite",
  "background",
  "data",
  "xlink:href",
  "xml:base",
]);

/** URL schemes a bound value may carry. Everything else collapses to `"#"`. */
const SAFE_BOUND_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

// A copy of `safeUrl` (`src/http/escape.ts`), not an import: `ui/contracts` is a declared leaf with
// no edge to `http`, so the rule crosses the boundary as duplication pinned equal by a shared table.
// oxlint-disable-next-line eslint/no-control-regex -- deliberately matching C0/C1 control chars, which browsers ignore when resolving a scheme
const BOUND_URL_NOISE = /[\u0000-\u0020\u007f-\u009f]/g;

/** Whether an attribute may never be driven by a signal: a handler name, bare or any `hx-on` spelling, plus `srcdoc` and `style`. @public */
export function isBindAttrRefused(attribute: string): boolean {
  const lower = attribute.toLowerCase();
  // htmx compiles all four spellings of its handler attribute, the dash form existing for templating
  // where a colon cannot appear, so the `data-` prefix is stripped before the name is tested.
  const unprefixed = lower.startsWith("data-") ? lower.slice("data-".length) : lower;
  // `hx-on` is refused although `docs/HTMX.md` §7b ratifies it in the renderer: that ratification
  // is about source a developer typed, and here the signal supplies the body htmx would execute.
  const isHxOn = unprefixed.startsWith("hx-on:") || unprefixed.startsWith("hx-on-");
  return lower.startsWith("on") || isHxOn || lower === "srcdoc" || lower === "style";
}

/** A bound value with any scheme outside http/https/mailto/tel collapsed to `"#"`. @public */
export function safeBindAttrValue(attribute: string, value: string): string {
  if (!URL_BOUND_ATTRS.has(attribute.toLowerCase())) return value;
  const normalized = value.replace(BOUND_URL_NOISE, "").toLowerCase();
  if (/^[/\\]{2}/.test(normalized)) return "#";
  const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/);
  if (!scheme) return value;
  return SAFE_BOUND_SCHEMES.has(`${scheme[1]}:`) ? value : "#";
}

/** Builds the `data-bind-text` attribute for an SSR element, to be spread onto it. @public */
export function bindTextAttr(field: string): Record<string, string> {
  return { [BIND_TEXT_ATTR]: field };
}

/** Builds the `data-bind-attr` attribute pairing one attribute name with one signal field. @public */
export function bindAttrAttr(attribute: string, field: string): Record<string, string> {
  if (isBindAttrRefused(attribute)) {
    throw new Error(`[${BIND_ATTR_ATTR}] "${attribute}" may not be bound to a signal`);
  }
  return { [BIND_ATTR_ATTR]: `${attribute}:${field}` };
}

/** Splits a `data-bind-attr` value into its attribute name and its field, or `null` when malformed. @public */
export function parseBindAttr(value: string): { attribute: string; field: string } | null {
  // The *last* colon, because a signal field is an identifier and never contains one, while an
  // attribute may — `xlink:href:target` is the attribute `xlink:href` bound to the field `target`.
  const at = value.lastIndexOf(":");
  if (at <= 0 || at === value.length - 1) return null;
  return { attribute: value.slice(0, at), field: value.slice(at + 1) };
}
