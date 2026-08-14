import { SCOPE_EVENTS, type ScopeEvent } from "./scope-events";

/** Typed `data-on-<event>` props for a `Resumable` scope, keyed by action name from `A`. @public */
export type ScopeAttrsProps<A extends string = string> = {
  [E in ScopeEvent as `on${Capitalize<E>}`]?: A;
};

/** Builds typed `data-on-<event>` delegation attributes for a `Resumable` scope. @public */
export function scopeAttrs<A extends string = string>(p: ScopeAttrsProps<A>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const event of SCOPE_EVENTS) {
    const key = `on${event.charAt(0).toUpperCase()}${event.slice(1)}` as keyof ScopeAttrsProps<A>;
    const value = p[key];
    if (value !== undefined && value !== "") out[`data-on-${event}`] = value as string;
  }
  return out;
}
