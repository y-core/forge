export function isHoneypotFilled(formData: FormData, field = "surname"): boolean {
  const value = formData.get(field);
  return typeof value === "string" && value.length > 0;
}
