import type { ReadonlyFormData } from "./types";

export function readTextField(formData: ReadonlyFormData, field: string): string {
  const value = formData.get(field);
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim();
}

export function readFields<K extends string>(formData: ReadonlyFormData, fields: K[]): Record<K, string> {
  return Object.fromEntries(
    fields.map((field) => [field, readTextField(formData, field)]),
  ) as Record<K, string>;
}
