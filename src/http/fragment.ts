import { escapeHtml } from "./escape";
import type { SafeHtml } from "./html";
import { rawHtml } from "./html";

/** Class-name overrides for the success/error/validation fragment renderers. @public */
export interface FragmentOptions {
  class?: string;
  successAttr?: string;
  ulClass?: string;
}

// Duplicates `src/ui/core/alert.tsx`'s variant classes: `http` is a leaf namespace, so importing
// them would add an `http → ui/core` edge that fails `validate-namespace-graph`.
const SUCCESS_CLASSES =
  "rounded-2xl border border-status-success-border bg-status-success-subtle px-4 py-3 text-sm text-status-success-subtle-foreground";
const ERROR_CLASSES =
  "rounded-2xl border border-status-danger-border bg-status-danger-subtle px-4 py-3 text-sm text-status-danger-subtle-foreground";

/** Renders an HTML success banner with an escaped message and optional custom class. @public */
export function renderSuccess(message: string, options?: FragmentOptions): SafeHtml {
  const cls = escapeHtml(options?.class ?? SUCCESS_CLASSES);
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
