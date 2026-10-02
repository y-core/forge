import type { SafeHtml } from "./html";

/** A value the `html` tagged template may interpolate. @public */
export type HtmlValue = SafeHtml | string | number | boolean | null | undefined | readonly HtmlValue[];

/** The tagged-template signature of `html`. @public */
export interface HtmlTemplateTag {
  (strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml;
}
