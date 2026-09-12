import { escapeHtml } from "./escape";
import type { HtmlTemplateTag, HtmlValue } from "./types";

/** HTML that is safe to emit without further escaping; produced only via `html` or `rawHtml`. @public */
export class SafeHtml {
  readonly #html: string;

  constructor(html: string) {
    this.#html = html;
  }

  toString(): string {
    return this.#html;
  }

  valueOf(): string {
    return this.#html;
  }
}

/** Type guard for values produced by `html` or `rawHtml`. @public */
export function isSafeHtml(value: unknown): value is SafeHtml {
  return value instanceof SafeHtml;
}

function stringify(value: HtmlValue): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(stringify).join("");
  if (value instanceof SafeHtml) return value.toString();
  return escapeHtml(String(value));
}

/** Tagged template that escapes every interpolated value and inlines nested `SafeHtml` verbatim. @public */
export const html: HtmlTemplateTag = (strings, ...values) => {
  // `html(userInput)` would emit its argument unescaped, so a non-template call is refused outright.
  if (!Array.isArray(strings) || !("raw" in strings)) {
    throw new TypeError("html must be used as a template tag");
  }
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    out += stringify(values[i]) + (strings[i + 1] ?? "");
  }
  return new SafeHtml(out);
};

/** Marks a trusted string as safe HTML, opting it out of escaping. @public */
export function rawHtml(s: string): SafeHtml {
  return new SafeHtml(s);
}
