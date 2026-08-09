import { v } from "./validation";

/**
 * A strict object schema whose entries bag carries no prototype, so only a field the schema
 * actually declares counts as declared.
 *
 * Valibot decides whether a key is declared with `key in schema.entries`. On an ordinary object
 * literal that test walks `Object.prototype`, so `__proto__`, `constructor`, `toString`, `valueOf`
 * and every other inherited member read as declared for *any* schema — and a caller sending one of
 * those names is silently dropped from the parsed output rather than refused, which is the one case
 * where the unknown-key guarantee does not hold. Copying the entries onto an `Object.create(null)`
 * bag makes the test ownership-based for the whole class of inherited names at once, with no branch
 * naming any of them.
 *
 * The bag is replaced **at construction**, so the property holds wherever the schema ends up:
 * nested in another object, behind `v.pipe`, or as a `v.union` / `v.variant` option. A patch applied
 * to a finished schema would not survive being composed.
 *
 * Prefer this over `v.strictObject` for anything parsing untrusted input.
 *
 * @example
 * ```typescript
 * const ContactSchema = strictObject({ name: v.string(), email: v.pipe(v.string(), v.email()) });
 * ```
 * @public
 */
export function strictObject<const TEntries extends v.ObjectEntries>(entries: TEntries): v.StrictObjectSchema<TEntries, undefined>;
export function strictObject<const TEntries extends v.ObjectEntries, const TMessage extends v.ErrorMessage<v.StrictObjectIssue> | undefined>(
  entries: TEntries,
  message: TMessage,
): v.StrictObjectSchema<TEntries, TMessage>;
export function strictObject<TEntries extends v.ObjectEntries>(
  entries: TEntries,
  message?: v.ErrorMessage<v.StrictObjectIssue>,
): v.StrictObjectSchema<TEntries, v.ErrorMessage<v.StrictObjectIssue> | undefined> {
  // `Object.assign` copies own enumerable keys only, and the empty prototype-less target has no
  // inherited setter for any of them to trip over.
  const owned: TEntries = Object.assign(Object.create(null), entries);
  return message === undefined ? v.strictObject(owned) : v.strictObject(owned, message);
}
