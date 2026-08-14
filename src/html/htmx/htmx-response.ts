/** A flat map of `HX-*` response headers. @public */
export type HxResponseHeaders = Record<string, string>;

/** The htmx response directives `hxHeaders` can emit. @public */
export interface HxResponseProps {
  redirect?: string;
  refresh?: boolean;
  pushUrl?: string;
  replaceUrl?: string;
  trigger?: string;
  triggerAfterSettle?: string;
  triggerAfterSwap?: string;
  retarget?: string;
  reswap?: string;
}

/** Converts typed htmx response directives into an `HX-*` header map, omitting unset values. @public */
export function hxHeaders(p: HxResponseProps): HxResponseHeaders {
  const out: HxResponseHeaders = {};
  const add = (key: string, val: string | undefined) => {
    if (val !== undefined && val !== "") out[key] = val;
  };
  add("HX-Redirect", p.redirect);
  if (p.refresh === true) out["HX-Refresh"] = "true";
  add("HX-Push-Url", p.pushUrl);
  add("HX-Replace-Url", p.replaceUrl);
  add("HX-Trigger", p.trigger);
  add("HX-Trigger-After-Settle", p.triggerAfterSettle);
  add("HX-Trigger-After-Swap", p.triggerAfterSwap);
  add("HX-Retarget", p.retarget);
  add("HX-Reswap", p.reswap);
  return out;
}
