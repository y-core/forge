import { escapeHtml } from "./escape";
import type { SafeHtml } from "./html";
import { rawHtml } from "./html";

export interface FragmentOptions {
  class?: string;
  successAttr?: string;
  /** Override the `<ul>` class inside `renderValidationErrors`. Defaults to `"mt-2 list-disc pl-5"`. */
  ulClass?: string;
}

const SUCCESS_CLASSES = "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900";
const ERROR_CLASSES = "rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900";

/** Renders an HTML success banner with an escaped message and optional custom class. @public */
export function renderSuccess(message: string, options?: FragmentOptions): SafeHtml {
  const cls = escapeHtml(options?.class ?? SUCCESS_CLASSES);
  // `successAttr` is, by contract, a raw attribute fragment (e.g. `data-status="success"`), so it
  // is interpolated verbatim. It is developer-supplied configuration, never user input.
  const attr = options?.successAttr ?? "data-success";
  return rawHtml(`<div class="${cls}" ${attr}><p>${escapeHtml(message)}</p></div>`);
}

/** Renders an HTML error banner with an escaped message and optional custom class. @public */
export function renderError(message: string, options?: FragmentOptions): SafeHtml {
  const cls = escapeHtml(options?.class ?? ERROR_CLASSES);
  return rawHtml(`<div class="${cls}"><p>${escapeHtml(message)}</p></div>`);
}

/** Renders an HTML validation error list with each error HTML-escaped; supports custom container and list classes. @public */
export function renderValidationErrors(errors: string[], options?: FragmentOptions): SafeHtml {
  const cls = escapeHtml(options?.class ?? ERROR_CLASSES);
  const ulCls = escapeHtml(options?.ulClass ?? "mt-2 list-disc pl-5");
  const items = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
  return rawHtml(`<div class="${cls}"><p>Please correct the following fields.</p><ul class="${ulCls}">${items}</ul></div>`);
}
