import { escapeHtml } from "./escape";
import type { SafeHtml } from "./html";
import { rawHtml } from "./html";

/** Class-name overrides for the success/error/validation fragment renderers. @public */
export interface FragmentOptions {
  class?: string;
  successAttr?: string;
  /** Override the `<ul>` class inside `renderValidationErrors`. Defaults to `"mt-2 list-disc pl-5"`. */
  ulClass?: string;
}

/* These two mirror `Alert`'s root classes plus its `success` and `destructive` variants, from
   `src/ui/core/alert.tsx` — deliberately duplicated rather than imported. `http` is a declared leaf
   namespace (`scripts/namespace-graph.ts:41`), so an `http → ui/core` edge would invert the graph
   and fail `validate-namespace-graph`.

   The duplication is now only of *utility names*, not of colour decisions: both files reach the same
   `--status-*` tokens, so the two cannot disagree about what a success banner looks like even though
   neither can import the other. Before this they each spelled out six palette stops, and keeping them
   in step was a comment's job. Keep the two in step — when `alert.tsx`'s variant strings change,
   these change with them — but a drift now costs a class name rather than a mismatched hue. */
const SUCCESS_CLASSES =
  "rounded-2xl border border-status-success-border bg-status-success-subtle px-4 py-3 text-sm text-status-success-subtle-foreground";
const ERROR_CLASSES =
  "rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground";

/** Renders an HTML success banner with an escaped message and optional custom class. @public */
export function renderSuccess(message: string, options?: FragmentOptions): SafeHtml {
  const cls = escapeHtml(options?.class ?? SUCCESS_CLASSES);
  // `successAttr` is, by contract, a raw attribute name (e.g. `data-success`), so it
  // is interpolated verbatim. It is developer-supplied configuration, never user input.
  const attr = options?.successAttr ?? "data-success";
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(attr)) {
    throw new Error(`Invalid successAttr: ${attr}`);
  }
  return rawHtml(`<div class="${cls}" ${attr}><p>${escapeHtml(message)}</p></div>`);
}

/** Renders an HTML error banner with an escaped message and optional custom class. @public */
export function renderError(message: string, options?: FragmentOptions): SafeHtml {
  const cls = escapeHtml(options?.class ?? ERROR_CLASSES);
  return rawHtml(`<div class="${cls}"><p>${escapeHtml(message)}</p></div>`);
}

/** Renders an HTML validation error list with each error HTML-escaped; supports custom container and list classes. @public */
export function renderValidationErrors(errors: readonly string[], options?: FragmentOptions): SafeHtml {
  const cls = escapeHtml(options?.class ?? ERROR_CLASSES);
  const ulCls = escapeHtml(options?.ulClass ?? "mt-2 list-disc pl-5");
  const items = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
  return rawHtml(`<div class="${cls}"><p>Please correct the following fields.</p><ul class="${ulCls}">${items}</ul></div>`);
}
