import { escapeHtml } from "./escape";

export interface FragmentOptions {
  class?: string;
  successAttr?: string;
}

const SUCCESS_CLASSES =
  "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900";
const ERROR_CLASSES =
  "rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900";

export function renderSuccess(message: string, options?: FragmentOptions): string {
  const cls = options?.class ?? SUCCESS_CLASSES;
  const attr = options?.successAttr ?? "data-success";
  return `<div class="${cls}" ${attr}><p>${escapeHtml(message)}</p></div>`;
}

export function renderError(message: string, options?: FragmentOptions): string {
  const cls = options?.class ?? ERROR_CLASSES;
  return `<div class="${cls}"><p>${escapeHtml(message)}</p></div>`;
}

export function renderValidationErrors(errors: string[], options?: FragmentOptions): string {
  const cls = options?.class ?? ERROR_CLASSES;
  const items = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
  return `<div class="${cls}"><p>Please correct the following fields.</p><ul class="mt-2 list-disc pl-5">${items}</ul></div>`;
}
