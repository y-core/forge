import type { FormToObjectOptions, ReadonlyFormData } from "./types";

/**
 * The submitted body as a plain object, carrying every entry the caller sent.
 *
 * Three properties the schema depends on, each the reason a named-field reader could not be used:
 *
 * - **An absent field is absent**, never `""`. That is what keeps `v.optional` reachable and keeps
 *   required-ness a presence check rather than a min-length check.
 * - **A repeated key arrives as an array**, so a scalar schema refuses it in its own words and a
 *   route that genuinely accepts many says so with `v.array`. The decision lives in the schema.
 * - **A `File` is passed through unchanged**, so an upload schema can see one. Collapsing it to a
 *   string would make uploads unrepresentable and reintroduce the absence collapse above.
 *
 * Entries accumulate straight into an `Object.create(null)` bag, which settles both directions of
 * the prototype chain at once. Assignment on a prototype-less object cannot reach an inherited
 * setter, so a caller sending `__proto__` gets an own key here rather than a mutated prototype. And
 * a schema field named after an `Object.prototype` member — `constructor`, `toString`, `valueOf` —
 * reads as genuinely absent when the caller did not send it, instead of resolving to the inherited
 * function of that name and being validated as if it were user input.
 *
 * **The result therefore has no prototype at all**, which a caller inspecting it must account for:
 * `body.hasOwnProperty(name)` is `undefined`, not a method, and calling it throws. Use
 * `Object.hasOwn(body, name)` or `name in body`.
 *
 * @public
 */
export function formToObject(
  formData: ReadonlyFormData,
  options: FormToObjectOptions = {},
): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const drop = options.drop;
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
