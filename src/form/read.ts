import type { ReadonlyFormData } from "./types";

/** Reads a form field as a trimmed, CRLF-normalized string, or `""` when absent/non-string. @public */
export function readTextField(formData: ReadonlyFormData, field: string): string {
  const value = formData.get(field);
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim();
}

/** Reads multiple form fields into a keyed record of trimmed string values. @public */
export function readFields<K extends string>(formData: ReadonlyFormData, fields: K[]): Record<K, string> {
  return Object.fromEntries(fields.map((field) => [field, readTextField(formData, field)])) as Record<K, string>;
}
