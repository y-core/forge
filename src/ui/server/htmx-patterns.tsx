/** @jsxImportSource @y-core/forge */

import type { ToastVariant } from "../core/toast";
import { Toast } from "../core/toast";
import type { HxAttrs } from "./htmx-attrs";
import { hxAttrs } from "./htmx-attrs";

export const SWAP = {
  innerHtml: "innerHTML",
  outerHtml: "outerHTML",
  beforeEnd: "beforeend",
  afterEnd: "afterend",
  beforeBegin: "beforebegin",
  delete: "delete",
  none: "none",
} as const;

function withQueryParam(
  path: string,
  key: string,
  value: string,
  extras?: Record<string, string>,
): string {
  try {
    const url = new URL(path, "http://localhost");
    if (extras) {
      for (const [k, v] of Object.entries(extras)) {
        url.searchParams.set(k, v);
      }
    }
    url.searchParams.set(key, value);
    return url.pathname + url.search;
  } catch {
    return path;
  }
}

interface LiveSearchProps {
  get: string;
  target: string;
  swap?: string;
  trigger?: string;
  pushUrl?: string;
}

export function liveSearch(p: LiveSearchProps): HxAttrs {
  return hxAttrs({
    get: p.get,
    target: p.target,
    swap: p.swap ?? SWAP.innerHtml,
    trigger: p.trigger ?? "input changed delay:300ms, search",
    pushUrl: p.pushUrl,
  });
}

interface InlineValidationProps {
  get: string;
  target: string;
  swap?: string;
  trigger?: string;
  sync?: string;
}

export function inlineValidation(p: InlineValidationProps): HxAttrs {
  return hxAttrs({
    get: p.get,
    target: p.target,
    swap: p.swap ?? SWAP.outerHtml,
    trigger: p.trigger ?? "change delay:200ms, blur",
    sync: p.sync ?? "closest form:abort",
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

export function paginatedTableLink(p: PaginatedTableProps): HxAttrs {
  const pageParam = p.pageParam ?? "page";
  const url = withQueryParam(p.get, pageParam, String(p.page), p.query);
  return hxAttrs({
    get: url,
    target: p.target,
    swap: p.swap ?? SWAP.outerHtml,
  });
}

interface AsyncDialogTriggerProps {
  get: string;
  target: string;
  dialogId: string;
  swap?: string;
}

export function asyncDialogTrigger(p: AsyncDialogTriggerProps): HxAttrs {
  return {
    ...hxAttrs({
      get: p.get,
      target: p.target,
      swap: p.swap ?? SWAP.innerHtml,
    }),
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

export function dependentSelect(p: DependentSelectProps): HxAttrs {
  return hxAttrs({
    get: p.get,
    target: p.target,
    swap: p.swap ?? SWAP.outerHtml,
    trigger: p.trigger ?? "change",
  });
}

interface InfiniteScrollProps {
  get: string;
  target: string;
  swap?: string;
  select?: string;
}

export function infiniteScroll(p: InfiniteScrollProps): HxAttrs {
  return hxAttrs({
    get: p.get,
    target: p.target,
    swap: p.swap ?? SWAP.beforeEnd,
    trigger: "revealed",
    select: p.select,
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

export function formSubmit(p: FormSubmitProps): HxAttrs {
  return hxAttrs({
    post: p.post,
    target: p.target,
    swap: p.swap ?? SWAP.outerHtml,
    disabledElt: p.disabledElt ?? "this",
    encoding: p.encoding,
    pushUrl: p.pushUrl,
  });
}

interface OobSwapProps {
  strategy?: string;
  selector?: string;
}

export function oobSwap(p: OobSwapProps): HxAttrs {
  let value = p.strategy ?? "true";
  if (p.selector) {
    if (value === "true") value = "outerHTML";
    value = `${value}:${p.selector}`;
  }
  return { "hx-swap-oob": value };
}

export function oobAppend(selector: string): HxAttrs {
  return oobSwap({ strategy: "beforeend", selector });
}

interface ToastOobProps {
  toast: { title?: string; description?: string; variant?: ToastVariant };
  selector?: string;
  strategy?: string;
}

export function toastOob(p: ToastOobProps) {
  const oobAttrs = oobSwap({
    strategy: p.strategy ?? "beforeend",
    selector: p.selector ?? "#toast-container",
  });
  return (
    <div {...oobAttrs}>
      <Toast variant={p.toast.variant}>
        {p.toast.title ? <Toast.Title>{p.toast.title}</Toast.Title> : null}
        {p.toast.description ? <Toast.Description>{p.toast.description}</Toast.Description> : null}
      </Toast>
    </div>
  );
}
