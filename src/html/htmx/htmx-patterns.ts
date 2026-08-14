import type { HxAttrs } from "./htmx-attrs";
import { hxAttrs } from "./htmx-attrs";

/** Named `hx-swap` strategy constants (`innerHTML`, `outerHTML`, `beforeend`, …). @public */
export const SWAP = {
  innerHtml: "innerHTML",
  outerHtml: "outerHTML",
  beforeEnd: "beforeend",
  afterEnd: "afterend",
  beforeBegin: "beforebegin",
  delete: "delete",
  none: "none",
} as const;

/** Placeholder origin a relative target is parsed against. */
const RELATIVE_BASE = "http://localhost";

/** Parses `path`, reporting whether it carried a scheme and host of its own. */
function parseTarget(path: string): { url: URL; absolute: boolean } | null {
  try {
    return { url: new URL(path), absolute: true };
  } catch {
    // No scheme — reparsed as relative below.
  }
  try {
    return { url: new URL(path, RELATIVE_BASE), absolute: false };
  } catch {
    return null;
  }
}

function withQueryParam(path: string, key: string, value: string, extras?: Record<string, string>): string {
  const target = parseTarget(path);
  if (!target) return path;
  const { url, absolute } = target;
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      url.searchParams.set(k, v);
    }
  }
  url.searchParams.set(key, value);
  // Returning `pathname + search` for an absolute endpoint would silently repoint it at the page's own origin.
  return absolute ? url.href : url.pathname + url.search;
}

interface LiveSearchProps {
  get: string;
  target: string;
  swap?: string;
  trigger?: string;
  pushUrl?: string;
}

/** Builds `hx-*` attributes for a debounced live-search input. @public */
export function liveSearch(p: LiveSearchProps): HxAttrs {
  return hxAttrs({
    get: p.get,
    target: p.target,
    swap: p.swap ?? SWAP.innerHtml,
    trigger: p.trigger ?? "input changed delay:300ms, search",
    ...(p.pushUrl !== undefined ? { pushUrl: p.pushUrl } : {}),
  });
}

interface InlineValidationProps {
  get: string;
  target: string;
  swap?: string;
  trigger?: string;
  sync?: string;
}

/** Builds `hx-*` attributes for inline field validation on change/blur. @public */
export function inlineValidation(p: InlineValidationProps): HxAttrs {
  return hxAttrs({
    get: p.get,
    target: p.target,
    swap: p.swap ?? SWAP.outerHtml,
    trigger: p.trigger ?? "change delay:200ms, blur",
    sync: p.sync ?? "this:abort",
  });
}

interface PaginatedTableProps {
  get: string;
  target: string;
  page: number;
  pageParam?: string;
  query?: Record<string, string>;
  swap?: string;
}

/** Builds `hx-*` attributes for a pagination link, appending `?page=N` and preserving existing query. @public */
export function paginatedTableLink(p: PaginatedTableProps): HxAttrs {
  const pageParam = p.pageParam ?? "page";
  const url = withQueryParam(p.get, pageParam, String(p.page), p.query);
  return hxAttrs({ get: url, target: p.target, swap: p.swap ?? SWAP.outerHtml });
}

interface AsyncDialogTriggerProps {
  get: string;
  target: string;
  dialogId: string;
  swap?: string;
}

/** Builds `hx-*` plus `data-dialog-open`/ARIA attributes for a trigger that loads dialog content. @public */
export function asyncDialogTrigger(p: AsyncDialogTriggerProps): HxAttrs {
  return {
    ...hxAttrs({ get: p.get, target: p.target, swap: p.swap ?? SWAP.innerHtml }),
    "data-dialog-open": p.dialogId,
    "aria-haspopup": "dialog",
    "aria-controls": p.dialogId,
  };
}

interface DependentSelectProps {
  get: string;
  target: string;
  swap?: string;
  trigger?: string;
}

/** Builds `hx-*` attributes for a dependent `<select>` that reloads on change. @public */
export function dependentSelect(p: DependentSelectProps): HxAttrs {
  return hxAttrs({ get: p.get, target: p.target, swap: p.swap ?? SWAP.outerHtml, trigger: p.trigger ?? "change" });
}

interface InfiniteScrollProps {
  get: string;
  target: string;
  swap?: string;
  select?: string;
}

/** Builds `hx-*` attributes for reveal-triggered infinite scroll. @public */
export function infiniteScroll(p: InfiniteScrollProps): HxAttrs {
  return hxAttrs({
    get: p.get,
    target: p.target,
    swap: p.swap ?? SWAP.beforeEnd,
    trigger: "revealed",
    ...(p.select !== undefined ? { select: p.select } : {}),
  });
}

interface FormSubmitProps {
  post: string;
  target: string;
  swap?: string;
  disabledElt?: string;
  encoding?: string;
  pushUrl?: string;
}

/** Builds `hx-*` attributes for an HTMX form submission that disables its trigger while inflight. @public */
export function formSubmit(p: FormSubmitProps): HxAttrs {
  return hxAttrs({
    post: p.post,
    target: p.target,
    swap: p.swap ?? SWAP.outerHtml,
    disabledElt: p.disabledElt ?? "this",
    ...(p.encoding !== undefined ? { encoding: p.encoding } : {}),
    ...(p.pushUrl !== undefined ? { pushUrl: p.pushUrl } : {}),
  });
}

interface OobSwapProps {
  strategy?: string;
  selector?: string;
}

/** Builds an `hx-swap-oob` attribute for an out-of-band swap, optionally scoped to a CSS selector. @public */
export function oobSwap(p: OobSwapProps): HxAttrs {
  let value = p.strategy ?? "true";
  if (p.selector) {
    if (value === "true") value = "outerHTML";
    value = `${value}:${p.selector}`;
  }
  return { "hx-swap-oob": value };
}

/** Builds an `hx-swap-oob` attribute that appends to the selector's target. @public */
export function oobAppend(selector: string): HxAttrs {
  return oobSwap({ strategy: "beforeend", selector });
}
