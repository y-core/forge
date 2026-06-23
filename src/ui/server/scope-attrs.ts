import { SCOPE_EVENTS, type ScopeEvent } from "../scope-events";

/** Typed `data-on-<event>` props for a `Resumable` scope. Each optional `on<Event>` key carries an
 * action name from the union `A` — the same vocabulary the client feeds `registerScope<A>` — so a
 * typo is a compile error and client + server share one action namespace. `scopeAttrs` owns only
 * `data-on-*`; for the generic field-binding attribute (`data-field`) pair it with `fieldAttr`, or
 * stamp fully app-specific metadata attributes directly. @public */
export type ScopeAttrsProps<A extends string = string> = {
  [E in ScopeEvent as `on${Capitalize<E>}`]?: A;
};

/** Build typed `data-on-<event>` delegation attributes for a `Resumable` scope. Spread the result
 * onto an SSR element: `<button {...scopeAttrs<ChromeAction>({ onClick: "selectTool" })} />`. Empty
 * or undefined entries are omitted. @public */
export function scopeAttrs<A extends string = string>(p: ScopeAttrsProps<A>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const event of SCOPE_EVENTS) {
    const key = `on${event.charAt(0).toUpperCase()}${event.slice(1)}` as keyof ScopeAttrsProps<A>;
    const value = p[key];
    if (value !== undefined && value !== "") out[`data-on-${event}`] = value as string;
  }
  return out;
}
