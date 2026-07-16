export type HxAttrs = Record<string, string>;

export interface HxAttrsProps {
  get?: string;
  post?: string;
  put?: string;
  patch?: string;
  delete?: string;
  target?: string;
  swap?: string;
  select?: string;
  selectOob?: string;
  trigger?: string;
  include?: string;
  indicator?: string;
  disabledElt?: string;
  sync?: string;
  confirm?: string;
  encoding?: string;
  pushUrl?: string;
  replaceUrl?: string;
  params?: string;
  values?: Record<string, string>;
  headers?: Record<string, string>;
  boost?: boolean;
}

function encodeMap(m: Record<string, string>): string | undefined {
  if (Object.keys(m).length === 0) return undefined;
  return JSON.stringify(m);
}

/**
 * Converts a typed `HxAttrsProps` object into a flat `hx-*` attribute map for spreading onto JSX
 * elements. Undefined and empty-string values are omitted.
 *
 * @remarks
 * Selector- and JSON-valued props — `target`, `select`, `selectOob`, `include`, `trigger`,
 * `values` (→ `hx-vals`) and `headers` (→ `hx-headers`) — are emitted **verbatim**. They must be
 * TRUSTED, developer-supplied values, never raw user input: htmx interprets them client-side as
 * CSS selectors, trigger expressions, and JSON, so an attacker-controlled value can retarget
 * swaps, exfiltrate form fields via `hx-include`, or inject request headers. Escaping does not
 * help — these are behavioral directives, not display text.
 *
 * @public
 */
export function hxAttrs(p: HxAttrsProps): HxAttrs {
  const out: HxAttrs = {};
  const add = (key: string, val: string | undefined) => {
    if (val !== undefined && val !== "") out[key] = val;
  };
  add("hx-get", p.get);
  add("hx-post", p.post);
  add("hx-put", p.put);
  add("hx-patch", p.patch);
  add("hx-delete", p.delete);
  add("hx-target", p.target);
  add("hx-swap", p.swap);
  add("hx-select", p.select);
  add("hx-select-oob", p.selectOob);
  add("hx-trigger", p.trigger);
  add("hx-include", p.include);
  add("hx-indicator", p.indicator);
  add("hx-disabled-elt", p.disabledElt);
  add("hx-sync", p.sync);
  add("hx-confirm", p.confirm);
  add("hx-encoding", p.encoding);
  add("hx-push-url", p.pushUrl);
  add("hx-replace-url", p.replaceUrl);
  add("hx-params", p.params);
  if (p.values !== undefined) {
    const encoded = encodeMap(p.values);
    if (encoded !== undefined) out["hx-vals"] = encoded;
  }
  if (p.headers !== undefined) {
    const encoded = encodeMap(p.headers);
    if (encoded !== undefined) out["hx-headers"] = encoded;
  }
  if (p.boost !== undefined) {
    out["hx-boost"] = String(p.boost);
  }
  return out;
}
