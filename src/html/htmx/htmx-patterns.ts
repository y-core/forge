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

/** Placeholder origin a relative target is parsed against; stripped back off on the way out. */
const RELATIVE_BASE = "http://localhost";

/** Parses `path`, reporting whether it carried a scheme and host of its own. */
function parseTarget(path: string): { url: URL; absolute: boolean } | null {
  try {
    return { url: new URL(path), absolute: true };
  } catch {
    // No scheme — fall through and parse it as relative instead.
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
  // An absolute endpoint keeps its scheme and host; returning `pathname + search` for one would
  // silently repoint the request at the page's own origin. A relative one stays relative, so the
  // placeholder origin never reaches the emitted attribute.
  return absolute ? url.href : url.pathname + url.search;
}

interface LiveSearchProps {
  get: string;
  target: string;
  swap?: string;
  trigger?: string;
  pushUrl?: string;
}

/**
 * Builds `hx-*` attributes for a debounced live-search input (`get` + `target`, debounced
 * `trigger`).
 *
 * @remarks
 * The `get`, `target`, and `trigger` values are forwarded verbatim to {@link hxAttrs} and must be
 * TRUSTED, developer-supplied — never raw user input. See {@link hxAttrs} for the full trust
 * rationale.
 *
 * @public
 */
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

/**
 * Builds `hx-*` attributes for inline field validation on change/blur.
 *
 * @remarks
 * `target`, `trigger`, and `sync` selectors are forwarded verbatim to {@link hxAttrs} and must be
 * TRUSTED, developer-supplied — never raw user input. See {@link hxAttrs}.
 *
 * `sync` defaults to `"this:abort"`, which resolves on any field whether or not it sits inside a
 * `<form>`; a caller inside one that wants in-flight requests from sibling fields aborted passes
 * `sync: "closest form:abort"` explicitly.
 *
 * @public
 */
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

/**
 * Builds `hx-*` attributes for a pagination link, appending `?page=N` (preserving existing query).
 *
 * @remarks
 * The `target` selector is forwarded verbatim to {@link hxAttrs} and must be TRUSTED,
 * developer-supplied — never raw user input. See {@link hxAttrs}.
 *
 * @public
 */
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

/**
 * Builds `hx-*` plus `data-dialog-open`/ARIA attributes for a trigger that loads dialog content.
 *
 * @remarks
 * The `target` selector is forwarded verbatim to {@link hxAttrs} and must be TRUSTED,
 * developer-supplied — never raw user input. See {@link hxAttrs}.
 *
 * @public
 */
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

/**
 * Builds `hx-*` attributes for a dependent `<select>` that reloads on change.
 *
 * @remarks
 * The `target` and `trigger` selectors are forwarded verbatim to {@link hxAttrs} and must be
 * TRUSTED, developer-supplied — never raw user input. See {@link hxAttrs}.
 *
 * @public
 */
export function dependentSelect(p: DependentSelectProps): HxAttrs {
  return hxAttrs({ get: p.get, target: p.target, swap: p.swap ?? SWAP.outerHtml, trigger: p.trigger ?? "change" });
}

interface InfiniteScrollProps {
  get: string;
  target: string;
  swap?: string;
  select?: string;
}

/**
 * Builds `hx-*` attributes for reveal-triggered infinite scroll (append-based).
 *
 * @remarks
 * The `target` and `select` selectors are forwarded verbatim to {@link hxAttrs} and must be
 * TRUSTED, developer-supplied — never raw user input. See {@link hxAttrs}.
 *
 * @public
 */
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

/**
 * Builds `hx-*` attributes for an HTMX form submission (`post` + `target`, disables while inflight).
 *
 * @remarks
 * The `target` and `disabledElt` selectors are forwarded verbatim to {@link hxAttrs} and must be
 * TRUSTED, developer-supplied — never raw user input. See {@link hxAttrs}.
 *
 * @public
 */
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

/**
 * Builds an `hx-swap-oob` attribute for an out-of-band swap, optionally scoped to a CSS selector.
 *
 * @remarks
 * The `selector` becomes part of the `hx-swap-oob` value (`strategy:selector`) and is emitted
 * verbatim. It must be a TRUSTED, developer-supplied selector, never raw user input — htmx uses it
 * client-side to pick the swap target, so an attacker-controlled value can overwrite arbitrary
 * DOM. See {@link hxAttrs} for the broader trust rationale.
 *
 * @public
 */
export function oobSwap(p: OobSwapProps): HxAttrs {
  let value = p.strategy ?? "true";
  if (p.selector) {
    if (value === "true") value = "outerHTML";
    value = `${value}:${p.selector}`;
  }
  return { "hx-swap-oob": value };
}

/**
 * Builds an `hx-swap-oob` attribute that appends (`beforeend`) to the selector's target.
 *
 * @remarks
 * `selector` is emitted verbatim into `hx-swap-oob` and must be a TRUSTED, developer-supplied
 * selector, never raw user input. See {@link oobSwap}.
 *
 * @public
 */
export function oobAppend(selector: string): HxAttrs {
  return oobSwap({ strategy: "beforeend", selector });
}
