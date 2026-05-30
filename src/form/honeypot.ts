import type { ReadonlyFormData } from "./types";

export function isHoneypotFilled(formData: ReadonlyFormData, field = "surname"): boolean {
  const value = formData.get(field);
  if (value == null) return false;
  return typeof value === "string" ? value.length > 0 : value.size > 0;
}
