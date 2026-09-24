import { SCOPE_EVENTS } from "./scope-events";
import type { ScopeAttrsProps } from "./types";

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
