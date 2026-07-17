import { HONEYPOT_FIELD_DEFAULT } from "./constants";
import type { ReadonlyFormData } from "./types";

/** Returns true when the honeypot field holds any value, signaling a likely bot submission. @public */
export function isHoneypotFilled(formData: ReadonlyFormData, field = HONEYPOT_FIELD_DEFAULT): boolean {
  const value = formData.get(field);
  if (value == null) return false;
  return typeof value === "string" ? value.length > 0 : value.size > 0;
}
