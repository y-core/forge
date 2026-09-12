import type { SafeHtml } from "./html";

/** A value the `html` tagged template may interpolate. @public */
export type HtmlValue = SafeHtml | string | number | boolean | null | undefined | readonly HtmlValue[];

/** The tagged-template signature of `html`. @public */
export interface HtmlTemplateTag {
  (strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml;
}

/** Class-name overrides for the success/error/validation fragment renderers. @public */
export interface FragmentOptions {
  class?: string;
  successAttr?: string;
  ulClass?: string;
}
