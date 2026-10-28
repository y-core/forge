import { ownerDocument, ownerWindow } from "./dom";
import type { ViewportCollapseOptions } from "./types";

/** Below Tailwind's `md` breakpoint (`48rem`), in `rem` so no width leaves both queries unmatched. @internal */
export const MD_DOWN_QUERY =
  "(max-width: 47.99rem)"; /* modern-css-allow: forge-ui-platform-container-query — the controllers on this query toggle a disclosure's `open` state and arm a focus trap and a scroll lock, which are DOM state and behaviour rather than style, and `@container` can only drive style; the decision is a page-chrome one taken against the viewport by design. */

/** Resolves the disclosure a viewport controller mounts on, throwing a message that names `owner` when nothing with an `open` property resolves. @internal */
export function resolveDisclosure(
  owner: string,
  { element, selector, within }: Pick<ViewportCollapseOptions, "element" | "selector" | "within">,
): HTMLDetailsElement {
  const found = element ?? (selector ? ownerDocument(within).querySelector(selector) : null);
  const el = found as HTMLDetailsElement | null;
  // Duck-typed rather than `instanceof HTMLDetailsElement`, which is false for an element from
  // another realm and rejects a disclosure a consumer implemented some other way.
  if (el && typeof el.open === "boolean") return el;
  const named = element !== undefined ? "the given `element`" : `\`${selector ?? "(none)"}\``;
  throw new Error(`${owner}: ${named} did not resolve to a disclosure with an \`open\` property`);
}

/** Opens `query` in the disclosure's realm, or warns under `tag` and returns `null` where that realm cannot track it. @internal */
export function trackViewport(tag: string, el: Element, query: string): MediaQueryList | null {
  const win = ownerWindow(el);
  if (typeof win.matchMedia !== "function") {
    console.warn(`[${tag}] matchMedia is unavailable in this realm; the disclosure will not track the viewport`);
    return null;
  }
  const list = win.matchMedia(query);
  if (typeof list.addEventListener !== "function") {
    console.warn(`[${tag}] this realm's MediaQueryList has no addEventListener; the disclosure will not track the viewport`);
    return null;
  }
  return list;
}
