import type { FormToObjectOptions, ReadonlyFormData } from "./types";

/** The submitted body as a prototype-less plain object, carrying every entry the caller sent. @public */
export function formToObject(
  formData: ReadonlyFormData,
  options: FormToObjectOptions = {},
): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const drop = options.drop;
  // Prototype-less: a `{}` bag would let a submitted `__proto__` reach an inherited setter, and would make a field named `constructor` read as present.
  const body: Record<string, FormDataEntryValue | FormDataEntryValue[]> = Object.create(null);

  for (const [name, value] of formData.entries()) {
    if (drop?.has(name)) continue;

    const seen = body[name];
    if (seen === undefined) body[name] = value;
    else if (Array.isArray(seen)) seen.push(value);
    else body[name] = [seen, value];
  }

  return body;
}
