import {
  LAZY_DEMO_LOADED,
  LAZY_DEMO_STATUS_REF,
  LAZY_PANEL_ROWS,
  LAZY_PANEL_TITLE,
  LAZY_RETRY_LOADED,
  LAZY_RETRY_STATUS_REF,
} from "./lazy-contract";

// The realm comes off the anchor rather than through `ui/client`'s `ownerDocument`: this module is
// not `client.ts`, and the SSR boundary lets only that file import the browser runtime.
/** The rows themselves, built rather than server-rendered — that is the cost the deferral defers. */
function buildPayload(el: Element): Element {
  const doc = el.ownerDocument;
  const panel = doc.createElement("div");
  panel.setAttribute("class", "w-full space-y-2");

  const title = doc.createElement("p");
  title.setAttribute("class", "text-sm font-medium text-foreground");
  title.textContent = LAZY_PANEL_TITLE;
  panel.append(title);

  const list = doc.createElement("ul");
  list.setAttribute("class", "divide-y divide-border rounded-lg border border-border");
  for (const row of LAZY_PANEL_ROWS) {
    const item = doc.createElement("li");
    item.setAttribute("class", "flex items-center justify-between px-3 py-2 text-sm text-muted-foreground");
    const name = doc.createElement("span");
    name.textContent = row.name;
    const cost = doc.createElement("span");
    cost.setAttribute("class", "tabular-nums");
    cost.textContent = row.cost;
    item.append(name, cost);
    list.append(item);
  }
  panel.append(list);
  return panel;
}

/** Replaces one status line, and appends the payload beside it if it is not already there. */
function mount(el: Element, statusRef: string, loaded: string): void {
  const status = el.querySelector(`[data-ref='${statusRef}']`);
  if (status) status.textContent = loaded;
  // Idempotent: `lazy()` calls `init` once per element, but a re-resumed scope would call it again.
  if (el.querySelector("ul") === null) el.append(buildPayload(el));
}

/** Marks the lazy demo panel as loaded and renders the module's payload into it. @internal */
export function mountLazyPanel(el: Element): void {
  mount(el, LAZY_DEMO_STATUS_REF, LAZY_DEMO_LOADED);
}

/** The same payload, for the anchor whose earlier attempts rejected. @internal */
export function mountRetryPanel(el: Element): void {
  mount(el, LAZY_RETRY_STATUS_REF, LAZY_RETRY_LOADED);
}
