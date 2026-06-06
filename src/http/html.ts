import type { SafeHtml } from "@remix-run/html-template";
import { html } from "@remix-run/html-template";

export type { HtmlTemplateTag, SafeHtml } from "@remix-run/html-template";
export { html, isSafeHtml } from "@remix-run/html-template";

/** Marks a raw string as safe HTML for use with the `html` tag. Replaces the old `html.raw(str)` function form. @public */
export function rawHtml(s: string): SafeHtml {
  return html.raw`${s}`;
}
