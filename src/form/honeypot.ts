import type { ReadonlyFormData } from "./types";

export function isHoneypotFilled(formData: ReadonlyFormData, field = "surname"): boolean {
  const value = formData.get(field);
  return typeof value === "string" && value.length > 0;
}
